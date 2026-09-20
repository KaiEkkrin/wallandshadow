// Production-bundle smoke test.
//
// Loads the real `npm run build` output in a browser and asserts that it runs.
// This is the check that was missing when PR #398 (Vite 8 / Rolldown) reached a
// fully green CI while rendering a blank page: a bundler interop error compiles,
// lints and unit-tests perfectly happily, and only fails when a browser executes
// it. See https://github.com/KaiEkkrin/wallandshadow/issues/402.
//
// Deliberately minimal: no database, no object storage, no API server. The
// bundle is served as static files, and none of the routes exercised here talk
// to the API before sign-in, so nothing needs stubbing. Anything that needs a
// backend belongs in the e2e suite instead.

import { test, expect, type Page } from '@playwright/test';

// A version string built from the package.json import and the __GIT_COMMIT__
// define — both build-time substitutions that a bundler change can break.
const VERSION_PATTERN = /^v\d+\.\d+\.\d+\+[0-9a-f]{8}$/;

// Uncaught exceptions kill the React tree outright; console errors also catch
// the quieter case where an error boundary swallows the throw.
function watchForFailures(page: Page) {
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];

  page.on('pageerror', err => pageErrors.push(err.message));
  page.on('console', msg => {
    if (msg.type() === 'error') {
      consoleErrors.push(msg.text());
    }
  });

  return { pageErrors, consoleErrors };
}

type Failures = ReturnType<typeof watchForFailures>;

// Wait until the SPA has either rendered or thrown, then report the throw.
// Asserting this before anything else matters: when the bundle dies on load,
// every later assertion fails on a timeout whose message says nothing about
// the cause — "expected /login, got /app" rather than the actual TypeError.
async function expectBundleRan(page: Page, failures: Failures) {
  await expect
    .poll(
      async () => failures.pageErrors.length > 0 || (await page.locator('#root > *').count()) > 0,
      { timeout: 15000, message: 'the bundle neither rendered nor threw' }
    )
    .toBe(true);

  expect(failures.pageErrors, 'uncaught exception while loading the bundle').toEqual([]);
}

test.describe('production bundle', () => {
  test('boots and renders the sign-in page', async ({ page }) => {
    const failures = watchForFailures(page);

    // /app is the SPA entry point; unauthenticated it redirects to /login.
    await page.goto('/app');
    await expectBundleRan(page, failures);

    await expect(page).toHaveURL(/\/login$/);
    await expect(
      page.getByText('Sign in to get started with Wall & Shadow.').first()
    ).toBeVisible();

    // Production builds are OIDC-only: no email/password form.
    await expect(page.getByRole('button', { name: /^Sign in$/ })).toBeVisible();

    await expect(page.locator('.version-badge a').last()).toHaveText(VERSION_PATTERN);

    expect(failures.pageErrors).toEqual([]);
    expect(failures.consoleErrors).toEqual([]);
  });

  test('resolves a lazily-loaded route chunk', async ({ page }) => {
    const failures = watchForFailures(page);

    // /about is code-split into its own chunk, so this covers dynamic import
    // and Suspense resolution as well as the entry bundle.
    await page.goto('/about');
    await expectBundleRan(page, failures);

    await expect(page.getByRole('heading', { name: 'About Wall & Shadow' })).toBeVisible();

    expect(failures.pageErrors).toEqual([]);
    expect(failures.consoleErrors).toEqual([]);
  });

  test('serves the static landing page', async ({ page }) => {
    const failures = watchForFailures(page);

    // / is plain HTML plus landing.js, built by a separate path from the SPA.
    await page.goto('/');
    await expect(page.getByText('Improvised virtual tabletop')).toBeVisible();

    expect(failures.pageErrors).toEqual([]);
    expect(failures.consoleErrors).toEqual([]);
  });
});
