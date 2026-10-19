import { downloadCsv } from '@/export/csv-exporter';
import {
  appendLog,
  clearAllData,
  createDefaultState,
  getState,
  isDuplicateJob,
  setSessionStatus,
  setState,
  updateSession,
  upsertJob,
} from '@/storage/session-store';
import type {
  ExtensionMessage,
  ExtensionState,
  JobCardSummary,
  JobRecord,
  ScrapingSession,
} from '@/types/job';
import { createDefaultSession } from '@/types/job';
import { isSearchResultsUrl, isZipRecruiterUrl } from '@/utils/parsing';

const TICK_ALARM = 'ziprecruiter-scrape-tick';
let tickInFlight = false;

async function injectContentScript(tabId: number): Promise<void> {
  const manifest = chrome.runtime.getManifest();
  const files = manifest.content_scripts?.[0]?.js;
  if (!files?.length) return;
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files,
    });
  } catch {
    // May already be injected or page not scriptable yet
  }
}

async function sendToTab<T = unknown>(
  tabId: number,
  message: ExtensionMessage,
): Promise<T> {
  const attempt = async () => (await chrome.tabs.sendMessage(tabId, message)) as T;
  try {
    return await attempt();
  } catch {
    await injectContentScript(tabId);
    for (let i = 0; i < 10; i += 1) {
      await delay(350);
      try {
        return await attempt();
      } catch {
        if (i === 4) await injectContentScript(tabId);
      }
    }
    throw new Error(
      'Content script is unavailable on this tab. Refresh the ZipRecruiter page, then click Start Scraping again.',
    );
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForTabComplete(tabId: number, timeoutMs = 20000): Promise<void> {
  const existing = await chrome.tabs.get(tabId);
  if (existing.status === 'complete') {
    // Give SPA routing a moment even when status is already complete
    await delay(400);
    return;
  }

  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      reject(new Error('Timed out waiting for the results page to load.'));
    }, timeoutMs);

    const listener = (
      updatedTabId: number,
      changeInfo: chrome.tabs.TabChangeInfo,
    ) => {
      if (updatedTabId !== tabId) return;
      if (changeInfo.status === 'complete') {
        clearTimeout(timer);
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    };

    chrome.tabs.onUpdated.addListener(listener);
  });

  await delay(600);
}

async function discoverJobsWithRetry(
  tabId: number,
  attempts = 8,
): Promise<{
  jobs: JobCardSummary[];
  pageNumber: number | null;
  url: string;
  challenge?: boolean;
}> {
  let lastError: unknown;
  for (let i = 0; i < attempts; i += 1) {
    try {
      await injectContentScript(tabId);
      const discovered = await sendToTab<{
        jobs: JobCardSummary[];
        pageNumber: number | null;
        url: string;
        challenge?: boolean;
        error?: string;
      }>(tabId, { type: 'CONTENT_DISCOVER_JOBS' });

      if (discovered?.challenge) return discovered;
      if (discovered?.error) throw new Error(discovered.error);
      if ((discovered?.jobs?.length ?? 0) > 0) return discovered;

      // Page may still be hydrating — keep trying
      await delay(500 + i * 250);
    } catch (error) {
      lastError = error;
      await delay(400 + i * 200);
    }
  }

  if (lastError) throw lastError;
  return { jobs: [], pageNumber: null, url: '' };
}

async function getActiveTab(): Promise<chrome.tabs.Tab | undefined> {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs[0];
}

async function broadcastState(state?: ExtensionState): Promise<ExtensionState> {
  const next = state ?? (await getState());
  chrome.runtime.sendMessage({ type: 'STATE_UPDATED', payload: next }).catch(() => {
    // Popup may be closed
  });
  return next;
}

async function ensureSupportedTab(tab?: chrome.tabs.Tab): Promise<chrome.tabs.Tab> {
  const active = tab ?? (await getActiveTab());
  if (!active?.id || !active.url) {
    throw new Error('No active tab available.');
  }
  if (!isZipRecruiterUrl(active.url)) {
    throw new Error('Open a ZipRecruiter page before starting.');
  }
  return active;
}

async function log(message: string, level: 'info' | 'success' | 'warn' | 'error' = 'info') {
  const state = await appendLog(message, level);
  await broadcastState(state);
}

