# ZipRecruiter Job Extractor

Chrome Extension (Manifest V3) that sequentially extracts structured job data from ZipRecruiter search results and exports collected jobs to CSV.

## Features

- Popup controls: Start, Pause, Resume, Stop, Export CSV, Clear Data
- Sequential one-job-at-a-time processing
- Automatic pagination when the current results page is exhausted
- Persistent session state via `chrome.storage.local` (survives popup close / service worker restarts)
- Duplicate detection by job ID / canonical URL
- CSV export with UTF-8 BOM for Excel compatibility
- Multi-strategy extraction: JSON-LD → semantic attributes → stable links → CSS fallbacks

## Tech stack

- Manifest V3
- TypeScript
- React popup UI
- Vite + `@crxjs/vite-plugin`
- Vitest unit tests

## Setup

```bash
npm install
```

## Development

```bash
npm run dev
```

Load the unpacked extension from the generated `dist/` directory in Chrome (see below). Vite will rebuild on changes.

## Build

```bash
npm run build
```

Production output is written to `dist/`.

## Typecheck & tests

```bash
npm run typecheck
npm test
```

## Install in Chrome

1. Run `npm run build`
2. Open `chrome://extensions/`
3. Enable **Developer mode**
4. Click **Load unpacked**
5. Select the `dist/` folder in this project

## Usage

1. Open a ZipRecruiter job search results page, for example:
   - `https://www.ziprecruiter.com/jobs-search?search=software+engineer&location=Remote`
   - `https://www.ziprecruiter.com/candidate/search?search=React&location=San+Francisco`
2. Click the extension icon to open **ZipRecruiter Job Extractor**
3. Click **Start Scraping**
4. Watch progress in the popup (safe to close — the session continues)
5. Use **Pause** / **Resume** / **Stop** as needed
6. Click **Export CSV** to download collected jobs
7. Use **Clear Data** (with confirmation) to wipe stored jobs and session state

Suggested CSV filename format:

`ziprecruiter_jobs_YYYY-MM-DD_HH-mm.csv`

## Architecture

```text
src/
├── background/service-worker.ts   # Session orchestration (alarm-driven ticks)
├── content/
│   ├── content.ts                 # Message bridge + DOM actions
│   ├── selectors.ts               # Site-specific selectors (update here)
│   ├── results-extractor.ts       # Search results discovery
│   ├── detail-extractor.ts        # Job detail extraction
│   └── pagination.ts              # Next/numbered page handling
├── popup/                         # React UI
├── storage/session-store.ts       # chrome.storage.local persistence
├── export/csv-exporter.ts         # CSV serialization + download
├── types/job.ts                   # Shared data model
└── utils/                         # DOM helpers + parsing
```

Message flow:

1. Popup → service worker (`START_SCRAPING`, `PAUSE`, …)
2. Service worker → content script (discover / open / extract / paginate)
3. Service worker persists jobs + session after each step
4. Storage change events refresh the popup

## Permissions

| Permission | Why |
|---|---|
| `storage` | Persist session + jobs |
| `activeTab` | Interact with the active ZipRecruiter tab |
| `scripting` | Ensure content-script messaging after navigations |
| `downloads` | Save CSV files |
| `alarms` | Restart-safe scrape ticks for the service worker |
| Host: `ziprecruiter.com` | Read/interact with ZipRecruiter pages only |

## Live-site notes (verified)

Current ZipRecruiter `jobs-search` UI uses:

- Job cards: `article[data-testid^="job-card-…"]` with `button[data-testid="job-card-activation"]` (not classic `/jobs/` anchors)
- Listing keys in `data-testid` / `?lk=`
- Canonical URLs from JSON-LD `ItemList` (`/c/.../Job/...?jid=…`)
- Split-view details in `section[data-testid="job-details"]`
- Pagination paths like `/jobs-search/2?...` and `a[aria-label="Next page"]`

If a Cloudflare challenge blocks the page entirely (no job cards), the extension pauses so you can solve it manually. It does not bypass CAPTCHAs or private APIs.

## Notes

- Do not invent missing fields — empty strings are used when data is unavailable.
- Failed jobs are recorded without stopping the whole session.
- Export remains available while paused or after completion.
- Closing the popup does not stop a running session.

## License

Private / local use unless otherwise specified.
