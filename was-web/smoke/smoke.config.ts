import { defineConfig, devices } from '@playwright/test';
import path from 'path';

/**
 * Playwright configuration for the production-bundle smoke test.
 *
 * Separate from `playwright.config.ts` because this suite has a different
 * subject and different dependencies: it drives the built output in `build/`
 * served as static files, with no Hono server, PostgreSQL or RustFS behind it.
 * Run it after `npm run build`.
 */

const PORT = 4180;

export default defineConfig({
  testDir: import.meta.dirname,
  testMatch: '*.test.ts',

  timeout: 60000,
  expect: { timeout: 10000 },

  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list']],

  use: {
    baseURL: `http://localhost:${PORT}`,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    navigationTimeout: 15000,
    actionTimeout: 10000,
  },

  // One browser is enough: the failures this guards against — a bundle that
  // throws on load, an unresolvable chunk — are not browser-specific.
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1366, height: 768 },
      },
    },
  ],

  webServer: {
    command: `node ${path.join(import.meta.dirname, 'serve.ts')}`,
    url: `http://localhost:${PORT}/app`,
    reuseExistingServer: !process.env.CI,
    timeout: 30000,
    env: { SMOKE_PORT: String(PORT) },
  },
});
