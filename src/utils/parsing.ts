import type {
  ApplicationType,
  EmploymentType,
  SalaryUnit,
  WorkplaceType,
} from '@/types/job';

export interface ParsedSalary {
  salary_min: string;
  salary_max: string;
  salary_currency: string;
  salary_unit: SalaryUnit;
  salary_display: string;
}

const CURRENCY_SYMBOLS: Record<string, string> = {
  $: 'USD',
  '€': 'EUR',
  '£': 'GBP',
};

export function normalizeWhitespace(value: string | null | undefined): string {
  return (value ?? '').replace(/\s+/g, ' ').trim();
}

export function parseSalary(display: string | null | undefined): ParsedSalary {
  const salary_display = normalizeWhitespace(display);
  if (!salary_display) {
    return {
      salary_min: '',
      salary_max: '',
      salary_currency: '',
      salary_unit: 'Unknown',
      salary_display: '',
    };
  }

  const currencyMatch = salary_display.match(/([$€£]|USD|EUR|GBP)/i);
  let salary_currency = '';
  if (currencyMatch?.[1]) {
    const token = currencyMatch[1];
    salary_currency = CURRENCY_SYMBOLS[token] ?? token.toUpperCase();
  }

  const unit = detectSalaryUnit(salary_display);
  const numbers = [...salary_display.matchAll(/(\d[\d,]*(?:\.\d+)?)\s*(k)?/gi)].map(
    (match) => {
      const raw = match[1]?.replace(/,/g, '') ?? '0';
      const hasK = Boolean(match[2]);
      const num = Number.parseFloat(raw) * (hasK ? 1000 : 1);
      return Number.isFinite(num) ? String(num) : '';
    },
  ).filter(Boolean);

  return {
    salary_min: numbers[0] ?? '',
    salary_max: numbers[1] ?? numbers[0] ?? '',
    salary_currency,
    salary_unit: unit,
    salary_display,
  };
}

export function detectSalaryUnit(text: string): SalaryUnit {
  const value = text.toLowerCase();
  if (/(?:\/\s*hr|per\s*hour|hourly|\bhr\b|\/hour)/i.test(value)) return 'Hourly';
  if (/(?:\/\s*mo|per\s*month|monthly|\/month)/i.test(value)) return 'Monthly';
  if (/(?:\/\s*yr|per\s*year|annually|yearly|\/year|a year)/i.test(value)) {
    return 'Annually';
  }
  return 'Unknown';
}

export function detectEmploymentType(text: string | null | undefined): EmploymentType {
  const value = normalizeWhitespace(text).toLowerCase().replace(/_/g, ' ');
  if (!value) return 'Unknown';
  if (/\bfull[-\s]?time\b/.test(value)) return 'Full-time';
  if (/\bpart[-\s]?time\b/.test(value)) return 'Part-time';
  if (/\bcontract(?:or|ing)?\b/.test(value)) return 'Contract';
  if (/\btemporary\b|\btemp\b|\bintern\b/.test(value)) return 'Temporary';
  return 'Unknown';
}

export function detectWorkplaceType(text: string | null | undefined): WorkplaceType {
  const value = normalizeWhitespace(text).toLowerCase();
  if (!value) return 'Unknown';
  if (/\bhybrid\b/.test(value)) return 'Hybrid';
  if (/\bremote\b|\bwork from home\b|\bwfh\b/.test(value)) return 'Remote';
  if (/\bonsite\b|\bon[-\s]?site\b|\bin[-\s]?office\b|\bin person\b/.test(value)) {
    return 'Onsite';
  }
  return 'Unknown';
}

export function detectApplicationType(text: string | null | undefined): ApplicationType {
  const value = normalizeWhitespace(text).toLowerCase();
  if (!value) return 'Unknown';
  if (/quick\s*apply|1[-\s]?click/i.test(value)) return 'Quick Apply';
  if (/apply\s*on\s*company|external|company site/i.test(value)) {
    return 'External Application';
  }
  return 'Unknown';
}

export function extractBenefits(labels: Array<string | null | undefined>): string {
  const unique = new Set<string>();
  for (const label of labels) {
    const normalized = normalizeWhitespace(label);
    if (normalized) unique.add(normalized);
  }
  return [...unique].join('; ');
}

export function joinList(values: Array<string | null | undefined>, separator = '; '): string {
  return values
    .map((value) => normalizeWhitespace(value))
    .filter(Boolean)
    .filter((value, index, arr) => arr.indexOf(value) === index)
    .join(separator);
}

