import { useEffect, useMemo, useState } from 'react';
import { createDefaultState, onStateChanged } from '@/storage/session-store';
import type { ExtensionMessage, ExtensionState, SessionStatus } from '@/types/job';

async function sendMessage<T = ExtensionState>(
  type: ExtensionMessage['type'],
  payload?: unknown,
): Promise<T> {
  return (await chrome.runtime.sendMessage({ type, payload })) as T;
}

function formatStatus(status: SessionStatus): string {
  return status.charAt(0).toUpperCase() + status.slice(1);
}

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  } catch {
    return '';
  }
}

export function Popup() {
  const [state, setState] = useState<ExtensionState>(createDefaultState());
  const [siteStatus, setSiteStatus] = useState('Checking active tab…');
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  const session = state.session;
  const jobCount = Object.keys(state.jobs).length;

  const progress = useMemo(() => {
    const total = Math.max(session.jobsDiscovered, 1);
    const done = session.jobsProcessed;
    return Math.min(100, Math.round((done / total) * 1000) / 10);
  }, [session.jobsDiscovered, session.jobsProcessed]);

  useEffect(() => {
    let mounted = true;

    void (async () => {
      try {
        const next = await sendMessage<ExtensionState>('GET_STATE');
        if (mounted && next?.session) setState(next);
      } catch (error) {
        if (mounted) {
          setLocalError(error instanceof Error ? error.message : String(error));
        }
      }

      try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        const url = tab?.url ?? '';
        if (!url) setSiteStatus('No active tab');
        else if (!/ziprecruiter\.com/i.test(url)) setSiteStatus('Not on ZipRecruiter');
        else if (/candidate\/search|jobs-search|[?&]search=/i.test(url)) {
          setSiteStatus('ZipRecruiter search results');
        } else setSiteStatus('ZipRecruiter (verify results page)');
      } catch {
        setSiteStatus('Unable to read active tab');
      }
    })();

    const unsubscribe = onStateChanged((next) => {
      if (mounted) setState(next);
    });

    const listener = (message: ExtensionMessage) => {
      if (message.type === 'STATE_UPDATED' && message.payload) {
        setState(message.payload as ExtensionState);
      }
    };
    chrome.runtime.onMessage.addListener(listener);

    return () => {
      mounted = false;
      unsubscribe();
      chrome.runtime.onMessage.removeListener(listener);
    };
  }, []);

  async function run(action: ExtensionMessage['type'], confirmClear = false) {
    if (confirmClear) {
      const ok = window.confirm(
        'Clear all collected jobs and reset the scraping session? This cannot be undone.',
      );
      if (!ok) return;
    }

    setBusy(true);
    setLocalError(null);
    try {
      const result = await sendMessage<ExtensionState & { error?: string; ok?: boolean }>(action);
      if (result?.error) setLocalError(result.error);
      if (result?.session) setState(result);
      else if (action !== 'EXPORT_CSV') {
        const next = await sendMessage<ExtensionState>('GET_STATE');
        if (next?.session) setState(next);
      }
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  const isRunning = session.status === 'running';
  const isPaused = session.status === 'paused' || session.status === 'error';
  const canStart = !isRunning && session.status !== 'stopping';
  const canPause = isRunning;
  const canResume = isPaused;
  const canStop = isRunning || isPaused || session.status === 'stopping';
  const canExport = jobCount > 0 && !busy;
  const canClear = (jobCount > 0 || session.status !== 'idle') && !isRunning;

  return (
    <div className="popup">
      <header className="header">
        <h1>ZipRecruiter Job Extractor</h1>
        <p>Extract listings sequentially and export CSV.</p>
      </header>

      <section className="panel">
        <div className="status-row">
          <span className={`badge ${session.status}`}>{formatStatus(session.status)}</span>
          <span className="site-status">{siteStatus}</span>
        </div>

        <div className="stats">
          <div className="stat">
            <span className="label">Current page</span>
            <span className="value">{session.currentPage ?? '—'}</span>
          </div>
          <div className="stat">
            <span className="label">Jobs discovered</span>
            <span className="value">{session.jobsDiscovered}</span>
          </div>
          <div className="stat">
            <span className="label">Jobs processed</span>
            <span className="value">{session.jobsProcessed}</span>
          </div>
          <div className="stat">
            <span className="label">Successfully extracted</span>
            <span className="value">{session.jobsExtracted}</span>
          </div>
          <div className="stat">
            <span className="label">Failed / skipped</span>
            <span className="value">
              {session.jobsFailed} / {session.jobsSkipped}
            </span>
          </div>
          <div className="stat">
            <span className="label">Stored jobs</span>
            <span className="value">{jobCount}</span>
          </div>
        </div>

        <div className="progress">
          <div className="progress-bar" aria-label="Progress">
            <span style={{ width: `${progress}%` }} />
          </div>
          <div className="progress-meta">
            <span>Progress: {progress}%</span>
            <span>
              Queue: {session.pendingJobUrls.length}
            </span>
          </div>
        </div>

        <div className="current-job">
          <strong>Current job:</strong>{' '}
          {session.currentJobTitle || session.currentJobUrl || '—'}
        </div>

        {(session.lastError || localError) && (
          <div className="error-box">{localError || session.lastError}</div>
        )}
      </section>

      <section className="controls">
        <button
          className="primary"
          disabled={!canStart || busy}
          onClick={() => void run('START_SCRAPING')}
        >
          Start Scraping
        </button>
        <button disabled={!canPause || busy} onClick={() => void run('PAUSE_SCRAPING')}>
          Pause
        </button>
        <button disabled={!canResume || busy} onClick={() => void run('RESUME_SCRAPING')}>
          Resume
        </button>
        <button disabled={!canStop || busy} onClick={() => void run('STOP_SCRAPING')}>
          Stop
        </button>
        <button disabled={!canExport} onClick={() => void run('EXPORT_CSV')}>
          Export CSV
        </button>
        <button
          className="danger"
          disabled={!canClear || busy}
          onClick={() => void run('CLEAR_DATA', true)}
        >
          Clear Data
        </button>
      </section>

      {!canExport && (
        <div className="panel empty-log">
          Export CSV is disabled until at least one job has been collected.
        </div>
      )}

      <section className="panel log">
        <h2>Activity</h2>
        {session.activityLog.length === 0 ? (
          <div className="empty-log">No activity yet. Open a ZipRecruiter results page and start scraping.</div>
        ) : (
          [...session.activityLog]
            .slice()
            .reverse()
            .slice(0, 40)
            .map((entry) => (
              <div key={entry.id} className={`log-item ${entry.level}`}>
                <span className="time">{formatTime(entry.timestamp)}</span>
                {entry.message}
              </div>
            ))
        )}
      </section>
    </div>
  );
}
