import { test, expect } from '@playwright/test';
import { loginIfCredentialsPresent } from './helpers/auth';

/**
 * Smoke tests — 6 critical paths per the April 14 audit plan:
 *   1. /login renders
 *   2. Founder dashboard renders after login
 *   3. /leads loads without 500
 *   4. /projects loads without 500
 *   5. /price-book loads without 500
 *   6. /om/plant-monitoring loads without 500
 *
 * Tests 2–6 require authentication. They are `test.skip()`-ed when
 * PLAYWRIGHT_LOGIN_EMAIL / _PASSWORD env vars are absent, so the suite
 * still runs green in CI without secrets. Configure these in the
 * GitHub Actions secrets + dev-only .env.playwright file.
 *
 * All tests assert that the page renders a reasonable HTML document
 * and that the dev-mode error overlay is NOT visible — the latter
 * catches server-side render errors that show up as red overlays in
 * Next.js dev mode.
 */

// ═══════════════════════════════════════════════════════════════════════
// Helper: assert the Next.js dev error overlay is not visible
// ═══════════════════════════════════════════════════════════════════════
async function expectNoDevErrorOverlay(page: import('@playwright/test').Page) {
  // Next.js 14 dev error overlay has data-nextjs-dialog-overlay
  const overlay = page.locator('[data-nextjs-dialog-overlay]');
  const count = await overlay.count();
  expect(count, 'Next.js dev error overlay should not be visible').toBe(0);
}

// ═══════════════════════════════════════════════════════════════════════
// Test 1: /login renders (public, no auth)
// ═══════════════════════════════════════════════════════════════════════
test('login page renders', async ({ page }) => {
  await page.goto('/login');
  // Either the form renders, or the page redirected back with a session
  // already present. Both are acceptable end states.
  const emailInput = page.locator('input[type="email"]');
  const dashboardH1 = page.locator('h1', { hasText: /good (morning|afternoon|evening)/i });
  await expect(emailInput.or(dashboardH1).first()).toBeVisible({ timeout: 10_000 });
  await expectNoDevErrorOverlay(page);
});

// ═══════════════════════════════════════════════════════════════════════
// Test 2: Founder dashboard renders
// ═══════════════════════════════════════════════════════════════════════
test('founder dashboard renders after login', async ({ page }) => {
  const authed = await loginIfCredentialsPresent(page);
  test.skip(!authed, 'PLAYWRIGHT_LOGIN_EMAIL/_PASSWORD not set');

  await page.goto('/');
  // Look for the "Good morning/afternoon/evening" header
  await expect(page.locator('h1')).toContainText(/good (morning|afternoon|evening)/i);
  // Pipeline value KPI card should be present
  await expect(page.getByText('Pipeline Value')).toBeVisible();
  await expectNoDevErrorOverlay(page);
});

// ═══════════════════════════════════════════════════════════════════════
// Test 3: /leads
// ═══════════════════════════════════════════════════════════════════════
test('leads page renders', async ({ page }) => {
  const authed = await loginIfCredentialsPresent(page);
  test.skip(!authed, 'PLAYWRIGHT_LOGIN_EMAIL/_PASSWORD not set');

  await page.goto('/leads');
  // Any of: the data table renders, the empty-state card renders, or a
  // known sidebar link is present. We're just checking the page doesn't
  // crash.
  await expect(page.locator('body')).toContainText(/lead/i);
  await expectNoDevErrorOverlay(page);
});

// ═══════════════════════════════════════════════════════════════════════
// Test 4: /projects
// ═══════════════════════════════════════════════════════════════════════
test('projects page renders', async ({ page }) => {
  const authed = await loginIfCredentialsPresent(page);
  test.skip(!authed, 'PLAYWRIGHT_LOGIN_EMAIL/_PASSWORD not set');

  await page.goto('/projects');
  await expect(page.locator('body')).toContainText(/project/i);
  await expectNoDevErrorOverlay(page);
});

// ═══════════════════════════════════════════════════════════════════════
// Test 5: /price-book (a route exercised by migration 045/046)
// ═══════════════════════════════════════════════════════════════════════
test('price book page renders', async ({ page }) => {
  const authed = await loginIfCredentialsPresent(page);
  test.skip(!authed, 'PLAYWRIGHT_LOGIN_EMAIL/_PASSWORD not set');

  await page.goto('/price-book');
  await expect(page.locator('body')).toContainText(/price/i);
  await expectNoDevErrorOverlay(page);
});

// ═══════════════════════════════════════════════════════════════════════
// Test 6: /om/plant-monitoring
// ═══════════════════════════════════════════════════════════════════════
test('plant monitoring page renders', async ({ page }) => {
  const authed = await loginIfCredentialsPresent(page);
  test.skip(!authed, 'PLAYWRIGHT_LOGIN_EMAIL/_PASSWORD not set');

  await page.goto('/om/plant-monitoring');
  await expect(page.locator('body')).toContainText(/plant monitoring/i);
  await expectNoDevErrorOverlay(page);
});
