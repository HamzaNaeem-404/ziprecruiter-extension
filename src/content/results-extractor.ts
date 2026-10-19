import { SELECTORS } from '@/content/selectors';
import type { JobCardSummary } from '@/types/job';
import { absoluteUrl, attrOf, queryAll, queryFirst, textOf } from '@/utils/dom';
import { canonicalJobUrl, extractJobIdFromUrl, normalizeWhitespace } from '@/utils/parsing';

interface JsonLdListItem {
  '@type'?: string;
  position?: string | number;
  name?: string;
  url?: string;
}

function parseItemListJobs(doc: Document = document): Array<{ title: string; url: string; jid: string }> {
  const scripts = Array.from(doc.querySelectorAll('script[type="application/ld+json"]'));
  const jobs: Array<{ title: string; url: string; jid: string }> = [];

  for (const script of scripts) {
    try {
      const parsed = JSON.parse(script.textContent ?? '') as {
        '@type'?: string;
        itemListElement?: JsonLdListItem[];
      };
      const types = Array.isArray(parsed?.['@type'])
        ? parsed['@type']
        : [parsed?.['@type']].filter(Boolean);
      if (!types.map(String).some((t) => t.toLowerCase() === 'itemlist')) continue;

      for (const item of parsed.itemListElement ?? []) {
        const url = item?.url ? canonicalJobUrl(item.url) : '';
        if (!url) continue;
        jobs.push({
          title: normalizeWhitespace(item.name ?? ''),
          url,
          jid: extractJobIdFromUrl(url),
        });
      }
    } catch {
      // ignore malformed blocks
    }
  }
  return jobs;
}

function listingKeyFromTestId(value: string | null | undefined): string {
  if (!value) return '';
  return value
    .replace(/^job-card-item-/, '')
    .replace(/^job-card-/, '')
    .trim();
}

