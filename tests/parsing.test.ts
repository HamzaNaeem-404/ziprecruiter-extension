import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { extractJobDetail } from '@/content/detail-extractor';
import { discoverJobCards } from '@/content/results-extractor';
import {
  detectApplicationType,
  detectEmploymentType,
  detectWorkplaceType,
  extractBenefits,
  parseSalary,
} from '@/utils/parsing';

function loadFixture(name: string): string {
  const html = readFileSync(resolve(__dirname, 'fixtures', name), 'utf8');
  const bodyMatch = html.match(/<body[^>]*>([\s\S]*)<\/body>/i);
  const headMatch = html.match(/<head[^>]*>([\s\S]*)<\/head>/i);
  document.head.innerHTML = headMatch?.[1] ?? '';
  return bodyMatch?.[1] ?? html;
}

describe('salary parsing', () => {
  it('parses annual ranges', () => {
    const parsed = parseSalary('$140,000 - $170,000/yr');
    expect(parsed.salary_min).toBe('140000');
    expect(parsed.salary_max).toBe('170000');
    expect(parsed.salary_currency).toBe('USD');
    expect(parsed.salary_unit).toBe('Annually');
    expect(parsed.salary_display).toContain('140,000');
  });

  it('parses hourly contract ranges', () => {
    const parsed = parseSalary('$60 - $87/hr');
    expect(parsed.salary_min).toBe('60');
    expect(parsed.salary_max).toBe('87');
    expect(parsed.salary_unit).toBe('Hourly');
  });

  it('handles missing salary', () => {
    const parsed = parseSalary('');
    expect(parsed.salary_min).toBe('');
    expect(parsed.salary_unit).toBe('Unknown');
  });
});

describe('type detection', () => {
  it('detects employment types', () => {
    expect(detectEmploymentType('Full-time')).toBe('Full-time');
    expect(detectEmploymentType('part time contractor')).toBe('Part-time');
    expect(detectEmploymentType('Contract role')).toBe('Contract');
    expect(detectEmploymentType('Temporary assignment')).toBe('Temporary');
    expect(detectEmploymentType('')).toBe('Unknown');
  });

  it('detects workplace types', () => {
    expect(detectWorkplaceType('Remote')).toBe('Remote');
    expect(detectWorkplaceType('Hybrid - 3 days')).toBe('Hybrid');
    expect(detectWorkplaceType('On-site in Austin')).toBe('Onsite');
    expect(detectWorkplaceType('')).toBe('Unknown');
  });

  it('detects application types', () => {
    expect(detectApplicationType('Quick Apply')).toBe('Quick Apply');
    expect(detectApplicationType('Apply on company site')).toBe('External Application');
  });
});

describe('benefits extraction', () => {
  it('dedupes and joins benefits', () => {
    expect(extractBenefits(['Medical', ' Dental ', 'Medical', ''])).toBe('Medical; Dental');
  });

  it('extracts benefits from fixture', () => {
    document.body.innerHTML = loadFixture('job-benefits.html');
    const job = extractJobDetail();
    expect(job.benefits).toContain('Medical');
    expect(job.benefits).toContain('Vision');
    expect(job.benefits).toContain('Unlimited PTO');
    expect(job.benefits.split('; ')).toHaveLength(4);
  });
});

describe('detail extraction fixtures', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('extracts a detailed job description with JSON-LD', () => {
    document.body.innerHTML = loadFixture('job-detail.html');
    const job = extractJobDetail({
      searchResultsUrl: 'https://www.ziprecruiter.com/jobs-search?search=engineer',
      pageNumber: 1,
    });
    expect(job.job_title).toBe('Software Engineer II');
    expect(job.company_name).toBe('Acme Corp');
    expect(job.job_location).toContain('San Francisco');
    expect(job.employment_type).toBe('Full-time');
    expect(job.workplace_type).toBe('Hybrid');
    expect(job.application_type).toBe('Quick Apply');
    expect(job.salary_min).toBeTruthy();
    expect(job.programming_languages).toMatch(/TypeScript|JavaScript/);
    expect(job.frameworks_and_libraries).toContain('React');
    expect(job.scrape_status).toBe('success');
  });

  it('handles jobs with no salary', () => {
    document.body.innerHTML = loadFixture('job-no-salary.html');
    const job = extractJobDetail();
    expect(job.job_title).toBe('Office Coordinator');
    expect(job.salary_display).toBe('');
    expect(job.salary_min).toBe('');
    expect(job.application_type).toBe('External Application');
    expect(job.workplace_type).toBe('Onsite');
  });

  it('handles remote contract hourly roles', () => {
    document.body.innerHTML = loadFixture('job-remote-contract-hourly.html');
    const job = extractJobDetail();
    expect(job.workplace_type).toBe('Remote');
    expect(job.employment_type).toBe('Contract');
    expect(job.salary_unit).toBe('Hourly');
    expect(job.salary_min).toBe('60');
    expect(job.salary_max).toBe('87');
  });
});

describe('results discovery', () => {
  it('discovers job cards', () => {
    document.body.innerHTML = loadFixture('job-card.html');
    const jobs = discoverJobCards();
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.title).toBe('Software Engineer II');
    expect(jobs[0]?.company).toBe('Acme Corp');
    expect(jobs[0]?.listingKey).toBe('lk123ABC');
    expect(jobs[0]?.url).toContain('jid=abc123xyz');
    expect(jobs[0]?.jobId).toBe('abc123xyz');
    expect(jobs[0]?.quickApply).toBe(true);
  });

  it('still finds links when selectors change', () => {
    document.body.innerHTML = loadFixture('changed-selectors.html');
    const jobs = discoverJobCards();
    expect(jobs.length).toBeGreaterThanOrEqual(1);
    expect(jobs[0]?.url).toMatch(/ojob|ziprecruiter|mystery-role/i);
  });
});