async function startScraping(): Promise<ExtensionState> {
  const tab = await ensureSupportedTab();
  if (!isSearchResultsUrl(tab.url) && !tab.url?.includes('ziprecruiter.com')) {
    throw new Error('Navigate to a ZipRecruiter job search results page first.');
  }

  await injectContentScript(tab.id!);
  await delay(200);

  const ping = await sendToTab<{
    ok?: boolean;
    isResultsPage?: boolean;
    challenge?: boolean;
    error?: string;
  }>(tab.id!, { type: 'CONTENT_PING' });

  if (ping?.challenge) {
    throw new Error('A security challenge was detected. Resolve it manually, then resume.');
  }
  if (!ping?.isResultsPage) {
    // Soft allow — discovery may still find cards
    await log('Page may not be a standard results view; attempting discovery…', 'warn');
  }

  const discovered = await sendToTab<{
    jobs: JobCardSummary[];
    pageNumber: number | null;
    url: string;
    challenge?: boolean;
    error?: string;
  }>(tab.id!, { type: 'CONTENT_DISCOVER_JOBS' });

  if (discovered?.challenge) {
    throw new Error('A security challenge was detected. Resolve it manually, then try again.');
  }
  if (discovered?.error) throw new Error(discovered.error);

  const jobs = discovered?.jobs ?? [];
  if (jobs.length === 0) {
    throw new Error('No job cards were found on this page.');
  }

  const now = new Date().toISOString();
  const current = await getState();
  const session: ScrapingSession = {
    ...createDefaultSession(),
    status: 'running',
    searchResultsUrl: discovered.url || tab.url!,
    currentPage: discovered.pageNumber,
    discoveredJobIds: jobs.map((j) => j.listingKey || j.jobId),
    pendingJobUrls: jobs.map((j) => j.url),
    pendingJobs: jobs,
    processedJobIds: [],
    jobsDiscovered: jobs.length,
    jobsProcessed: 0,
    jobsExtracted: 0,
    jobsFailed: 0,
    jobsSkipped: 0,
    tabId: tab.id!,
    startedAt: now,
    updatedAt: now,
    activityLog: [
      ...current.session.activityLog,
      {
        id: `${Date.now()}-start`,
        timestamp: now,
        message: `Found ${jobs.length} jobs on page ${discovered.pageNumber ?? '?'}.`,
        level: 'info',
      },
    ],
  };

  // Keep previously extracted jobs unless user cleared — new session replaces queue
  const state = await setState({ session, jobs: current.jobs });
  await scheduleTick(250);
  return broadcastState(state);
}

async function pauseScraping(): Promise<ExtensionState> {
  const state = await updateSession((session) => ({
    session: {
      ...session,
      status: session.status === 'running' ? 'paused' : session.status,
    },
  }));
  await log('Scraping paused.', 'warn');
  await clearTick();
  return broadcastState(state);
}

async function resumeScraping(): Promise<ExtensionState> {
  const current = await getState();
  if (current.session.status !== 'paused' && current.session.status !== 'error') {
    throw new Error('Resume is only available while paused or after a recoverable error.');
  }
  const tab = await ensureSupportedTab(
    current.session.tabId
      ? ((await chrome.tabs.get(current.session.tabId).catch(() => undefined)) as
          | chrome.tabs.Tab
          | undefined)
      : undefined,
  );

  const state = await updateSession((session) => ({
    session: {
      ...session,
      status: 'running',
      lastError: null,
      tabId: tab.id!,
    },
  }));
  await log('Scraping resumed.', 'info');
  await scheduleTick(250);
  return broadcastState(state);
}

async function stopScraping(): Promise<ExtensionState> {
  const state = await updateSession((session) => ({
    session: {
      ...session,
      status: 'idle',
      currentJobUrl: null,
      currentJobTitle: null,
      pendingJobUrls: [],
      pendingJobs: [],
    },
  }));
  await log('Scraping stopped. Collected jobs were preserved.', 'warn');
  await clearTick();
  return broadcastState(state);
}

async function scheduleTick(ms = 500): Promise<void> {
  await chrome.alarms.clear(TICK_ALARM);
  await chrome.alarms.create(TICK_ALARM, { when: Date.now() + ms });
  // Also kick an immediate async tick for responsiveness
  void processTick();
}

