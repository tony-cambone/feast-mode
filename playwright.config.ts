import { defineConfig } from '@playwright/test';

const PORT = 5174;

// Uses the installed Google Chrome (channel: 'chrome'), so no browser download is needed.
export default defineConfig({
  testDir: 'e2e',
  timeout: 20 * 60_000,
  expect: { timeout: 15_000 },
  reporter: [['list']],
  use: {
    channel: 'chrome',
    baseURL: `http://localhost:${PORT}`,
    viewport: { width: 1440, height: 900 },
    permissions: ['notifications'],
    trace: 'retain-on-failure',
  },
  webServer: {
    command: `npx vite build --outDir dist-e2e --emptyOutDir && npx vite preview --outDir dist-e2e --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
