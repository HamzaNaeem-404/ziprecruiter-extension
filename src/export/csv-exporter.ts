import { JOB_CSV_FIELDS, type JobRecord } from '@/types/job';

export function escapeCsvValue(value: unknown): string {
  const raw = value === null || value === undefined ? '' : String(value);
  const needsQuotes = /[",\n\r]/.test(raw);
  const escaped = raw.replace(/"/g, '""');
  return needsQuotes ? `"${escaped}"` : escaped;
}

export function jobsToCsv(jobs: JobRecord[]): string {
  const header = JOB_CSV_FIELDS.map((field) => escapeCsvValue(field)).join(',');
  const rows = jobs.map((job) =>
    JOB_CSV_FIELDS.map((field) => escapeCsvValue(job[field])).join(','),
  );
  // UTF-8 BOM for Excel compatibility
  return `\uFEFF${[header, ...rows].join('\r\n')}`;
}

export function formatCsvFilename(date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  const stamp = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}_${pad(date.getHours())}-${pad(date.getMinutes())}`;
  return `ziprecruiter_jobs_${stamp}.csv`;
}

export function dedupeJobs(jobs: JobRecord[]): JobRecord[] {
  const map = new Map<string, JobRecord>();
  for (const job of jobs) {
    const key = job.job_id || job.job_url;
    if (!key) continue;
    const existing = map.get(key);
    if (!existing) {
      map.set(key, job);
      continue;
    }
    // Prefer richer records
    const existingScore = Object.values(existing).filter(Boolean).length;
    const nextScore = Object.values(job).filter(Boolean).length;
    if (nextScore >= existingScore) map.set(key, { ...existing, ...job });
  }
  return [...map.values()];
}

export async function downloadCsv(jobs: JobRecord[]): Promise<{ filename: string; count: number }> {
  const unique = dedupeJobs(jobs);
  if (unique.length === 0) {
    throw new Error('No jobs available to export.');
  }

  const csv = jobsToCsv(unique);
  const filename = formatCsvFilename();
  const dataUrl = `data:text/csv;charset=utf-8,${encodeURIComponent(csv)}`;

  await chrome.downloads.download({
    url: dataUrl,
    filename,
    saveAs: true,
  });

  return { filename, count: unique.length };
}
