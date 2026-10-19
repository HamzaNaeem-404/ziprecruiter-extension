export type WorkplaceType = 'Remote' | 'Hybrid' | 'Onsite' | 'Unknown';
export type EmploymentType =
  | 'Full-time'
  | 'Part-time'
  | 'Contract'
  | 'Temporary'
  | 'Unknown';
export type SalaryUnit = 'Hourly' | 'Monthly' | 'Annually' | 'Unknown';
export type ApplicationType = 'Quick Apply' | 'External Application' | 'Unknown';
export type ScrapeStatus = 'success' | 'partial' | 'failed' | 'skipped';

export type SessionStatus =
  | 'idle'
  | 'running'
  | 'paused'
  | 'stopping'
  | 'completed'
  | 'error';

export interface JobRecord {
  job_id: string;
  job_title: string;
  company_name: string;
  job_location: string;
  workplace_type: WorkplaceType;
  employment_type: EmploymentType;
  salary_min: string;
  salary_max: string;
  salary_currency: string;
  salary_unit: SalaryUnit;
  salary_display: string;
  benefits: string;
  posted_date: string;
  posted_relative: string;
  application_type: ApplicationType;
  job_description: string;
  responsibilities: string;
  required_qualifications: string;
  preferred_qualifications: string;
  education_requirements: string;
  experience_requirements: string;
  skills: string;
  programming_languages: string;
  frameworks_and_libraries: string;
  databases: string;
  cloud_platforms: string;
  tools_and_technologies: string;
  job_url: string;
  search_results_url: string;
  company_industry: string;
  company_size: string;
  company_headquarters: string;
  company_website: string;
  company_summary: string;
  recruiter_or_agency: string;
  contract_duration: string;
  application_deadline: string;
  workplace_details: string;
  job_category: string;
  scraped_at: string;
  scrape_status: ScrapeStatus;
  extraction_errors: string;
  page_number: number | '';
  source_platform: string;
}

export interface JobCardSummary {
  jobId: string;
  title: string;
  company: string;
  url: string;
  /** ZipRecruiter listing key used in data-testid / ?lk= */
  listingKey?: string;
  location?: string;
  salaryDisplay?: string;
  quickApply?: boolean;
}

export interface PaginationState {
  currentPage: number | null;
  hasNext: boolean;
  nextPage: number | null;
  isFinalPage: boolean;
  nextHref: string | null;
}

export interface ActivityLogEntry {
  id: string;
  timestamp: string;
  message: string;
  level: 'info' | 'success' | 'warn' | 'error';
}

export interface ScrapingSession {
  status: SessionStatus;
  searchResultsUrl: string;
  currentPage: number | null;
  discoveredJobIds: string[];
  pendingJobUrls: string[];
  pendingJobs: JobCardSummary[];
  processedJobIds: string[];
  currentJobUrl: string | null;
  currentJobTitle: string | null;
  lastProcessedJobId: string | null;
  jobsDiscovered: number;
  jobsProcessed: number;
  jobsExtracted: number;
  jobsFailed: number;
  jobsSkipped: number;
  lastError: string | null;
  activityLog: ActivityLogEntry[];
  tabId: number | null;
  startedAt: string | null;
  updatedAt: string | null;
}

export interface ExtensionState {
  session: ScrapingSession;
  jobs: Record<string, JobRecord>;
}

export type MessageType =
  | 'GET_STATE'
  | 'STATE_UPDATED'
  | 'START_SCRAPING'
  | 'PAUSE_SCRAPING'
  | 'RESUME_SCRAPING'
  | 'STOP_SCRAPING'
  | 'CLEAR_DATA'
  | 'EXPORT_CSV'
  | 'CONTENT_PING'
  | 'CONTENT_DISCOVER_JOBS'
  | 'CONTENT_EXTRACT_DETAIL'
  | 'CONTENT_OPEN_JOB'
  | 'CONTENT_GO_BACK'
  | 'CONTENT_PAGINATE'
  | 'CONTENT_PAGE_INFO'
  | 'CONTENT_DETECT_CHALLENGE'
  | 'SCRAPE_TICK';

export interface ExtensionMessage<T = unknown> {
  type: MessageType;
  payload?: T;
}

export const JOB_CSV_FIELDS: (keyof JobRecord)[] = [
  'job_id',
  'job_title',
  'company_name',
  'job_location',
  'workplace_type',
  'employment_type',
  'salary_min',
  'salary_max',
  'salary_currency',
  'salary_unit',
  'salary_display',
  'benefits',
  'posted_date',
  'posted_relative',
  'application_type',
  'job_description',
  'responsibilities',
  'required_qualifications',
  'preferred_qualifications',
  'education_requirements',
  'experience_requirements',
  'skills',
  'programming_languages',
  'frameworks_and_libraries',
  'databases',
  'cloud_platforms',
  'tools_and_technologies',
  'job_url',
  'search_results_url',
  'company_industry',
  'company_size',
  'company_headquarters',
  'company_website',
  'company_summary',
  'recruiter_or_agency',
  'contract_duration',
  'application_deadline',
  'workplace_details',
  'job_category',
  'scraped_at',
  'scrape_status',
  'extraction_errors',
  'page_number',
  'source_platform',
];

export function createEmptyJobRecord(partial: Partial<JobRecord> = {}): JobRecord {
  return {
    job_id: '',
    job_title: '',
    company_name: '',
    job_location: '',
    workplace_type: 'Unknown',
    employment_type: 'Unknown',
    salary_min: '',
    salary_max: '',
    salary_currency: '',
    salary_unit: 'Unknown',
    salary_display: '',
    benefits: '',
    posted_date: '',
    posted_relative: '',
    application_type: 'Unknown',
    job_description: '',
    responsibilities: '',
    required_qualifications: '',
    preferred_qualifications: '',
    education_requirements: '',
    experience_requirements: '',
    skills: '',
    programming_languages: '',
    frameworks_and_libraries: '',
    databases: '',
    cloud_platforms: '',
    tools_and_technologies: '',
    job_url: '',
    search_results_url: '',
    company_industry: '',
    company_size: '',
    company_headquarters: '',
    company_website: '',
    company_summary: '',
    recruiter_or_agency: '',
    contract_duration: '',
    application_deadline: '',
    workplace_details: '',
    job_category: '',
    scraped_at: new Date().toISOString(),
    scrape_status: 'partial',
    extraction_errors: '',
    page_number: '',
    source_platform: 'ZipRecruiter',
    ...partial,
  };
}

export function createDefaultSession(): ScrapingSession {
  return {
    status: 'idle',
    searchResultsUrl: '',
    currentPage: null,
    discoveredJobIds: [],
    pendingJobUrls: [],
    pendingJobs: [],
    processedJobIds: [],
    currentJobUrl: null,
    currentJobTitle: null,
    lastProcessedJobId: null,
    jobsDiscovered: 0,
    jobsProcessed: 0,
    jobsExtracted: 0,
    jobsFailed: 0,
    jobsSkipped: 0,
    lastError: null,
    activityLog: [],
    tabId: null,
    startedAt: null,
    updatedAt: null,
  };
}