async function clearTick(): Promise<void> {
  await chrome.alarms.clear(TICK_ALARM);
}

async function processCurrentJob(
  tabId: number,
  session: ScrapingSession,
  pending: JobCardSummary,
): Promise<void> {
  const jobUrl = pending.url;
  await updateSession((s) => ({
    session: {
      ...s,
      currentJobUrl: jobUrl,
      currentJobTitle: pending.title || 'Opening job…',
    },
  }));
  await broadcastState();

  const opened = await sendToTab<{
    opened?: boolean;
    ready?: boolean;
    challenge?: boolean;
    error?: string;
    mode?: string;
  }>(tabId, {
    type: 'CONTENT_OPEN_JOB',
    payload: {
      url: jobUrl,
      listingKey: pending.listingKey,
      jobId: pending.jobId,
      title: pending.title,
    },
  });

  if (opened?.challenge) {
    await setSessionStatus('paused', 'Security challenge detected. Resolve it, then resume.');
    await log('Paused for CAPTCHA / security challenge.', 'error');
    await clearTick();
    await broadcastState();
    return;
  }

  const extracted = await sendToTab<{
    job: JobRecord | null;
    challenge?: boolean;
    error?: string;
  }>(tabId, {
    type: 'CONTENT_EXTRACT_DETAIL',
    payload: {
      searchResultsUrl: session.searchResultsUrl,
      pageNumber: session.currentPage,
      fallbackUrl: jobUrl,
      listingKey: pending.listingKey,
      title: pending.title,
    },
  });

  if (extracted?.challenge) {
    await setSessionStatus('paused', 'Security challenge detected. Resolve it, then resume.');
    await log('Paused for CAPTCHA / security challenge.', 'error');
    await clearTick();
    await broadcastState();
    return;
  }

  const job = extracted?.job;
  const jobKey = job?.job_id || pending.listingKey || pending.jobId || jobUrl;

  const dequeue = (s: ScrapingSession): ScrapingSession => ({
    ...s,
    pendingJobUrls: s.pendingJobUrls.filter((u) => u !== jobUrl),
    pendingJobs: (s.pendingJobs ?? []).filter(
      (j) =>
        j.url !== pending.url &&
        j.jobId !== pending.jobId &&
        j.listingKey !== pending.listingKey,
    ),
  });

  if (!job) {
    await updateSession((s, jobs) => ({
      session: {
        ...dequeue(s),
        jobsProcessed: s.jobsProcessed + 1,
        jobsFailed: s.jobsFailed + 1,
        processedJobIds: [...s.processedJobIds, jobKey],
        lastProcessedJobId: jobKey,
        currentJobTitle: null,
        currentJobUrl: null,
        lastError: extracted?.error ?? 'Failed to extract job detail.',
      },
      jobs,
    }));
    await log(`Failed to extract a job (${pending.title || jobUrl}).`, 'error');
  } else {
    await upsertJob(job);
    const success = job.scrape_status !== 'failed';
    await updateSession((s) => ({
      session: {
        ...dequeue(s),
        jobsProcessed: s.jobsProcessed + 1,
        jobsExtracted: s.jobsExtracted + (success ? 1 : 0),
        jobsFailed: s.jobsFailed + (success ? 0 : 1),
        processedJobIds: [...s.processedJobIds, jobKey],
        lastProcessedJobId: jobKey,
        currentJobTitle: job.job_title || null,
        currentJobUrl: null,
        lastError: job.extraction_errors || null,
      },
    }));
    await log(
      success
        ? `Extracted ${job.job_title || 'job'}.`
        : `Partial/failed extraction for ${job.job_title || jobUrl}.`,
      success ? 'success' : 'warn',
    );
  }

  // Split-view stays on results; only navigate back if we left the SERP.
  await sendToTab(tabId, {
    type: 'CONTENT_GO_BACK',
    payload: { url: session.searchResultsUrl },
  });
  await delay(200);

  await broadcastState();
}

