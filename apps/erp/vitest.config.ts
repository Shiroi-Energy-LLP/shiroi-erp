import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    // Playwright owns e2e/ via its own config + runner. Without this exclude
    // vitest tries to load e2e/*.spec.ts and crashes because Playwright's
    // `test()` helper can't be called outside the Playwright runtime.
    exclude: ['**/node_modules/**', '**/dist/**', 'e2e/**'],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
