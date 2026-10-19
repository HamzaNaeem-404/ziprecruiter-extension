import { SELECTORS } from '@/content/selectors';
import {
  createEmptyJobRecord,
  type JobRecord,
  type ScrapeStatus,
} from '@/types/job';
import { attrOf, queryAll, queryFirst, textOf } from '@/utils/dom';
import {
  canonicalJobUrl,
  detectApplicationType,
  detectEmploymentType,
  detectWorkplaceType,
  extractBenefits,
  extractJobIdFromUrl,
  extractTechSignals,
  joinList,
  normalizeWhitespace,
  parseSalary,
  sectionByHeading,
} from '@/utils/parsing';

interface JsonLdJobPosting {
  '@type'?: string | string[];
  title?: string;
  description?: string;
  datePosted?: string;
  employmentType?: string | string[];
  hiringOrganization?: { name?: string; sameAs?: string; description?: string };
  jobLocation?:
    | {
        address?: {
          addressLocality?: string;
          addressRegion?: string;
          addressCountry?: string;
        };
      }
    | Array<{
        address?: {
          addressLocality?: string;
          addressRegion?: string;
          addressCountry?: string;
        };
      }>;
  baseSalary?: {
    currency?: string;
    value?: { minValue?: number | string; maxValue?: number | string; unitText?: string; value?: number | string };
  };
  identifier?: { value?: string } | string;
  url?: string;
}

