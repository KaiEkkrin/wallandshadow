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
    await expect(page.locator('.App-login-text').first()).toBeVisible();

    // Click login, open the modal, select external provider, and sign in
    const loginButton = page.locator('button >> text="Login existing user"');
    await loginButton.waitFor({ state: 'visible' });
    await loginButton.click();

    // Select the external provider radio button
    await page.click('#existingUserExternalRadio');

    // Click sign in — this triggers a redirect to Zitadel's hosted login page
    await page.click('button >> text=/^Sign in$/');

    // We're now on Zitadel's v1 hosted login page.
    // Enter the login name (email) and click Next
    const loginInput = page.locator('input[name="loginName"], input[autocomplete="username"]');
    await expect(loginInput).toBeVisible({ timeout: 15000 });
    await loginInput.fill(zitadelEmail!);
    await page.getByRole('button', { name: /^Next$/ }).click();

    // Enter the password and click Next
    const passwordInput = page.locator('input[type="password"]');
    await expect(passwordInput).toBeVisible({ timeout: 10000 });
    await passwordInput.fill(zitadelPassword!);

    // Click Next and wait for the redirect chain to complete.
    // Zitadel redirects to /auth/callback which processes the code and navigates to /app.
    await Promise.all([
      page.waitForURL('**/app**', { timeout: 30000 }),
      page.getByRole('button', { name: /^Next$/ }).click(),
    ]);

    // Verify the app loaded in authenticated state
    await expect(page.locator('h5 >> text="Latest maps"')).toBeVisible({ timeout: 15000 });
  });

  test('invite link survives OIDC round-trip in a fresh tab', async ({ browser }, testInfo) => {
    const deviceName = Util.getDeviceNameFromProject(testInfo.project.name);

    // Sign up an owner and generate an invite URL
    const ownerContext = await browser.newContext();
    const ownerPage = await ownerContext.newPage();
    let inviteUrl: string;
    try {
      await ownerPage.goto('/');
      await expect(ownerPage.locator('.App-login-text').first()).toBeVisible();
      await Util.signUp(ownerPage, deviceName, 'Owner');
      await Util.createNewAdventure(ownerPage, 'Invite adventure', 'Invite desc');
      await expect(ownerPage).toHaveURL(/\/adventure\//);

      await ownerPage.click('button >> text="Create invite link"');
      const inviteAnchor = ownerPage.locator('a >> text="Send this link to other players to invite them."');
      await expect(inviteAnchor).toBeVisible({ timeout: 10000 });
      const href = await inviteAnchor.getAttribute('href');
      if (!href) throw new Error('Invite link anchor missing href');
      inviteUrl = href;
      expect(inviteUrl).toMatch(/^\/invite\//);
    } finally {
      await ownerPage.close();
      await ownerContext.close();
    }

    // A separate context simulates opening the invite link in a fresh tab with
    // no prior OIDC session — the scenario that used to bounce users to /login
    // and then land them on /app instead of the invite.
    const guestContext = await browser.newContext();
    const guestPage = await guestContext.newPage();
    try {
      guestPage.on('console', msg => {
        if (msg.type() === 'error' || msg.text().includes('OIDC')) {
          console.log(`Guest ${msg.type()}: ${msg.text()}`);
        }
      });

      // Navigate to the invite; RequireLoggedIn bounces to /login
      await guestPage.goto(inviteUrl);
      await guestPage.waitForURL('**/login', { timeout: 10000 });
      await expect(guestPage.locator('.App-login-text').first()).toBeVisible();

      // Click "Login existing user", select the external provider, sign in
      const loginButton = guestPage.locator('button >> text="Login existing user"');
      await loginButton.waitFor({ state: 'visible' });
      await loginButton.click();
      await guestPage.click('#existingUserExternalRadio');
      await guestPage.click('button >> text=/^Sign in$/');

      // Complete Zitadel hosted login
      const loginInput = guestPage.locator('input[name="loginName"], input[autocomplete="username"]');
      await expect(loginInput).toBeVisible({ timeout: 15000 });
      await loginInput.fill(zitadelEmail!);
      await guestPage.getByRole('button', { name: /^Next$/ }).click();
      const passwordInput = guestPage.locator('input[type="password"]');
      await expect(passwordInput).toBeVisible({ timeout: 10000 });
      await passwordInput.fill(zitadelPassword!);

      // After the callback, the user should land on the original invite (not /app)
      await Promise.all([
        guestPage.waitForURL('**' + inviteUrl, { timeout: 30000 }),
        guestPage.getByRole('button', { name: /^Next$/ }).click(),
      ]);

      await expect(guestPage.getByRole('button', { name: /^Join/ })).toBeVisible({ timeout: 15000 });
    } finally {
      await guestPage.close();
      await guestContext.close();
    }
  });
});