async function discoverMoreOnCurrentPage(tabId: number, session: ScrapingSession): Promise<boolean> {
  const discovered = await sendToTab<{
    jobs: JobCardSummary[];
    pageNumber: number | null;
    url: string;
    challenge?: boolean;
  }>(tabId, { type: 'CONTENT_DISCOVER_JOBS' });

  if (discovered?.challenge) {
    await setSessionStatus('paused', 'Security challenge detected. Resolve it, then resume.');
    await log('Paused for CAPTCHA / security challenge.', 'error');
    await clearTick();
    await broadcastState();
    return false;
  }

  const state = await getState();
  const pending = state.session.pendingJobs ?? [];
  const freshJobs: JobCardSummary[] = [];
  for (const job of discovered?.jobs ?? []) {
    const key = job.listingKey || job.jobId;
    if (
      isDuplicateJob(state.jobs, session.processedJobIds, job.jobId, job.url) ||
      session.processedJobIds.includes(key) ||
      pending.some((p) => p.listingKey === job.listingKey || p.jobId === job.jobId || p.url === job.url)
    ) {
      continue;
    }
    freshJobs.push(job);
  }

  if (freshJobs.length === 0) return false;

  await updateSession((s) => ({
    session: {
      ...s,
      pendingJobs: [...(s.pendingJobs ?? []), ...freshJobs],
      pendingJobUrls: [...s.pendingJobUrls, ...freshJobs.map((j) => j.url)],
      discoveredJobIds: [
        ...s.discoveredJobIds,
        ...freshJobs.map((j) => j.listingKey || j.jobId),
      ].filter((id, idx, arr) => arr.indexOf(id) === idx),
      jobsDiscovered: s.jobsDiscovered + freshJobs.length,
      currentPage: discovered?.pageNumber ?? s.currentPage,
      searchResultsUrl: discovered?.url || s.searchResultsUrl,
    },
  }));
  await log(`Discovered ${freshJobs.length} additional job(s).`, 'info');
  await broadcastState();
  return true;
}

async function paginateOrComplete(tabId: number, session: ScrapingSession): Promise<void> {
  const pageInfo = await sendToTab<{
    pagination: {
      hasNext: boolean;
      isFinalPage: boolean;
      currentPage: number | null;
      nextPage: number | null;
      nextHref: string | null;
    };
    challenge?: boolean;
    url?: string;
  }>(tabId, { type: 'CONTENT_PAGE_INFO' });

  if (pageInfo?.challenge) {
    await setSessionStatus('paused', 'Security challenge detected. Resolve it, then resume.');
    await log('Paused for CAPTCHA / security challenge.', 'error');
    await clearTick();
    await broadcastState();
    return;
  }

  const pagination = pageInfo?.pagination;
  if (!pagination?.hasNext) {
    await updateSession((s) => ({
      session: {
        ...s,
        status: 'completed',
        currentJobTitle: null,
        currentJobUrl: null,
        pendingJobs: [],
        pendingJobUrls: [],
      },
    }));
    await log(
      `Completed all available pages. Extracted ${session.jobsExtracted} job(s).`,
      'success',
    );
    await clearTick();
    await broadcastState();
    return;
  }

  const previousPage = pagination.currentPage ?? session.currentPage;
  const nextHref = pagination.nextHref;

  await log(
    `Moving to page ${pagination.nextPage ?? (previousPage != null ? previousPage + 1 : '?')}…`,
    'info',
  );

  // Prefer background-driven navigation so the content script is not required to
  // survive a full page transition (that was stopping the session on page 2).
  if (nextHref) {
    await chrome.tabs.update(tabId, { url: nextHref });
  } else {
    // Fallback: ask the content script to click Next, but do not wait on it for load.
    try {
      await sendToTab(tabId, { type: 'CONTENT_PAGINATE' });
    } catch {
      // Navigation may unload the content script before it can respond — that is OK.
    }
  }

  try {
    await waitForTabComplete(tabId);
  } catch (error) {
    // Still attempt discovery; SPA navigations can be flaky with tab status events
    await log(
      error instanceof Error ? error.message : 'Page load wait timed out; retrying discovery…',
      'warn',
    );
  }

  await injectContentScript(tabId);
  await delay(500);

  let discovered: {
    jobs: JobCardSummary[];
    pageNumber: number | null;
    url: string;
    challenge?: boolean;
  };

  try {
    discovered = await discoverJobsWithRetry(tabId);
  } catch (error) {
    // Keep the session running so the next tick / tab complete event can recover
    await log(
      error instanceof Error
        ? `Waiting for page 2+ jobs: ${error.message}`
        : 'Waiting for the next results page to become ready…',
      'warn',
    );
    await broadcastState();
    return;
  }

  if (discovered?.challenge) {
    await setSessionStatus('paused', 'Security challenge detected. Resolve it, then resume.');
    await log('Paused for CAPTCHA / security challenge.', 'error');
    await clearTick();
    await broadcastState();
    return;
  }

  const state = await getState();
  const nextJobs = (discovered?.jobs ?? []).filter(
    (j) =>
      !isDuplicateJob(state.jobs, state.session.processedJobIds, j.jobId, j.url) &&
      !state.session.processedJobIds.includes(j.listingKey || j.jobId),
  );

  const resolvedPage =
    discovered?.pageNumber ??
    pagination.nextPage ??
    (previousPage != null ? previousPage + 1 : null);

  await updateSession((s) => ({
    session: {
      ...s,
      status: 'running',
      searchResultsUrl: discovered?.url || nextHref || s.searchResultsUrl,
      currentPage: resolvedPage,
      pendingJobs: nextJobs,
      pendingJobUrls: nextJobs.map((j) => j.url),
      jobsDiscovered: s.jobsDiscovered + nextJobs.length,
      discoveredJobIds: [
        ...s.discoveredJobIds,
        ...nextJobs.map((j) => j.listingKey || j.jobId),
      ].filter((id, idx, arr) => arr.indexOf(id) === idx),
      lastError: null,
    },
  }));

  await log(
    `Moved to page ${resolvedPage ?? '?'}. Found ${discovered?.jobs?.length ?? 0} jobs (${nextJobs.length} new).`,
    'info',
  );

  if (nextJobs.length === 0) {
    // Do not complete immediately — ZipRecruiter may still be rendering, or the
    // page may only contain duplicates. Let the next tick rediscover / paginate.
    await log(
      'No new jobs queued yet after pagination; will retry on the next scrape tick.',
      'warn',
    );
  }

  await broadcastState();
}

