import { defineConfig } from '@playwright/test';
const deploymentURL = process.env.PLAYWRIGHT_BASE_URL;
const browserName = process.env.PLAYWRIGHT_BROWSER || 'chromium';
export default defineConfig({
  testDir: './tests',
  testMatch: 'browser.spec.mjs',
  workers: 1,
  timeout: 180000,
  expect: { timeout: 20000 },
  use: {
    baseURL: deploymentURL || 'http://127.0.0.1:4173',
    browserName,
    channel:
      browserName === 'chromium' && !process.env.CI ? 'chrome' : undefined,
    viewport: { width: 1440, height: 1000 },
    trace: 'retain-on-failure',
  },
  webServer: deploymentURL
    ? undefined
    : {
        command: 'npm run preview -- --port 4173 --strictPort',
        url: 'http://127.0.0.1:4173',
        reuseExistingServer: !process.env.CI,
        timeout: 30000,
      },
});
