import { test, expect } from '@playwright/test';

import * as Util from './util';

test.describe('Delete account', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.App-login-text').first()).toBeVisible();
  });

  test('user can delete their account from the profile modal', async ({ page }, testInfo) => {
    const deviceName = Util.getDeviceNameFromProject(testInfo.project.name);

    // Sign up a new local account.
    const user = await Util.signUp(page, deviceName, 'Del');

    // Open the profile modal via the navbar display-name button.
    await Util.ensureNavbarExpanded(page, deviceName);
    await page.locator(`button:has-text("${user.displayName}")`).click();

    // Modal opens. Trigger the danger button.
    await expect(page.locator('.modal-title:has-text("User profile settings")')).toBeVisible();
    await page.locator('button:has-text("Delete account")').click();

    // Delete-account modal appears.
    const deleteModal = page.locator('.modal-title:has-text("Delete account")');
    await expect(deleteModal).toBeVisible();

    // The danger button stays disabled until the user types their display name verbatim.
    const dangerButton = page.locator('button:has-text("Delete my account")');
    await expect(dangerButton).toBeDisabled();

    // Wrong text — still disabled.
    await page.fill('[id=deleteConfirmInput]', 'something else');
    await expect(dangerButton).toBeDisabled();

    // Correct text — enabled. Submit.
    await page.fill('[id=deleteConfirmInput]', user.displayName);
    await expect(dangerButton).toBeEnabled();
    await dangerButton.click();

    // After deletion the auth state listener redirects to /login.
    await page.waitForURL(/\/login$/, { timeout: 10000 });
    await expect(page.locator('.App-login-text').first()).toBeVisible();

    // Logging in with the deleted credentials should now fail — the account is gone.
    await page.locator('button:has-text("Login existing user")').click();
    await expect(page.locator('[id=emailInput]')).toBeVisible();
    await page.fill('[id=emailInput]', user.email);
    await page.fill('[id=passwordInput]', user.password);
    await page.locator('button >> text=/^Sign in$/').click();

    // The login should not succeed — we should stay on /login and the home page
    // sentinel ("Latest maps") should not appear.
    await expect(page.locator('h5 >> text="Latest maps"')).not.toBeVisible({ timeout: 5000 });
    await expect(page).toHaveURL(/\/login/);
  });
});
