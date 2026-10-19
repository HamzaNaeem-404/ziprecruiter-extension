import { describe, expect, it } from 'vitest';
import {
  dedupeJobs,
  escapeCsvValue,
  formatCsvFilename,
  jobsToCsv,
} from '@/export/csv-exporter';
import { createEmptyJobRecord } from '@/types/job';

describe('csv escaping', () => {
  it('escapes commas, quotes, and newlines', () => {
    expect(escapeCsvValue('plain')).toBe('plain');
    expect(escapeCsvValue('a,b')).toBe('"a,b"');
    expect(escapeCsvValue('say "hi"')).toBe('"say ""hi"""');
    expect(escapeCsvValue('line1\nline2')).toBe('"line1\nline2"');
  });

  it('builds a BOM-prefixed CSV with headers', () => {
    const csv = jobsToCsv([
      createEmptyJobRecord({
        job_id: '1',
        job_title: 'Engineer, II',
        job_description: 'Line 1\nLine 2',
      }),
    ]);
    expect(csv.startsWith('\uFEFF')).toBe(true);
    expect(csv).toContain('job_id');
    expect(csv).toContain('"Engineer, II"');
    expect(csv).toContain('"Line 1\nLine 2"');
  });

  it('formats filenames', () => {
    const name = formatCsvFilename(new Date('2026-10-16T15:04:00'));
    expect(name).toMatch(/^ziprecruiter_jobs_\d{4}-\d{2}-\d{2}_\d{2}-\d{2}\.csv$/);
  });
});

describe('duplicate detection for export', () => {
  it('dedupes by job id and keeps richer records', () => {
    const a = createEmptyJobRecord({ job_id: 'x', job_title: 'A', company_name: '' });
    const b = createEmptyJobRecord({
      job_id: 'x',
      job_title: 'A',
      company_name: 'Acme',
      job_description: 'Full text',
    });
    const deduped = dedupeJobs([a, b]);
    expect(deduped).toHaveLength(1);
    expect(deduped[0]?.company_name).toBe('Acme');
  });
});