function asArray<T>(value: T | T[] | undefined): T[] {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function parseJsonLdJobPostings(doc: Document = document): JsonLdJobPosting[] {
  const scripts = Array.from(
    doc.querySelectorAll('script[type="application/ld+json"]'),
  );
  const postings: JsonLdJobPosting[] = [];

  for (const script of scripts) {
    try {
      const parsed = JSON.parse(script.textContent ?? '');
      const stack = Array.isArray(parsed) ? parsed : [parsed];
      for (const node of stack) {
        if (!node) continue;
        if (node['@graph']) {
          stack.push(...asArray(node['@graph']));
          continue;
        }
        const types = asArray(node['@type']).map((t) => String(t).toLowerCase());
        if (types.includes('jobposting')) postings.push(node as JsonLdJobPosting);
      }
    } catch {
      // Ignore malformed JSON-LD blocks
    }
  }
  return postings;
}

function locationFromJsonLd(posting: JsonLdJobPosting): string {
  const locs = asArray(posting.jobLocation);
  const parts: string[] = [];
  for (const loc of locs) {
    const address = loc?.address;
    if (!address) continue;
    const chunk = [address.addressLocality, address.addressRegion, address.addressCountry]
      .filter(Boolean)
      .join(', ');
    if (chunk) parts.push(chunk);
  }
  return joinList(parts, '; ');
}

function salaryFromJsonLd(posting: JsonLdJobPosting): Partial<JobRecord> {
  const base = posting.baseSalary;
  if (!base) return {};
  const value = base.value;
  const min = value?.minValue ?? value?.value ?? '';
  const max = value?.maxValue ?? value?.value ?? '';
  const unitRaw = String(value?.unitText ?? '').toLowerCase();
  let salary_unit: JobRecord['salary_unit'] = 'Unknown';
  if (unitRaw.includes('hour')) salary_unit = 'Hourly';
  else if (unitRaw.includes('month')) salary_unit = 'Monthly';
  else if (unitRaw.includes('year') || unitRaw.includes('annual')) salary_unit = 'Annually';

  const displayParts = [min, max].filter((v) => v !== '' && v !== undefined);
  const salary_display = displayParts.length
    ? `${base.currency ? `${base.currency} ` : ''}${displayParts.join(' - ')}${unitRaw ? ` / ${unitRaw}` : ''}`
    : '';

  return {
    salary_min: min === undefined || min === null ? '' : String(min),
    salary_max: max === undefined || max === null ? '' : String(max),
    salary_currency: base.currency ?? '',
    salary_unit,
    salary_display: normalizeWhitespace(salary_display),
  };
}

function extractEmbeddedStateJob(doc: Document = document): Partial<JobRecord> {
  const scripts = Array.from(doc.querySelectorAll('script'));
  for (const script of scripts) {
    const text = script.textContent ?? '';
    if (!text.includes('jobTitle') && !text.includes('JobPosting')) continue;
    try {
      const jsonMatch = text.match(/\{[\s\S]*"jobTitle"[\s\S]*\}/);
      if (!jsonMatch?.[0]) continue;
      const data = JSON.parse(jsonMatch[0]) as Record<string, unknown>;
      return {
        job_title: String(data.jobTitle ?? data.title ?? ''),
        company_name: String(
          (data.companyName as string) ??
            (data.company as { name?: string })?.name ??
            '',
        ),
        job_description: String(data.jobDescription ?? data.description ?? ''),
      };
    } catch {
      // Continue scanning
    }
  }
  return {};
}

export function detectChallenge(doc: Document = document): boolean {
  // If job listings/details are already usable, ignore overlay widgets.
  const hasUsableJobs =
    Boolean(doc.querySelector('article[data-testid^="job-card-"]')) ||
    Boolean(doc.querySelector('[data-testid="job-details"]')) ||
    Boolean(doc.querySelector('ul[aria-label="Job listings"]'));
  if (hasUsableJobs) return false;

  for (const selector of SELECTORS.challenge) {
    try {
      if (doc.querySelector(selector)) return true;
    } catch {
      // ignore invalid selectors
    }
  }

  const bodyText = textOf(doc.body).slice(0, 2000);
  return /verify you are (a )?human|unusual traffic|are you a robot|please complete the security check|checking your browser/i.test(
    bodyText,
  );
}

function extractDescriptionFromDetailsPanel(details: Element | null): string {
  if (!details) return '';
  const headings = Array.from(details.querySelectorAll('h2, h3'));
  const descHeading = headings.find((h) => /job description/i.test(textOf(h)));
  if (descHeading?.parentElement) {
    const clone = descHeading.parentElement.cloneNode(true) as HTMLElement;
    // Drop noisy chrome inside the panel clone when possible
    clone.querySelectorAll('button, svg, [data-testid="report-job-trigger"]').forEach((n) => n.remove());
    const text = normalizeWhitespace(clone.innerText || clone.textContent || '');
    const clipped = text.replace(/^[\s\S]*?Job description\s*/i, '').trim();
    if (clipped.length > 40) return clipped;
  }
  return normalizeWhitespace(details.textContent ?? '');
}

function parseCompanyFacts(factsRoot: Element | null): {
  industry: string;
  size: string;
  headquarters: string;
} {
  const text = factsRoot?.textContent ?? '';
  const industry = text.match(/Industry\s*([^\n]+)/i)?.[1]?.trim() ?? '';
  const size = text.match(/Company size\s*([^\n]+)/i)?.[1]?.trim() ?? '';
  const headquarters = text.match(/Headquarters location\s*([^\n]+)/i)?.[1]?.trim() ?? '';
  return { industry, size, headquarters };
}

export function extractJobDetail(options: {
  searchResultsUrl?: string;
  pageNumber?: number | null;
  fallbackUrl?: string;
  listingKey?: string;
} = {}): JobRecord {
  const errors: string[] = [];
  const jsonLd = parseJsonLdJobPostings()[0];
  const embedded = extractEmbeddedStateJob();
  const detailsRoot = queryFirst(document, SELECTORS.detail.container as unknown as string[]);

  const titleEl = queryFirst(detailsRoot ?? document, SELECTORS.detail.title as unknown as string[]);
  const companyEl = queryFirst(detailsRoot ?? document, SELECTORS.detail.company as unknown as string[]);
  const locationEl = queryFirst(detailsRoot ?? document, SELECTORS.detail.location as unknown as string[]);
  const descriptionEl = queryFirst(
    detailsRoot ?? document,
    SELECTORS.detail.description as unknown as string[],
  );
  const salaryEl = queryFirst(detailsRoot ?? document, SELECTORS.detail.salary as unknown as string[]);
  const employmentEl = queryFirst(
    detailsRoot ?? document,
    SELECTORS.detail.employmentType as unknown as string[],
  );
  const workplaceEl = queryFirst(detailsRoot ?? document, SELECTORS.detail.workplace as unknown as string[]);
  const postedEl = queryFirst(detailsRoot ?? document, SELECTORS.detail.posted as unknown as string[]);
  const applyEl = queryFirst(detailsRoot ?? document, SELECTORS.detail.applyButton as unknown as string[]);
  const companySummaryEl = queryFirst(
    detailsRoot ?? document,
    SELECTORS.detail.companySummary as unknown as string[],
  );
  const companyWebsiteEl = queryFirst(
    detailsRoot ?? document,
    SELECTORS.detail.companyWebsite as unknown as string[],
  );
  const factsEl = queryFirst(detailsRoot ?? document, ['[data-testid="company-widget-facts"]']);
  const companyFacts = parseCompanyFacts(factsEl);

  const benefitNodes = queryAll(detailsRoot ?? document, SELECTORS.detail.benefits as unknown as string[]);
  const benefitsFromNodes = extractBenefits(
    benefitNodes.flatMap((n) => textOf(n).split(/[,;|]/).map((part) => part.trim())),
  );

  const detailsText = normalizeWhitespace(detailsRoot?.textContent ?? '');
  const job_title =
    textOf(titleEl) ||
    normalizeWhitespace(jsonLd?.title) ||
    normalizeWhitespace(embedded.job_title);

  const company_name =
    normalizeWhitespace(
      textOf(companyEl?.querySelector?.('span') ?? null) ||
        textOf(companyEl).split('•')[0],
    ) ||
    normalizeWhitespace(jsonLd?.hiringOrganization?.name) ||
    normalizeWhitespace(embedded.company_name);

  const locationFromHeader =
    detailsText.match(/([A-Za-z .'-]+,\s*[A-Z]{2})\s*[•·]\s*(Remote|Hybrid|On-?site(?:\s*\+\d+)?)/i);
  const job_location =
    locationFromJsonLd(jsonLd ?? {}) ||
    (locationFromHeader
      ? normalizeWhitespace(`${locationFromHeader[1]} · ${locationFromHeader[2]}`)
      : '') ||
    textOf(locationEl);

  const descriptionHtml = descriptionEl?.innerHTML ?? '';
  const job_description =
    extractDescriptionFromDetailsPanel(detailsRoot) ||
    normalizeWhitespace(
      (jsonLd?.description ?? '')
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/p>/gi, '\n')
        .replace(/<[^>]+>/g, ' '),
    ) ||
    normalizeWhitespace(embedded.job_description) ||
    normalizeWhitespace(descriptionEl?.textContent ?? '');

  if (!job_title) errors.push('Missing job title');
  if (!job_description) errors.push('Missing job description');

  const salaryDisplay =
    textOf(salaryEl) || salaryFromJsonLd(jsonLd ?? {}).salary_display || '';
  const parsedSalary = parseSalary(salaryDisplay);
  const jsonSalary = salaryFromJsonLd(jsonLd ?? {});

  const employmentSource = joinList([
    textOf(employmentEl),
    ...asArray(jsonLd?.employmentType).map(String),
    detailsText.slice(0, 1500),
  ], ' ');
  const workplaceSource = joinList(
    [textOf(workplaceEl), job_location, detailsText.slice(0, 1500)],
    ' ',
  );

  const posted_date =
    attrOf(postedEl, 'datetime') || normalizeWhitespace(jsonLd?.datePosted) || '';
  const posted_relative = textOf(postedEl);

  const applyText = joinList(
    [textOf(applyEl), attrOf(applyEl, 'aria-label'), detailsText.slice(0, 2000)],
    ' ',
  );
  const application_type =
    detectApplicationType(applyText) !== 'Unknown'
      ? detectApplicationType(applyText)
      : /quick\s*apply/i.test(document.body?.innerText ?? '')
        ? 'Quick Apply'
        : detectApplicationType(applyText);

  const responsibilities = sectionByHeading(job_description, [
    'What you will do',
    'Responsibilities',
    'What You\'ll Do',
    'The Role',
  ]);
  const required_qualifications = sectionByHeading(job_description, [
    'Required qualifications',
    'Requirements',
    'What you need',
    'Minimum Qualifications',
  ]);
  const preferred_qualifications = sectionByHeading(job_description, [
    'Preferred qualifications',
    'Nice to have',
    'Preferred Skills',
  ]);
  const education_requirements = sectionByHeading(job_description, [
    'Education',
    'Education requirements',
  ]);
  const experience_requirements = sectionByHeading(job_description, [
    'Experience',
    'Experience requirements',
  ]);

  const tech = extractTechSignals(`${job_description}\n${descriptionHtml}`);
  const listingKey =
    options.listingKey || new URL(location.href).searchParams.get('lk') || '';
  const jobUrl = canonicalJobUrl(
    options.fallbackUrl ||
      jsonLd?.url ||
      (listingKey ? `${location.origin}${location.pathname}?lk=${listingKey}` : location.href),
  );
  const jobId =
    extractJobIdFromUrl(options.fallbackUrl || '') ||
    (typeof jsonLd?.identifier === 'string'
      ? jsonLd.identifier
      : jsonLd?.identifier?.value) ||
    extractJobIdFromUrl(jobUrl) ||
    listingKey;

  let scrape_status: ScrapeStatus = 'success';
  if (errors.length && (job_title || job_description)) scrape_status = 'partial';
  if (!job_title && !job_description) scrape_status = 'failed';

  return createEmptyJobRecord({
    job_id: jobId,
    job_title,
    company_name,
    job_location,
    workplace_type: detectWorkplaceType(workplaceSource),
    employment_type: detectEmploymentType(employmentSource),
    salary_min: parsedSalary.salary_min || jsonSalary.salary_min || '',
    salary_max: parsedSalary.salary_max || jsonSalary.salary_max || '',
    salary_currency: parsedSalary.salary_currency || jsonSalary.salary_currency || '',
    salary_unit:
      parsedSalary.salary_unit !== 'Unknown'
        ? parsedSalary.salary_unit
        : jsonSalary.salary_unit ?? 'Unknown',
    salary_display: parsedSalary.salary_display || jsonSalary.salary_display || '',
    benefits: benefitsFromNodes,
    posted_date,
    posted_relative,
    application_type,
    job_description,
    responsibilities,
    required_qualifications,
    preferred_qualifications,
    education_requirements,
    experience_requirements,
    skills: tech.skills,
    programming_languages: tech.programming_languages,
    frameworks_and_libraries: tech.frameworks_and_libraries,
    databases: tech.databases,
    cloud_platforms: tech.cloud_platforms,
    tools_and_technologies: tech.tools_and_technologies,
    job_url: jobUrl,
    search_results_url: options.searchResultsUrl ?? '',
    company_industry: companyFacts.industry,
    company_size: companyFacts.size,
    company_headquarters: companyFacts.headquarters,
    company_website:
      attrOf(companyWebsiteEl, 'href') || jsonLd?.hiringOrganization?.sameAs || '',
    company_summary:
      textOf(companySummaryEl) || normalizeWhitespace(jsonLd?.hiringOrganization?.description) || '',
    workplace_details: locationFromHeader?.[2] || textOf(workplaceEl),
    scraped_at: new Date().toISOString(),
    scrape_status,
    extraction_errors: errors.join('; '),
    page_number: options.pageNumber ?? '',
    source_platform: 'ZipRecruiter',
  });
}

export function detailLooksReady(expectedTitle?: string): boolean {
  const details = document.querySelector('[data-testid="job-details"]');
  const title = queryFirst(details ?? document, SELECTORS.detail.title as unknown as string[]);
  const titleText = textOf(title);
  if (expectedTitle && titleText) {
    return titleText.toLowerCase() === expectedTitle.toLowerCase() ||
      titleText.toLowerCase().includes(expectedTitle.toLowerCase()) ||
      expectedTitle.toLowerCase().includes(titleText.toLowerCase());
  }
  const hasDescriptionHeading = Boolean(
    details &&
      Array.from(details.querySelectorAll('h2')).some((h) => /job description/i.test(textOf(h))),
  );
  return Boolean(titleText || hasDescriptionHeading || parseJsonLdJobPostings().length);
}
