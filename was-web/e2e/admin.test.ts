import { test, expect } from '@playwright/test';

import * as Util from './util';
import { createApiUser, setupAdventure } from './apiFixture';
import { promoteToAdmin } from './dbAdmin';

test.describe('admin account info', () => {
  // An admin sees the Admin link, can search, and can open an account-info page.
  test('an admin can search for and view an account', async ({ page }, testInfo) => {
    const deviceName = Util.getDeviceNameFromProject(testInfo.project.name);
    const browserName = Util.getBrowserNameFromProject(testInfo.project.name);

    // Register an admin via the API, then promote them in the database.
    const admin = await createApiUser('Admin');
    await promoteToAdmin(admin.email);

    // Register a target account with an adventure so the tables have content.
    const target = await createApiUser('Target');
    await setupAdventure(target.api, 'Target Adventure', 'an adventure');

    // Sign in as the admin through the browser.
    await page.goto('/');
    await Util.signIn(
      page,
      { displayName: admin.displayName, email: admin.email, number: 0, password: admin.password },
      deviceName,
    );

    // The Admin nav link is visible; follow it to the search page.
    await Util.ensureNavbarExpanded(page, deviceName);
    const adminLink = page.locator('.nav-link >> text="Admin"');
    await expect(adminLink).toBeVisible();
    await adminLink.click();
    await page.waitForURL('**/admin');

    // Search for the target account by email.
    await page.fill('#adminSearchInput', target.email);
    await page.locator('button >> text="Search"').click();

    // The summary result appears; open the full account-info page.
    await expect(page.locator('text="View full account info"')).toBeVisible();
    await page.locator('text="View full account info"').click();
    await page.waitForURL(`**/admin/users/${target.uid}`);

    // The account-info page shows the summary and the adventures table.
    await expect(page.locator('h5', { hasText: 'Account:' })).toBeVisible();
    await expect(page.locator('h6', { hasText: 'Adventures owned' })).toBeVisible();
    await expect(page.locator('td', { hasText: 'Target Adventure' })).toBeVisible();

    await Util.takeScreenshot(page, browserName, deviceName, 'admin-account-info');
  });

  // A non-admin sees no Admin link and cannot reach /admin.
  test('a non-admin cannot see or reach the admin pages', async ({ page }, testInfo) => {
    const deviceName = Util.getDeviceNameFromProject(testInfo.project.name);

    // Register and sign in as an ordinary (Basic) user.
    const user = await createApiUser('Plain');
    await page.goto('/');
    await Util.signIn(
      page,
      { displayName: user.displayName, email: user.email, number: 0, password: user.password },
      deviceName,
    );

    // No Admin link appears in the nav.
    await Util.ensureNavbarExpanded(page, deviceName);
    await expect(page.locator('.nav-link >> text="Admin"')).not.toBeVisible();

    // Navigating straight to /admin redirects to the home page.
    await page.goto('/admin');
    await expect(page.locator('h5 >> text="Latest maps"')).toBeVisible();
  });
});
