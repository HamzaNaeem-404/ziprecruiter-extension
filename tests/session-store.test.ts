import { describe, expect, it } from 'vitest';
import { createDefaultSession, createEmptyJobRecord } from '@/types/job';
import { getJobKey, isDuplicateJob } from '@/storage/session-store';

describe('duplicate detection', () => {
  it('uses job id when available', () => {
    expect(getJobKey('abc', 'https://example.com/job')).toBe('abc');
  });

  it('detects duplicates from processed ids and stored jobs', () => {
    const jobs = {
      abc: createEmptyJobRecord({ job_id: 'abc', job_url: 'https://zr.test/jobs/abc' }),
    };
    expect(isDuplicateJob(jobs, [], 'abc', 'https://zr.test/jobs/abc')).toBe(true);
    expect(isDuplicateJob({}, ['abc'], 'abc', 'https://zr.test/jobs/abc')).toBe(true);
    expect(isDuplicateJob({}, [], 'new', 'https://zr.test/jobs/new')).toBe(false);
  });
});

describe('session-state transitions', () => {
  it('starts idle and can move through expected statuses', () => {
    const session = createDefaultSession();
    expect(session.status).toBe('idle');

    const running = { ...session, status: 'running' as const };
    expect(running.status).toBe('running');

    const paused = { ...running, status: 'paused' as const };
    expect(paused.status).toBe('paused');

    const completed = { ...paused, status: 'completed' as const };
    expect(completed.status).toBe('completed');

    const errored = { ...running, status: 'error' as const, lastError: 'fail' };
    expect(errored.status).toBe('error');
    expect(errored.lastError).toBe('fail');
  });
});
