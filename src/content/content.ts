import { detectChallenge, detailLooksReady, extractJobDetail } from '@/content/detail-extractor';
import {
  clickLoadMoreIfPresent,
  detectPagination,
  goToNextPage,
} from '@/content/pagination';
import {
  discoverJobCards,
  findJobCardElement,
  getCurrentPageNumberFromUrl,
  isResultsPage,
} from '@/content/results-extractor';
import type { ExtensionMessage, JobCardSummary } from '@/types/job';
import { absoluteUrl, queryAll, queryFirst, sleep, waitFor } from '@/utils/dom';
import { SELECTORS } from '@/content/selectors';
import { canonicalJobUrl } from '@/utils/parsing';

function respond<T>(payload: T): T {
  return payload;
}

async function openJob(options: {
  url?: string;
  listingKey?: string;
  jobId?: string;
  title?: string;
}): Promise<{ opened: boolean; mode: string; listingKey?: string }> {
  const { url, listingKey, jobId, title } = options;

  const card = findJobCardElement({ listingKey, jobId, url, title });
  if (card) {
    const activation =
      queryFirst(card, SELECTORS.results.jobActivation as unknown as string[]) ||
      card.querySelector('button[data-testid="job-card-activation"]') ||
      card.querySelector('button[aria-label^="View "]');

    (activation as HTMLElement | null)?.scrollIntoView?.({ block: 'center' });
    (activation as HTMLElement | null)?.click?.();

    const key =
      listingKey ||
      card.getAttribute('data-testid')?.replace(/^job-card-/, '') ||
      undefined;

    const ready = await waitFor(
      () => {
        const lk = new URL(location.href).searchParams.get('lk');
        const lkMatches = !key || lk === key;
        return (detailLooksReady(title) && lkMatches) || detailLooksReady(title);
      },
      { timeoutMs: 12000 },
    );

    return { opened: ready, mode: 'sidebar-click', listingKey: key };
  }

  // Anchor fallback for older layouts
  if (url) {
    const target = canonicalJobUrl(url);
    const anchors = queryAll(document, ['a[href]']).filter(
      (el): el is HTMLAnchorElement => el instanceof HTMLAnchorElement,
    );
    const match = anchors.find((a) => {
      const href = canonicalJobUrl(absoluteUrl(a.getAttribute('href')));
      return href === target || href.includes(target) || target.includes(href);
    });
    if (match) {
      match.click();
      const ready = await waitFor(
        () => detailLooksReady(title) || canonicalJobUrl(location.href) === target,
        { timeoutMs: 12000 },
      );
      return { opened: ready, mode: 'click' };
    }

    location.assign(target);
    return { opened: true, mode: 'navigate' };
  }

  return { opened: false, mode: 'not-found' };
}

async function ensureResultsReady(): Promise<boolean> {
  const loaded = await waitFor(
    () =>
      document.querySelectorAll('article[data-testid^="job-card-"]').length > 0 ||
      discoverJobCards().length > 0 ||
      isResultsPage(),
    { timeoutMs: 12000 },
  );
  if (!loaded) return false;

  const before = discoverJobCards().length;
  const clicked = await clickLoadMoreIfPresent();
  if (clicked) {
    await waitFor(() => discoverJobCards().length > before, { timeoutMs: 4000 });
  }
  return true;
}

