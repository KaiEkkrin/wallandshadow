import { test, expect } from '@playwright/test';

import * as Util from './util';

// This test verifies the full OIDC login flow against a real Zitadel instance.
// It requires a pre-configured test user in Zitadel.
// Skip when ZITADEL_TEST_EMAIL / ZITADEL_TEST_PASSWORD are not set.
const zitadelEmail = process.env.ZITADEL_TEST_EMAIL;
const zitadelPassword = process.env.ZITADEL_TEST_PASSWORD;

test.describe('OIDC login', () => {
  // Only run if Zitadel test credentials are configured
  test.skip(!zitadelEmail || !zitadelPassword, 'ZITADEL_TEST_EMAIL and ZITADEL_TEST_PASSWORD not set');

  // Use a single browser (no need to test across all devices for external login)
  test.describe.configure({ mode: 'serial' });

  test('sign in via Zitadel OIDC', async ({ page }, testInfo) => {
    const deviceName = Util.getDeviceNameFromProject(testInfo.project.name);

    // Capture browser console for debugging
    page.on('console', msg => {
      if (msg.type() === 'error' || msg.text().includes('OIDC')) {
        console.log(`Browser ${msg.type()}: ${msg.text()}`);
      }
    });

    // Navigate directly to the SPA login page (not the static landing page at /)
    await page.goto('/login');
    await Util.acceptCookieConsent(page);
    await expect(page.locator('.App-login-text').first()).toBeVisible();

    // Click login, open the modal, select external provider, and sign in
    const loginButton = page.locator('button >> text="Login existing user"');
    await loginButton.waitFor({ state: 'visible' });
    await loginButton.click();

    // Select the external provider radio button
    await page.click('#existingUserExternalRadio');

    // Click sign in — this triggers a redirect to Zitadel's hosted login page
    await page.click('button >> text=/^Sign in$/');

    // We're now on Zitadel's v2 login page
    // Enter the login name (email) and click Continue
    const loginInput = page.locator('input[name="loginName"], input[autocomplete="username"]');
    await expect(loginInput).toBeVisible({ timeout: 15000 });
    await loginInput.fill(zitadelEmail!);
    await page.locator('button:has-text("Continue"), button[type="submit"]').first().click();

    // Enter the password and click Continue
    const passwordInput = page.locator('input[type="password"]');
    await expect(passwordInput).toBeVisible({ timeout: 10000 });
    await passwordInput.fill(zitadelPassword!);

    // Click Continue and wait for the redirect chain to complete.
    // Zitadel redirects to /auth/callback which processes the code and navigates to /app.
    await Promise.all([
      page.waitForURL('**/app**', { timeout: 30000 }),
      page.locator('button:has-text("Continue"), button[type="submit"]').first().click(),
    ]);

    // Verify the app loaded in authenticated state
    await expect(page.locator('h5 >> text="Latest maps"')).toBeVisible({ timeout: 15000 });
  });
});
