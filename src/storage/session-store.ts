import {
  createDefaultSession,
  type ActivityLogEntry,
  type ExtensionState,
  type JobRecord,
  type ScrapingSession,
  type SessionStatus,
} from '@/types/job';

const STORAGE_KEY = 'ziprecruiterExtractorState';
const MAX_LOG_ENTRIES = 80;

let writeQueue: Promise<void> = Promise.resolve();

export function createDefaultState(): ExtensionState {
  return {
    session: createDefaultSession(),
    jobs: {},
  };
}

export async function getState(): Promise<ExtensionState> {
  const result = await chrome.storage.local.get(STORAGE_KEY);
  const stored = result?.[STORAGE_KEY] as ExtensionState | undefined;
  if (!stored?.session) return createDefaultState();
  return {
    session: {
      ...createDefaultSession(),
      ...stored.session,
      pendingJobs: stored.session.pendingJobs ?? [],
    },
    jobs: stored.jobs ?? {},
  };
}

export async function setState(state: ExtensionState): Promise<ExtensionState> {
  const next: ExtensionState = {
    session: {
      ...state.session,
      updatedAt: new Date().toISOString(),
      activityLog: state.session.activityLog.slice(-MAX_LOG_ENTRIES),
    },
    jobs: state.jobs,
  };

  writeQueue = writeQueue.then(async () => {
    await chrome.storage.local.set({ [STORAGE_KEY]: next });
  });
  await writeQueue;
  return next;
}

export async function updateSession(
  updater: (session: ScrapingSession, jobs: Record<string, JobRecord>) => {
    session?: ScrapingSession;
    jobs?: Record<string, JobRecord>;
  },
): Promise<ExtensionState> {
  const current = await getState();
  const patch = updater(current.session, current.jobs);
  return setState({
    session: patch.session ?? current.session,
    jobs: patch.jobs ?? current.jobs,
  });
}

export async function appendLog(
  message: string,
  level: ActivityLogEntry['level'] = 'info',
): Promise<ExtensionState> {
  return updateSession((session) => ({
    session: {
      ...session,
      activityLog: [
        ...session.activityLog,
        {
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          timestamp: new Date().toISOString(),
          message,
          level,
        },
      ],
    },
  }));
}

export async function setSessionStatus(
  status: SessionStatus,
  lastError: string | null = null,
): Promise<ExtensionState> {
  return updateSession((session) => ({
    session: {
      ...session,
      status,
      lastError: lastError ?? (status === 'error' ? session.lastError : null),
    },
  }));
}

export async function upsertJob(job: JobRecord): Promise<ExtensionState> {
  const key = job.job_id || job.job_url;
  if (!key) return getState();

  return updateSession((session, jobs) => {
    const existing = jobs[key];
    const nextJobs = {
      ...jobs,
      [key]: existing ? { ...existing, ...job, job_id: existing.job_id || job.job_id } : job,
    };
    return { jobs: nextJobs, session };
  });
}

export async function clearAllData(): Promise<ExtensionState> {
  const next = createDefaultState();
  await chrome.storage.local.set({ [STORAGE_KEY]: next });
  return next;
}

export function getJobKey(jobId: string, jobUrl: string): string {
  return jobId || jobUrl;
}

export function isDuplicateJob(
  jobs: Record<string, JobRecord>,
  processedIds: string[],
  jobId: string,
  jobUrl: string,
): boolean {
  const key = getJobKey(jobId, jobUrl);
  if (processedIds.includes(key) || processedIds.includes(jobId) || processedIds.includes(jobUrl)) {
    return true;
  }
  return Boolean(jobs[key] || jobs[jobId] || jobs[jobUrl]);
}

export function onStateChanged(callback: (state: ExtensionState) => void): () => void {
  const listener = (
    changes: { [key: string]: chrome.storage.StorageChange },
    areaName: string,
  ) => {
    if (areaName !== 'local' || !changes[STORAGE_KEY]) return;
    const next = changes[STORAGE_KEY].newValue as ExtensionState | undefined;
    callback(next ?? createDefaultState());
  };
  chrome.storage.onChanged.addListener(listener);
  return () => chrome.storage.onChanged.removeListener(listener);
}
