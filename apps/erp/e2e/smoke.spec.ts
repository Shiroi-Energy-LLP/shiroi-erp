import { test, expect } from '@playwright/test';
import { loginIfCredentialsPresent } from './helpers/auth';

/**
 * Smoke tests — 9 critical paths:
 *   1. /login renders
 *   2. Founder dashboard renders after login
 *   3. /leads loads without 500
 *   4. /projects loads without 500
 *   5. /price-book loads without 500
 *   6. /om/plant-monitoring loads without 500
 *   7. /procurement workspace list renders after login (Apr 17 Purchase v2)
 *   8. /vendor-portal/rfq/<bogus-token> renders the "Invalid link" state
 *      without any server-side crash. Public route — no auth.
 *   9. /procurement/project/<any>?tab=comparison renders (empty state when
 *      no awards exist).
 *
 * Tests 2–7 and 9 require authentication. They are `test.skip()`-ed when
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

// ═══════════════════════════════════════════════════════════════════════
// Test 7: /procurement (purchase module v2 — Apr 17)
// ═══════════════════════════════════════════════════════════════════════
test('procurement workspace list renders', async ({ page }) => {
  const authed = await loginIfCredentialsPresent(page);
  test.skip(!authed, 'PLAYWRIGHT_LOGIN_EMAIL/_PASSWORD not set');

  await page.goto('/procurement');
  // The list page always says "Procurement" somewhere in chrome or heading.
  await expect(page.locator('body')).toContainText(/procurement/i);
  await expectNoDevErrorOverlay(page);
});

// ═══════════════════════════════════════════════════════════════════════
// Test 8: /vendor-portal/rfq/<bogus-token> — public, no auth required
// ═══════════════════════════════════════════════════════════════════════
//
// This exercises the fact that validateToken() must gracefully handle a
// well-formed-but-unknown UUID without throwing. The Apr 17 Purchase v2
// release added this public route; a regression here would block every
// vendor from responding to an RFQ.
test('vendor portal renders invalid-link state for unknown token', async ({ page }) => {
  // Deliberately bogus but well-shaped UUID.
  const bogusToken = '00000000-0000-0000-0000-000000000000';
  await page.goto(`/vendor-portal/rfq/${bogusToken}`);
  // Either "Invalid link" or "Link expired" is acceptable — both mean the
  // page rendered the error state instead of crashing.
  await expect(page.locator('body')).toContainText(/invalid link|link expired|not valid/i);
  await expectNoDevErrorOverlay(page);
});

// ═══════════════════════════════════════════════════════════════════════
// Test 10: /vendor-bills (Finance V2 — Apr 18)
// ═══════════════════════════════════════════════════════════════════════
test('vendor bills page renders', async ({ page }) => {
  const authed = await loginIfCredentialsPresent(page);
  test.skip(!authed, 'PLAYWRIGHT_LOGIN_EMAIL/_PASSWORD not set');

  await page.goto('/vendor-bills');
  await expect(page.locator('body')).toContainText(/vendor bill/i);
  await expectNoDevErrorOverlay(page);
});

// ═══════════════════════════════════════════════════════════════════════
// Test 11: /profitability renders V2 RPC output (Finance V2 — Apr 18)
// ═══════════════════════════════════════════════════════════════════════
test('profitability V2 page renders', async ({ page }) => {
  const authed = await loginIfCredentialsPresent(page);
  test.skip(!authed, 'PLAYWRIGHT_LOGIN_EMAIL/_PASSWORD not set');

  await page.goto('/profitability');
  await expect(page.locator('body')).toContainText(/profitability/i);
  await expectNoDevErrorOverlay(page);
});

// ═══════════════════════════════════════════════════════════════════════
// Test 12: /cash renders Zoho V2 summary panel (Finance V2 — Apr 18)
// ═══════════════════════════════════════════════════════════════════════
test('cash page renders with Zoho V2 panel', async ({ page }) => {
  const authed = await loginIfCredentialsPresent(page);
  test.skip(!authed, 'PLAYWRIGHT_LOGIN_EMAIL/_PASSWORD not set');

  await page.goto('/cash');
  await expect(page.locator('body')).toContainText(/cash/i);
  await expectNoDevErrorOverlay(page);
});

// ═══════════════════════════════════════════════════════════════════════
// Test 9: Procurement project comparison tab renders (empty state is fine)
// ═══════════════════════════════════════════════════════════════════════
//
// We navigate to /procurement, click the first project row if any, then
// hop to the comparison tab. If no projects exist we fall back to the
// list page assertion — the point is that the server component in
// tab-comparison.tsx doesn't crash when no awards are present.
test('procurement comparison tab renders (empty or populated)', async ({ page }) => {
  const authed = await loginIfCredentialsPresent(page);
  test.skip(!authed, 'PLAYWRIGHT_LOGIN_EMAIL/_PASSWORD not set');

  await page.goto('/procurement');
  await expectNoDevErrorOverlay(page);

  // Look for any /procurement/project/<uuid> link on the page.
  const firstProjectLink = page.locator('a[href^="/procurement/project/"]').first();
  const hasAnyProject = await firstProjectLink.count();

  if (hasAnyProject === 0) {
    // No projects in this dev DB — list page renders fine, that's enough.
    await expect(page.locator('body')).toContainText(/procurement/i);
    return;
  }

  const href = await firstProjectLink.getAttribute('href');
  // Load the comparison tab directly.
  await page.goto(`${href}?tab=comparison`);
  // Either the comparison matrix renders, or the empty state does — both
  // mean the server component didn't crash.
  await expect(page.locator('body')).toContainText(/compare|comparison|purchase workspace/i);
  await expectNoDevErrorOverlay(page);
});

// ═══════════════════════════════════════════════════════════════════════
// Test: /settings page renders (auth required)
// ═══════════════════════════════════════════════════════════════════════
test('settings page renders after login', async ({ page }) => {
  const authed = await loginIfCredentialsPresent(page);
  test.skip(!authed, 'PLAYWRIGHT_LOGIN_EMAIL/_PASSWORD not set');

  await page.goto('/settings');
  // Use .first() to avoid strict-mode violation: the topbar also renders
  // an <h1>Settings</h1> on this route, so two headings match the name.
  await expect(page.getByRole('heading', { name: 'Settings' }).first()).toBeVisible({ timeout: 10_000 });
  await expect(page.getByRole('tab', { name: /account/i })).toBeVisible();
  await expect(page.getByRole('tab', { name: /feedback/i })).toBeVisible();
  await expectNoDevErrorOverlay(page);
});

// ═══════════════════════════════════════════════════════════════════════
// Test: profile menu opens from topbar and exposes Settings + Sign out
// ═══════════════════════════════════════════════════════════════════════
test('profile menu dropdown reaches settings', async ({ page }) => {
  const authed = await loginIfCredentialsPresent(page);
  test.skip(!authed, 'PLAYWRIGHT_LOGIN_EMAIL/_PASSWORD not set');

  await page.goto('/');
  await page.getByRole('button', { name: /open profile menu/i }).click();
  await expect(page.getByRole('menuitem', { name: /settings/i })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: /sign out/i })).toBeVisible();
  await page.getByRole('menuitem', { name: /settings/i }).click();
  await expect(page).toHaveURL(/\/settings/, { timeout: 10_000 });
  await expectNoDevErrorOverlay(page);
});

// ═══════════════════════════════════════════════════════════════════════
// Test: feedback tab form validation — submit disabled under 10 chars
// ═══════════════════════════════════════════════════════════════════════
test('feedback form blocks submit under 10 characters', async ({ page }) => {
  const authed = await loginIfCredentialsPresent(page);
  test.skip(!authed, 'PLAYWRIGHT_LOGIN_EMAIL/_PASSWORD not set');

  await page.goto('/settings');
  await page.getByRole('tab', { name: /feedback/i }).click();
  await page.getByLabel(/description/i).fill('short');
  const submit = page.getByRole('button', { name: /submit report/i });
  await expect(submit).toBeDisabled();
  await page.getByLabel(/description/i).fill('This is a long enough description.');
  await expect(submit).toBeEnabled();
  await expectNoDevErrorOverlay(page);
});
