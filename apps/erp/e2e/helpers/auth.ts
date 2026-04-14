import type { Page } from '@playwright/test';

/**
 * Sign in via the existing /login page. Requires two env vars:
 *   PLAYWRIGHT_LOGIN_EMAIL
 *   PLAYWRIGHT_LOGIN_PASSWORD
 *
 * These should point at a dedicated test user in dev Supabase:
 *   test-founder@shiroi.dev / <dev-only password>
 *
 * Tests that need auth should call `await loginIfCredentialsPresent(page)`
 * in their beforeEach hook. Tests that call `loginOrSkip(test, page)`
 * will test.skip() entirely when creds are missing — used for
 * authenticated-only smoke paths.
 */
export async function loginIfCredentialsPresent(page: Page): Promise<boolean> {
  const email = process.env.PLAYWRIGHT_LOGIN_EMAIL;
  const password = process.env.PLAYWRIGHT_LOGIN_PASSWORD;

  if (!email || !password) {
    return false;
  }

  await page.goto('/login');
  // Wait for the login form to render
  await page.waitForSelector('input[type="email"]', { timeout: 10_000 });
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', password);
  await page.getByRole('button', { name: /sign in|log in/i }).click();
  // Wait for redirect away from /login
  await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 15_000 });
  return true;
}
