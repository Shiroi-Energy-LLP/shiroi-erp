import { test, expect } from '@playwright/test';
import { loginIfCredentialsPresent } from './helpers/auth';

/**
 * Smoke tests for /om/inverters (Phase 7 — inverter management UI).
 *
 * Requires PLAYWRIGHT_LOGIN_EMAIL + PLAYWRIGHT_LOGIN_PASSWORD to be set
 * to a founder-role account. Tests are skipped when creds are absent.
 */

async function expectNoDevErrorOverlay(page: import('@playwright/test').Page) {
  const overlay = page.locator('[data-nextjs-dialog-overlay]');
  const count = await overlay.count();
  expect(count, 'Next.js dev error overlay should not be visible').toBe(0);
}

// ═══════════════════════════════════════════════════════════════════════
// Test 1: founder can open /om/inverters and see the Add CTA
// ═══════════════════════════════════════════════════════════════════════
test('founder can open /om/inverters and see Add CTA', async ({ page }) => {
  const authed = await loginIfCredentialsPresent(page);
  test.skip(!authed, 'PLAYWRIGHT_LOGIN_EMAIL/_PASSWORD not set');

  await page.goto('/om/inverters');

  await expect(page.getByRole('heading', { name: 'Inverters' })).toBeVisible({ timeout: 10_000 });
  await expect(page.getByRole('button', { name: /add inverter/i })).toBeVisible();
  await expectNoDevErrorOverlay(page);
});

// ═══════════════════════════════════════════════════════════════════════
// Test 2: Add Inverter dialog opens and shows required fields
// ═══════════════════════════════════════════════════════════════════════
test('Add Inverter dialog opens with required fields', async ({ page }) => {
  const authed = await loginIfCredentialsPresent(page);
  test.skip(!authed, 'PLAYWRIGHT_LOGIN_EMAIL/_PASSWORD not set');

  await page.goto('/om/inverters');
  await page.getByRole('button', { name: /add inverter/i }).click();

  // Dialog should be visible with title
  await expect(page.getByRole('dialog')).toBeVisible({ timeout: 5_000 });
  await expect(page.getByText('Add Inverter')).toBeVisible();

  // Required fields should be present
  await expect(page.getByLabel(/serial number/i)).toBeVisible();
  await expect(page.getByLabel(/rated capacity/i)).toBeVisible();

  // Cancel closes the dialog
  await page.getByRole('button', { name: /cancel/i }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();

  await expectNoDevErrorOverlay(page);
});

// ═══════════════════════════════════════════════════════════════════════
// Test 3: /om/inverters redirects unauthenticated users to /login
// ═══════════════════════════════════════════════════════════════════════
test('/om/inverters redirects when not logged in', async ({ page }) => {
  // Navigate without logging in — should redirect to /login
  await page.goto('/om/inverters');
  await expect(page).toHaveURL(/\/login/, { timeout: 10_000 });
});
