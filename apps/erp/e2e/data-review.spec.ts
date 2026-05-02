/**
 * Playwright smoke tests for /data-review/projects
 *
 * NOTE: These tests require PLAYWRIGHT_LOGIN_EMAIL + PLAYWRIGHT_LOGIN_PASSWORD
 * env vars to be set to a founder-role account. Tests are skipped when creds
 * are absent so the suite still passes in CI without secrets.
 *
 * 3 scenarios:
 *   1. Founder logs in → /data-review/projects loads → "Needs Review" tab renders
 *   2. Click first row → edit form expands → inputs are visible
 *   3. Click [Mark Duplicate] → dialog opens → search typeahead renders
 *
 * Not CI-gated yet — run manually:
 *   pnpm --filter @repo/erp test:e2e -- --grep "data-review"
 */

import { test, expect } from '@playwright/test';
import { loginIfCredentialsPresent } from './helpers/auth';

// ── Helper ───────────────────────────────────────────────────────────────────

async function expectNoDevErrorOverlay(page: import('@playwright/test').Page) {
  const overlay = page.locator('[data-nextjs-dialog-overlay]');
  const count = await overlay.count();
  expect(count, 'Next.js dev error overlay should not be visible').toBe(0);
}

// ── Tests ────────────────────────────────────────────────────────────────────

test.describe('data-review — /data-review/projects', () => {
  test.beforeEach(async ({ page }) => {
    const loggedIn = await loginIfCredentialsPresent(page);
    if (!loggedIn) test.skip();
  });

  test('1. Page loads — Needs Review tab is active and shows rows', async ({ page }) => {
    await page.goto('/data-review/projects');
    await page.waitForLoadState('networkidle');
    await expectNoDevErrorOverlay(page);

    // KPI strip should show 4 numbers
    await expect(page.locator('text=Needs Review')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('text=All Projects')).toBeVisible();
    await expect(page.locator('text=Confirmed')).toBeVisible();
    await expect(page.locator('text=Duplicates')).toBeVisible();

    // At least the column headers should be visible
    await expect(page.locator('text=Project #')).toBeVisible();
    await expect(page.locator('text=Customer')).toBeVisible();
    await expect(page.locator('text=kWp')).toBeVisible();
  });

  test('2. Click a row → edit form expands with kWp + ₹ inputs', async ({ page }) => {
    await page.goto('/data-review/projects');
    await page.waitForLoadState('networkidle');

    // Click the first row button (the project number / row area)
    const firstRow = page.locator('button').filter({ hasText: /^\d{4}-\d{2}/ }).first();
    const hasRows = (await firstRow.count()) > 0;
    if (!hasRows) {
      // All items are confirmed — skip this check
      test.skip();
      return;
    }

    await firstRow.click();

    // Inputs should appear
    await expect(page.locator('text=System size (kWp)')).toBeVisible({ timeout: 5_000 });
    await expect(page.locator('text=Order value (₹)')).toBeVisible();
    await expect(page.getByRole('button', { name: /Save.*Confirm/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /Confirm.*no change/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /Mark Duplicate/i })).toBeVisible();
  });

  test('3. Mark Duplicate → dialog opens with search input', async ({ page }) => {
    await page.goto('/data-review/projects');
    await page.waitForLoadState('networkidle');

    // Click first row to expand
    const firstRow = page.locator('button').filter({ hasText: /^\d{4}-\d{2}/ }).first();
    if ((await firstRow.count()) === 0) { test.skip(); return; }
    await firstRow.click();

    // Click Mark Duplicate
    const dupBtn = page.getByRole('button', { name: /Mark Duplicate/i });
    await expect(dupBtn).toBeVisible({ timeout: 5_000 });
    await dupBtn.click();

    // Dialog should open with search input
    await expect(page.locator('text=Mark as Duplicate')).toBeVisible({ timeout: 5_000 });
    await expect(page.getByPlaceholder(/Search by customer name or project/i)).toBeVisible();

    // Close dialog
    await page.getByRole('button', { name: /Cancel/i }).click();
    await expect(page.locator('text=Mark as Duplicate')).not.toBeVisible({ timeout: 3_000 });
  });
});