export function extractJobIdFromUrl(url: string): string {
  try {
    const parsed = new URL(url, 'https://www.ziprecruiter.com');
    const fromQuery =
      parsed.searchParams.get('jid') ??
      parsed.searchParams.get('lk') ??
      parsed.searchParams.get('lvk') ??
      parsed.searchParams.get('job_id') ??
      parsed.searchParams.get('jk');
    if (fromQuery) return fromQuery;

    const modernPath = parsed.pathname.match(/\/c\/[^/]+\/Job\/[^/]+/i);
    if (modernPath) {
      // Prefer jid query when present; otherwise use a stable path slug
      const slug = parsed.pathname.split('/').filter(Boolean).slice(-2).join('/');
      return slug || parsed.pathname;
    }

    const pathMatch = parsed.pathname.match(
      /\/(?:job|jobs|ogk|ojob)\/(?:[^/]+-)?([a-zA-Z0-9_-]{6,})/i,
    );
    if (pathMatch?.[1]) return pathMatch[1];

    return parsed.pathname.replace(/\/+$/, '') || url;
  } catch {
    return url;
  }
}

export function canonicalJobUrl(url: string): string {
  try {
    const parsed = new URL(url, 'https://www.ziprecruiter.com');
    parsed.hash = '';
    ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'ref'].forEach(
      (key) => parsed.searchParams.delete(key),
    );
    return parsed.toString();
  } catch {
    return url;
  }
}

export function isZipRecruiterUrl(url: string | undefined | null): boolean {
  if (!url) return false;
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host === 'www.ziprecruiter.com' || host === 'ziprecruiter.com';
  } catch {
    return false;
  }
}

export function isSearchResultsUrl(url: string | undefined | null): boolean {
  if (!isZipRecruiterUrl(url)) return false;
  try {
    const parsed = new URL(url!);
    const path = parsed.pathname.toLowerCase();
    return (
      path.includes('/jobs-search') ||
      path.includes('/candidate/search') ||
      path.includes('/jobs/') ||
      parsed.searchParams.has('search') ||
      path === '/jobs'
    );
  } catch {
    return false;
  }
}

const PROGRAMMING_LANGUAGES = [
  'JavaScript',
  'TypeScript',
  'Python',
  'Java',
  'C#',
  'C++',
  'Go',
  'Ruby',
  'PHP',
  'Swift',
  'Kotlin',
  'Rust',
  'Scala',
  'SQL',
  'R',
];

const FRAMEWORKS = [
  'React',
  'Angular',
  'Vue',
  'Next.js',
  'Node.js',
  'Django',
  'Flask',
  'Spring',
  'Express',
  '.NET',
  'Rails',
  'Laravel',
  'FastAPI',
];

const DATABASES = [
  'PostgreSQL',
  'MySQL',
  'MongoDB',
  'Redis',
  'Elasticsearch',
  'DynamoDB',
  'Oracle',
  'SQL Server',
  'Cassandra',
];

const CLOUD = ['AWS', 'Azure', 'GCP', 'Google Cloud', 'Heroku', 'Cloudflare'];

const TOOLS = [
  'Docker',
  'Kubernetes',
  'Git',
  'Jenkins',
  'Terraform',
  'Jira',
  'GraphQL',
  'REST',
  'Kafka',
];

function findTerms(text: string, dictionary: string[]): string[] {
  const lower = text.toLowerCase();
  return dictionary.filter((term) => {
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(`(?:^|[^a-z0-9])${escaped}(?:[^a-z0-9]|$)`, 'i');
    return pattern.test(lower);
  });
}

export function extractTechSignals(text: string): {
  programming_languages: string;
  frameworks_and_libraries: string;
  databases: string;
  cloud_platforms: string;
  tools_and_technologies: string;
  skills: string;
} {
  const programming_languages = findTerms(text, PROGRAMMING_LANGUAGES);
  const frameworks_and_libraries = findTerms(text, FRAMEWORKS);
  const databases = findTerms(text, DATABASES);
  const cloud_platforms = findTerms(text, CLOUD);
  const tools_and_technologies = findTerms(text, TOOLS);
  const skills = [
    ...programming_languages,
    ...frameworks_and_libraries,
    ...databases,
    ...cloud_platforms,
    ...tools_and_technologies,
  ];

  return {
    programming_languages: joinList(programming_languages),
    frameworks_and_libraries: joinList(frameworks_and_libraries),
    databases: joinList(databases),
    cloud_platforms: joinList(cloud_platforms),
    tools_and_technologies: joinList(tools_and_technologies),
    skills: joinList(skills),
  };
}

export function sectionByHeading(
  text: string,
  headings: string[],
): string {
  if (!text) return '';
  const normalized = text.replace(/\r\n/g, '\n');
  for (const heading of headings) {
    const pattern = new RegExp(
      `(?:^|\\n)\\s*${heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*:?\\s*\\n([\\s\\S]*?)(?=\\n\\s*[A-Z][A-Za-z0-9 /&-]{2,40}\\s*:?\\s*\\n|$)`,
      'i',
    );
    const match = normalized.match(pattern);
    if (match?.[1]) return normalizeWhitespace(match[1]).replace(/\n+/g, '\n');
  }
  return '';
}
