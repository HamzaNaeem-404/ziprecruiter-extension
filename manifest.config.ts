import { defineManifest } from '@crxjs/vite-plugin';

export default defineManifest({
  manifest_version: 3,
  name: 'ZipRecruiter Job Extractor',
  version: '1.0.0',
  description:
    'Extract structured job listings from ZipRecruiter search results and export them as CSV.',
  action: {
    default_popup: 'src/popup/index.html',
    default_title: 'ZipRecruiter Job Extractor',
  },
  background: {
    service_worker: 'src/background/service-worker.ts',
    type: 'module',
  },
  permissions: ['storage', 'activeTab', 'downloads', 'scripting', 'alarms'],
  host_permissions: ['https://www.ziprecruiter.com/*', 'https://ziprecruiter.com/*'],
  content_scripts: [
    {
      matches: ['https://www.ziprecruiter.com/*', 'https://ziprecruiter.com/*'],
      js: ['src/content/content.ts'],
      run_at: 'document_idle',
    },
  ],
  icons: {
    '16': 'public/icons/icon16.png',
    '48': 'public/icons/icon48.png',
    '128': 'public/icons/icon128.png',
  },
});