function cardSummaryFromArticle(
  card: Element,
  index: number,
  jsonLdJobs: Array<{ title: string; url: string; jid: string }>,
): JobCardSummary | null {
  const testId = attrOf(card, 'data-testid') || attrOf(card.closest('li'), 'data-testid');
  const listingKey = listingKeyFromTestId(testId);
  const activation = queryFirst(card, SELECTORS.results.jobActivation as unknown as string[]);
  const titleEl = queryFirst(card, SELECTORS.results.title as unknown as string[]);

  const title =
    normalizeWhitespace(attrOf(titleEl, 'aria-label')) ||
    normalizeWhitespace(textOf(titleEl)) ||
    normalizeWhitespace(attrOf(activation, 'aria-label').replace(/^View\s+/i, '')) ||
    normalizeWhitespace(textOf(activation));

  const company = normalizeWhitespace(
    textOf(queryFirst(card, SELECTORS.results.company as unknown as string[])),
  );

  const cardText = normalizeWhitespace(card.textContent ?? '');
  const locationMatch = cardText.match(
    /([A-Za-z .'-]+,\s*[A-Z]{2})\s*[·•]\s*(Remote|Hybrid|On-?site(?:\s*\+\d+)?)/i,
  );
  const jobLocation = locationMatch
    ? normalizeWhitespace(`${locationMatch[1]} · ${locationMatch[2]}`)
    : '';

  const salaryMatch = cardText.match(/(\$[\d,.]+(?:\s*-\s*\$?[\d,.]+)?(?:\s*[Kk])?(?:\s*\/\s*(?:hr|yr|mo))?)/);
  const salaryDisplay = salaryMatch?.[1] ?? '';

  const jsonMatch =
    jsonLdJobs[index] ??
    jsonLdJobs.find((j) => j.title && title && j.title.toLowerCase() === title.toLowerCase());

  const url =
    jsonMatch?.url ||
    (listingKey
      ? canonicalJobUrl(`${window.location.origin}/jobs-search?lk=${listingKey}`)
      : '');
  const jobId = jsonMatch?.jid || listingKey || extractJobIdFromUrl(url);
  if (!jobId && !url && !title) return null;

  const quickApply = /quick\s*apply/i.test(cardText);

  return {
    jobId: jobId || listingKey || url,
    listingKey: listingKey || undefined,
    title,
    company,
    url: url || `https://www.ziprecruiter.com/jobs-search?lk=${listingKey}`,
    location: jobLocation || undefined,
    salaryDisplay: salaryDisplay || undefined,
    quickApply,
  };
}

function looksLikeJobHref(href: string): boolean {
  if (!href) return false;
  try {
    const url = new URL(href, location.href);
    const hostOk =
      /ziprecruiter\.com$/i.test(url.hostname) ||
      url.hostname === 'localhost' ||
      url.hostname === '127.0.0.1' ||
      url.origin === location.origin;
    if (!hostOk) return false;
    return (
      /\/(jobs?|ojob|ogk)\//i.test(url.pathname) ||
      /\/c\/[^/]+\/Job\//i.test(url.pathname) ||
      url.searchParams.has('lvk') ||
      url.searchParams.has('jid') ||
      url.searchParams.has('lk') ||
      /\/job\//i.test(url.pathname)
    );
  } catch {
    return /\/(jobs?|ojob|ogk|Job)\//i.test(href) || /[?&](jid|lk|lvk)=/i.test(href);
  }
}

function cardFromLink(link: HTMLAnchorElement): JobCardSummary | null {
  const href = absoluteUrl(link.getAttribute('href'));
  if (!looksLikeJobHref(href)) return null;

  let card: Element | null = null;
  try {
    card = link.closest('article[data-testid^="job-card-"], li[data-testid^="job-card-item-"], article, li');
  } catch {
    card = link.parentElement;
  }

  const listingKey = listingKeyFromTestId(
    attrOf(card, 'data-testid') || attrOf(card?.closest('li'), 'data-testid'),
  );
  const title =
    textOf(queryFirst(card ?? link, SELECTORS.results.title as unknown as string[])) ||
    textOf(link) ||
    attrOf(link, 'aria-label');
  const company = textOf(queryFirst(card ?? document, SELECTORS.results.company as unknown as string[]));
  const url = canonicalJobUrl(href);
  const jobId = extractJobIdFromUrl(url) || listingKey;

  return {
    jobId: jobId || url,
    listingKey: listingKey || undefined,
    title: normalizeWhitespace(title),
    company: normalizeWhitespace(company),
    url,
    quickApply: /quick\s*apply/i.test(card?.textContent ?? ''),
  };
}

export function discoverJobCards(root: ParentNode = document): JobCardSummary[] {
  const jsonLdJobs = parseItemListJobs(document);
  const byKey = new Map<string, JobCardSummary>();

  const articles = queryAll(root, ['article[data-testid^="job-card-"]']);
  if (articles.length === 0) {
    // Older layouts may use different card wrappers
    queryAll(root, SELECTORS.results.jobCards as unknown as string[]).forEach((card) => {
      if (card.tagName === 'LI' && card.querySelector('article')) return;
      articles.push(card);
    });
  }

  articles.forEach((card, index) => {
    const summary = cardSummaryFromArticle(card, index, jsonLdJobs);
    if (!summary) return;
    const key = summary.listingKey || summary.jobId || summary.url;
    if (!byKey.has(key)) byKey.set(key, summary);
  });

  // Fallback: classic anchor-based cards
  if (byKey.size === 0) {
    const links = queryAll(root, SELECTORS.results.jobLinks as unknown as string[]).filter(
      (el): el is HTMLAnchorElement => el instanceof HTMLAnchorElement,
    );
    for (const link of links) {
      const summary = cardFromLink(link);
      if (!summary) continue;
      const key = summary.listingKey || summary.jobId || summary.url;
      if (!byKey.has(key)) byKey.set(key, summary);
    }
  }

  // Final fallback: JSON-LD only
  if (byKey.size === 0) {
    jsonLdJobs.forEach((job, index) => {
      byKey.set(job.jid || job.url || String(index), {
        jobId: job.jid || job.url,
        title: job.title,
        company: '',
        url: job.url,
      });
    });
  }

  return [...byKey.values()];
}

export function isResultsPage(doc: Document = document): boolean {
  const path = location.pathname.toLowerCase();
  const hasCards =
    Boolean(doc.querySelector('article[data-testid^="job-card-"]')) ||
    Boolean(doc.querySelector('ul[aria-label="Job listings"]')) ||
    discoverJobCards(doc).length > 0;
  const looksLikeSearch =
    path.includes('/candidate/search') ||
    path.includes('/jobs-search') ||
    path.includes('/jobs/') ||
    /[?&]search=/.test(location.href) ||
    Boolean(doc.querySelector('[data-testid="job-results"], #job_results, .job_results'));

  return hasCards || looksLikeSearch;
}

export function getCurrentPageNumberFromUrl(url = location.href): number | null {
  try {
    const parsed = new URL(url);
    const pathMatch = parsed.pathname.match(/\/jobs-search\/(\d+)\/?/i);
    if (pathMatch?.[1]) {
      const n = Number.parseInt(pathMatch[1], 10);
      return Number.isFinite(n) ? n : null;
    }
    const page = parsed.searchParams.get('page');
    if (!page) return 1;
    const n = Number.parseInt(page, 10);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

export function pageHasJobListings(): boolean {
  return discoverJobCards().length > 0;
}

export function findJobCardElement(options: {
  listingKey?: string;
  jobId?: string;
  url?: string;
  title?: string;
}): Element | null {
  const { listingKey, jobId, title } = options;
  if (listingKey) {
    const byKey =
      document.querySelector(`article[data-testid="job-card-${listingKey}"]`) ||
      document.querySelector(`li[data-testid="job-card-item-${listingKey}"]`);
    if (byKey) return byKey.tagName === 'LI' ? byKey.querySelector('article') ?? byKey : byKey;
  }

  const cards = discoverJobCards();
  const match = cards.find(
    (c) =>
      (listingKey && c.listingKey === listingKey) ||
      (jobId && (c.jobId === jobId || c.listingKey === jobId)) ||
      (title && c.title.toLowerCase() === title.toLowerCase()),
  );
  if (match?.listingKey) {
    return (
      document.querySelector(`article[data-testid="job-card-${match.listingKey}"]`) ||
      document.querySelector(`li[data-testid="job-card-item-${match.listingKey}"]`)
    );
  }
  return null;
}