async function processTick(): Promise<void> {
  if (tickInFlight) return;
  tickInFlight = true;
  try {
    const state = await getState();
    const { session } = state;
    if (session.status !== 'running') return;

    const tabId = session.tabId ?? (await getActiveTab())?.id;
    if (!tabId) {
      await setSessionStatus('paused', 'Lost the target tab. Reopen ZipRecruiter and resume.');
      await log('Paused because the target tab was lost.', 'error');
      await clearTick();
      await broadcastState();
      return;
    }

    let tab: chrome.tabs.Tab;
    try {
      tab = await chrome.tabs.get(tabId);
    } catch {
      await setSessionStatus('paused', 'Target tab was closed. Open ZipRecruiter and resume.');
      await log('Paused because the target tab was closed.', 'error');
      await clearTick();
      await broadcastState();
      return;
    }

    if (!isZipRecruiterUrl(tab.url)) {
      await setSessionStatus(
        'paused',
        'Navigated away from ZipRecruiter. Return to the search results and resume.',
      );
      await log('Paused after navigating away from ZipRecruiter.', 'warn');
      await clearTick();
      await broadcastState();
      return;
    }

    // Skip duplicates at queue head
    while ((session.pendingJobs?.length ?? 0) > 0 || session.pendingJobUrls.length > 0) {
      const nextJob =
        session.pendingJobs?.[0] ??
        ({
          jobId: session.pendingJobUrls[0]!,
          title: '',
          company: '',
          url: session.pendingJobUrls[0]!,
        } satisfies JobCardSummary);
      const latest = await getState();
      const key = nextJob.listingKey || nextJob.jobId || nextJob.url;
      const already =
        latest.session.processedJobIds.includes(key) ||
        latest.session.processedJobIds.includes(nextJob.url) ||
        Object.values(latest.jobs).some(
          (j) => j.job_url === nextJob.url || j.job_id === nextJob.jobId,
        );

      if (already) {
        await updateSession((s) => ({
          session: {
            ...s,
            pendingJobs: (s.pendingJobs ?? []).slice(1),
            pendingJobUrls: s.pendingJobUrls.slice(1),
            jobsSkipped: s.jobsSkipped + 1,
            jobsProcessed: s.jobsProcessed + 1,
            processedJobIds: [...s.processedJobIds, key],
          },
        }));
        await log('Skipped duplicate job.', 'warn');
        session.pendingJobs = (session.pendingJobs ?? []).slice(1);
        session.pendingJobUrls = session.pendingJobUrls.slice(1);
        continue;
      }
      break;
    }

    const latestSession = (await getState()).session;
    if (latestSession.status !== 'running') return;

    const queue = latestSession.pendingJobs ?? [];
    if (queue.length > 0 || latestSession.pendingJobUrls.length > 0) {
      const pending =
        queue[0] ??
        ({
          jobId: latestSession.pendingJobUrls[0]!,
          title: '',
          company: '',
          url: latestSession.pendingJobUrls[0]!,
        } satisfies JobCardSummary);
      await processCurrentJob(tabId, latestSession, pending);
      const after = await getState();
      if (after.session.status === 'running') await scheduleTick(400);
      return;
    }

    // No pending jobs — try rediscovery, then pagination
    const foundMore = await discoverMoreOnCurrentPage(tabId, latestSession);
    const afterDiscover = await getState();
    if (afterDiscover.session.status !== 'running') return;

    if (
      foundMore &&
      ((afterDiscover.session.pendingJobs?.length ?? 0) > 0 ||
        afterDiscover.session.pendingJobUrls.length > 0)
    ) {
      await scheduleTick(300);
      return;
    }

    await paginateOrComplete(tabId, afterDiscover.session);
    const afterPage = await getState();
    if (afterPage.session.status === 'running') await scheduleTick(600);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await setSessionStatus('error', message);
    await log(message, 'error');
    await clearTick();
    await broadcastState();
  } finally {
    tickInFlight = false;
  }
}

