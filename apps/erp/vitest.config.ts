import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  // Next's tsconfig sets `jsx: "preserve"` (SWC does the transform in the real
  // build). Vite 8's oxc transform honors that and leaves raw JSX in imported
  // .tsx files, which then fails import analysis. Force the automatic runtime
  // so tests can import .tsx modules (e.g. @react-pdf templates).
  oxc: { jsx: { runtime: 'automatic' } },
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
