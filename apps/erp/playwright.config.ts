import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright config for Shiroi ERP smoke tests.
 *
 * Two run modes:
 *   1. CI / headless — runs against the dev server started by webServer
 *      below. No auth unless PLAYWRIGHT_LOGIN_EMAIL + _PASSWORD env vars
 *      are set; auth-required tests call test.skip() when they're missing.
 *   2. Local — `pnpm test:e2e` from apps/erp starts the dev server if
 *      not already running and runs against localhost:3000.
 *
 * Install browsers once (one-time per dev machine):
 *   pnpm --filter @repo/erp exec playwright install chromium
 *
 * Run smoke tests:
 *   pnpm --filter @repo/erp test:e2e
 */
export default defineConfig({
  testDir: './e2e',
  // Generous timeout — the ERP has some slow-loading list pages (leads, projects)
  timeout: 30_000,
  expect: { timeout: 5_000 },

  // Fail fast in CI; be forgiving locally
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 1 : undefined,

  // No HTML report in CI — keep the output small
  reporter: process.env.CI ? 'list' : [['html', { open: 'never' }]],

  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000',
    // Only take screenshots + traces on failure to keep artifacts small
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    // Standard user agent — avoid being flagged as a bot
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  // Auto-start the Next.js dev server for local runs. In CI, the
  // caller should start + wait for it separately (so the test can
  // run against a built app, not a dev server).
  webServer: process.env.CI
    ? undefined
    : {
        command: 'pnpm dev',
        url: 'http://localhost:3000',
        reuseExistingServer: true,
        timeout: 120_000,
      },
});