chrome.runtime.onMessage.addListener(
  (message: ExtensionMessage, _sender, sendResponse) => {
    void (async () => {
      try {
        switch (message.type) {
          case 'CONTENT_PING': {
            sendResponse(
              respond({
                ok: true,
                url: location.href,
                isResultsPage: isResultsPage(),
                challenge: detectChallenge(),
                jobCardCount: document.querySelectorAll('article[data-testid^="job-card-"]').length,
              }),
            );
            break;
          }
          case 'CONTENT_DETECT_CHALLENGE': {
            sendResponse(respond({ challenge: detectChallenge() }));
            break;
          }
          case 'CONTENT_PAGE_INFO': {
            await ensureResultsReady();
            const jobs = discoverJobCards();
            const pagination = detectPagination();
            sendResponse(
              respond({
                url: location.href,
                isResultsPage: isResultsPage(),
                challenge: detectChallenge(),
                pageNumber: pagination.currentPage ?? getCurrentPageNumberFromUrl(),
                jobCount: jobs.length,
                pagination,
              }),
            );
            break;
          }
          case 'CONTENT_DISCOVER_JOBS': {
            await ensureResultsReady();
            const jobs: JobCardSummary[] = discoverJobCards();
            sendResponse(
              respond({
                jobs,
                pageNumber: detectPagination().currentPage ?? getCurrentPageNumberFromUrl(),
                url: location.href,
                challenge: detectChallenge(),
              }),
            );
            break;
          }
          case 'CONTENT_OPEN_JOB': {
            const payload = (message.payload ?? {}) as {
              url?: string;
              listingKey?: string;
              jobId?: string;
              title?: string;
            };
            if (!payload.url && !payload.listingKey && !payload.jobId && !payload.title) {
              sendResponse(respond({ opened: false, error: 'Missing job identifier' }));
              break;
            }
            const result = await openJob(payload);
            await sleep(250);
            await waitFor(() => detailLooksReady(payload.title) || detectChallenge(), {
              timeoutMs: 10000,
            });
            sendResponse(
              respond({
                ...result,
                url: location.href,
                challenge: detectChallenge(),
                ready: detailLooksReady(payload.title),
              }),
            );
            break;
          }
          case 'CONTENT_EXTRACT_DETAIL': {
            const payload = (message.payload ?? {}) as {
              searchResultsUrl?: string;
              pageNumber?: number | null;
              fallbackUrl?: string;
              listingKey?: string;
              title?: string;
            };
            const ready = await waitFor(
              () => detailLooksReady(payload.title) || detectChallenge(),
              { timeoutMs: 12000 },
            );
            if (detectChallenge()) {
              sendResponse(respond({ challenge: true, job: null }));
              break;
            }
            if (!ready) {
              sendResponse(
                respond({
                  challenge: false,
                  job: null,
                  error: 'Job detail did not become ready in time.',
                }),
              );
              break;
            }
            const job = extractJobDetail(payload);
            sendResponse(respond({ challenge: false, job }));
            break;
          }
          case 'CONTENT_GO_BACK': {
            // Split-view UI keeps users on the results page; only navigate when needed.
            if (isResultsPage() && discoverJobCards().length > 0) {
              sendResponse(respond({ ok: true, url: location.href, mode: 'already-on-results' }));
              break;
            }
            const target = String((message.payload as { url?: string })?.url ?? '');
            if (target) {
              if (canonicalJobUrl(location.href) !== canonicalJobUrl(target)) {
                location.assign(target);
              }
            } else {
              history.back();
            }
            const ok = await waitFor(
              () =>
                discoverJobCards().length > 0 ||
                document.querySelectorAll('article[data-testid^="job-card-"]').length > 0,
              { timeoutMs: 15000 },
            );
            sendResponse(respond({ ok, url: location.href }));
            break;
          }
          case 'CONTENT_PAGINATE': {
            const beforeUrl = location.href;
            const result = await goToNextPage();
            if (result.success) {
              await waitFor(
                () =>
                  location.href !== beforeUrl ||
                  (detectPagination().currentPage ?? 0) !== (result.pagination.currentPage ?? 0),
                { timeoutMs: 15000 },
              );
              await waitFor(
                () => document.querySelectorAll('article[data-testid^="job-card-"]').length > 0,
                { timeoutMs: 15000 },
              );
            }
            sendResponse(
              respond({
                ...result,
                url: location.href,
                pageNumber: detectPagination().currentPage ?? getCurrentPageNumberFromUrl(),
                jobCount: discoverJobCards().length,
                challenge: detectChallenge(),
              }),
            );
            break;
          }
          default:
            sendResponse(respond({ error: `Unhandled content message: ${message.type}` }));
        }
      } catch (error) {
        sendResponse({
          error: error instanceof Error ? error.message : String(error),
        });
      }
    })();
    return true;
  },
);

void chrome.runtime
  .sendMessage({
    type: 'CONTENT_PING',
    payload: { url: location.href, ready: true },
  })
  .catch(() => {
    // Background may be inactive; ignore
  });
