/**
 * Site-specific selectors for ZipRecruiter (verified against live jobs-search UI).
 *
 * Priority order used by extractors:
 * 1. Structured data (JSON-LD ItemList / JobPosting)
 * 2. Semantic / accessible attributes + data-testid
 * 3. Stable attributes (job ids, canonical links)
 * 4. Text relationships
 * 5. CSS class selectors (last resort)
 */

export const SELECTORS = {
  results: {
    jobList: ['ul[aria-label="Job listings"]', '[aria-label="Job listings"]'],
    jobCards: [
      'article[data-testid^="job-card-"]',
      'li[data-testid^="job-card-item-"]',
      'article[data-testid="job-card"]',
      '[data-testid="job-card"]',
      'article.job_result',
      '.job_result',
      '[data-job-id]',
    ],
    jobCardItems: ['li[data-testid^="job-card-item-"]'],
    jobActivation: [
      'button[data-testid="job-card-activation"]',
      'button[data-testid="job-card-overlay"]',
      'button[aria-label^="View "]',
    ],
    jobLinks: [
      'a[href*="/c/"][href*="/Job/"]',
      'a[href*="jid="]',
      'a[data-testid="job-title-link"]',
      'a[data-tracking="job_title"]',
      'a.job_link',
      'a[href*="/jobs/"]',
      'a[href*="/ojob/"]',
      'a[href*="/job/"]',
    ],
    title: [
      '[data-testid="serp-job-card-title"]',
      '[data-testid="job-card-activation"]',
      '[data-testid="job-title"]',
      'h2.job_title',
      '.job_title',
      'h2',
    ],
    company: [
      'a[href*="/co/"]',
      '[data-testid="company-name"]',
      '.company_name',
      '[itemprop="hiringOrganization"]',
    ],
    location: [
      '[data-testid="job-location"]',
      '.location',
      '[itemprop="jobLocation"]',
    ],
    salary: [
      '[data-testid="salary-row"]',
      '[data-testid="job-salary"]',
      '.salary',
      '[itemprop="baseSalary"]',
    ],
    benefits: [
      '[data-testid="benefits-row"]',
      '[data-testid="job-benefit"]',
      '[data-testid="benefits"] li',
    ],
    posted: [
      '[data-testid="posted-row"]',
      '[data-testid="job-posted"]',
      'time',
      '.posted_time',
    ],
    quickApply: [
      '[data-testid="quick-apply"]',
      '[aria-label="Quick apply"]',
      'img[alt="Quick apply"]',
      '.quick_apply',
      '[data-testid="apply-now-button"]',
    ],
  },
  detail: {
    container: [
      '[data-testid="job-details"]',
      'section[aria-label="Job details"]',
      '#job_details',
      '.job_details',
      '[role="main"]',
    ],
    title: [
      '[data-testid="serp-job-details-title"]',
      'h1[data-testid="job-title"]',
      'h1.job_title',
      'h1[itemprop="title"]',
      'h1',
    ],
    company: [
      '[data-testid="employer-details-header"] span',
      '[data-testid="employer-details-header"]',
      '[data-testid="company-name"]',
      'a.company_name',
      '[itemprop="hiringOrganization"]',
    ],
    location: [
      '[data-testid="job-location"]',
      '[itemprop="jobLocation"]',
      '.location',
    ],
    description: [
      '[data-testid="job-description"]',
      '[itemprop="description"]',
      '.job_description',
      '#job_description',
    ],
    salary: [
      '[data-testid="salary-row"]',
      '[data-testid="job-salary"]',
      '[itemprop="baseSalary"]',
      '.salary',
    ],
    employmentType: [
      '[data-testid="employment-row"]',
      '[itemprop="employmentType"]',
      '[data-testid="employment-type"]',
    ],
    workplace: [
      '[data-testid="workplace-type"]',
      '[data-testid="remote-badge"]',
    ],
    benefits: [
      '[data-testid="benefits-row"]',
      '[data-testid="benefits"] li',
      '[data-testid="job-benefit"]',
    ],
    posted: [
      '[data-testid="posted-row"]',
      'time[datetime]',
      'time',
      '[data-testid="job-posted"]',
    ],
    applyButton: [
      '[data-testid="apply-now-button"]',
      '[data-testid="apply-button"]',
      'button[aria-label*="Apply" i]',
      'button[aria-label*="Quick Apply" i]',
      'button[aria-label="Continue"]',
    ],
    companySummary: [
      '[data-testid="company-widget-description-text"]',
      '[data-testid="company-widget-description"]',
      '[data-testid="company-description"]',
      '[data-testid="about-company"]',
    ],
    companyWebsite: [
      'a[data-testid="company-widget-website"]',
      'a[data-testid="company-website"]',
    ],
    companyIndustry: ['[data-testid="company-widget-facts"]'],
    companySize: ['[data-testid="company-widget-facts"]'],
  },
  pagination: [
    {
      next: [
        'a[aria-label="Next page"]',
        'a[aria-label="Next Page"]',
        'a[aria-label*="Next page" i]',
        'a[aria-label*="Next" i]',
        'button[aria-label*="Next" i]',
        'a[rel="next"]',
        '[data-testid="pagination-next"]',
        'a[title="Next Page"]',
      ],
      pageLinks: [
        'a[href*="/jobs-search/"]',
        'a[aria-label^="Page:"]',
        'nav[aria-label*="pagination" i] a',
        '[data-testid="pagination"] a',
        'a[href*="page="]',
      ],
      activePage: [
        'a[aria-current="page"]',
        '[aria-current="page"]',
        'nav[aria-label*="pagination" i] [aria-current="page"]',
        '.pagination .selected',
        '.pagination .active',
      ],
      loadMore: [
        'button[aria-label*="Load more" i]',
        'button[data-testid="load-more"]',
        'button',
      ],
    },
  ],
  challenge: [
    '#challenge-form',
    '[data-testid="captcha"]',
    'iframe[src*="challenges.cloudflare.com"]',
    'iframe[src*="captcha"]',
    'form[action*="challenge"]',
  ],
} as const;

export const CHALLENGE_TEXT_PATTERNS = [
  /verify you are (a )?human/i,
  /unusual traffic/i,
  /are you a robot/i,
  /captcha/i,
  /access denied/i,
  /please complete the security check/i,
  /checking your browser/i,
];