chrome.runtime.onInstalled.addListener(() => {
  void getState().then((state) => {
    if (!state) void setState(createDefaultState());
  });
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === TICK_ALARM) void processTick();
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  void (async () => {
    const state = await getState();
    if (state.session.tabId !== tabId) return;
    if (state.session.status !== 'running' && state.session.status !== 'paused') return;
    if (changeInfo.status === 'complete' && state.session.status === 'running') {
      await scheduleTick(500);
    }
  })();
});

chrome.runtime.onMessage.addListener((message: ExtensionMessage, sender, sendResponse) => {
  void (async () => {
    try {
      switch (message.type) {
        case 'GET_STATE': {
          sendResponse(await broadcastState());
          break;
        }
        case 'START_SCRAPING': {
          sendResponse(await startScraping());
          break;
        }
        case 'PAUSE_SCRAPING': {
          sendResponse(await pauseScraping());
          break;
        }
        case 'RESUME_SCRAPING': {
          sendResponse(await resumeScraping());
          break;
        }
        case 'STOP_SCRAPING': {
          sendResponse(await stopScraping());
          break;
        }
        case 'CLEAR_DATA': {
          const state = await clearAllData();
          await broadcastState(state);
          sendResponse(state);
          break;
        }
        case 'EXPORT_CSV': {
          const state = await getState();
          const jobs = Object.values(state.jobs);
          const result = await downloadCsv(jobs);
          await log(`Exported ${result.count} job(s) to ${result.filename}.`, 'success');
          sendResponse({ ok: true, ...result });
          break;
        }
        case 'CONTENT_PING': {
          // Content script announcing load — useful for recovery
          if (sender.tab?.id) {
            const state = await getState();
            if (
              state.session.status === 'running' &&
              (state.session.tabId === sender.tab.id || state.session.tabId == null)
            ) {
              await updateSession((s) => ({
                session: { ...s, tabId: sender.tab!.id! },
              }));
              await scheduleTick(300);
            }
          }
          sendResponse({ ok: true });
          break;
        }
        case 'SCRAPE_TICK': {
          await processTick();
          sendResponse({ ok: true });
          break;
        }
        default:
          sendResponse({ error: `Unknown message: ${message.type}` });
      }
    } catch (error) {
      const messageText = error instanceof Error ? error.message : String(error);
      await setSessionStatus('error', messageText);
      await log(messageText, 'error');
      sendResponse({ error: messageText, ...(await getState()) });
    }
  })();
  return true;
});

// Recover running session after service worker restart
void (async () => {
  const state = await getState();
  if (state.session.status === 'running') {
    await scheduleTick(1000);
  }
})();
