import { test, expect } from '@playwright/test';

import * as Util from './util';
import * as Api from './apiFixture';

test.describe('Adventure CRUD tests', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await Promise.race([
      expect(page.locator('.App-login-text').first()).toBeVisible(),
      expect(page.locator('.App-consent-container')).toBeVisible()
    ]);
    await Util.acceptCookieConsent(page);
  });

  test('edit adventure name and description', async ({ page }, testInfo) => {
    const deviceName = Util.getDeviceNameFromProject(testInfo.project.name);

    await Util.signUp(page, deviceName);
    await Util.createNewAdventure(page, 'Original name', 'Original description');

    // Wait for adventure page to load
    await expect(page).toHaveURL(/\/adventure\//);
    await expect(page.locator('.card-title >> text="Original name"')).toBeVisible();
    await expect(page.locator('.card-text >> text="Original description"')).toBeVisible();

    // Click Edit button
    await page.click('button >> text="Edit"');
    await expect(page.locator('#adventureNameInput')).toBeVisible();

    // Clear and fill fields
    await page.fill('#adventureNameInput', 'Updated name');
    await page.fill('#adventureDescriptionInput', 'Updated description');
    await page.click('text="Save adventure"');

    // Wait for modal to close and verify updated values
    await expect(page.locator('#adventureNameInput')).not.toBeVisible();
    await expect(page.locator('.card-title >> text="Updated name"')).toBeVisible({ timeout: 3000 });
    await expect(page.locator('.card-text >> text="Updated description"')).toBeVisible({ timeout: 3000 });
  });

  test('edit adventure - second user sees changes', async ({ browser, page }, testInfo) => {
    const deviceName = Util.getDeviceNameFromProject(testInfo.project.name);

    // User 1: sign up and create adventure via browser
    const user1 = await Util.signUp(page, deviceName, 'Owner');
    await Util.createNewAdventure(page, 'Shared adventure', 'Shared desc');

    // Wait for adventure page to load, then get adventure ID from URL
    await expect(page.locator('.card-title >> text="Shared adventure"')).toBeVisible();
    await expect(page).toHaveURL(/\/adventure\//);
    const adventureId = page.url().split('/adventure/')[1];
    expect(adventureId).toBeTruthy();

    // User 1: login via API to create invite
    const user1Api = await Api.loginApiUser(user1.email, user1.password);

    // User 2: register + join via API
    const user2 = await Api.createApiUser('Guest');
    await Api.inviteAndJoin(user1Api, user2.api, adventureId);

    // User 2: sign in via browser in second context
    const context2 = await browser.newContext();
    const page2 = await context2.newPage();
    try {
      await page2.goto('/');
      await Promise.race([
        expect(page2.locator('.App-login-text').first()).toBeVisible(),
        expect(page2.locator('.App-consent-container')).toBeVisible()
      ]);
      await Util.acceptCookieConsent(page2);
      await Util.signIn(page2, {
        displayName: user2.displayName,
        email: user2.email,
        number: 0,
        password: user2.password,
      }, deviceName);

      // User 2 navigates to the adventure page
      await page2.goto(`/adventure/${adventureId}`);
      await expect(page2.locator('.card-title >> text="Shared adventure"')).toBeVisible({ timeout: 5000 });

      // User 1 edits the adventure name
      await page.click('button >> text="Edit"');
      await expect(page.locator('#adventureNameInput')).toBeVisible();
      await page.fill('#adventureNameInput', 'Renamed adventure');
      await page.click('text="Save adventure"');
      await expect(page.locator('#adventureNameInput')).not.toBeVisible();

      // User 2 should see the change (polling every 500ms)
      await expect(page2.locator('.card-title >> text="Renamed adventure"')).toBeVisible({ timeout: 3000 });
    } finally {
      await page2.close();
      await context2.close();
    }
  });

  test('delete adventure after deleting maps', async ({ page }, testInfo) => {
    const deviceName = Util.getDeviceNameFromProject(testInfo.project.name);

    await Util.signUp(page, deviceName);
    await Util.createNewAdventure(page, 'Doomed adventure', 'Will be deleted');

    // Wait for adventure page to load
    await expect(page.locator('.card-title >> text="Doomed adventure"')).toBeVisible();

    // Create a map (navigates to map page)
    await Util.createNewMap(page, 'Doomed map', 'Also deleted', 'hex');

    // Handle WebGL error on map page and navigate back
    await Util.handleWebGLOrError(page);
    await Util.navigateHome(page, deviceName);

    // Open the adventure from the home page
    if (Util.isPhone(deviceName)) {
      const toggle = page.locator('text="Doomed adventure"');
      await toggle.scrollIntoViewIfNeeded();
      await toggle.click();
    }
    await page.click('text="Open adventure"');
    await expect(page.locator('.card-text >> text="Will be deleted"')).toBeVisible();

    // Delete the map first — expand accordion on phones
    if (Util.isPhone(deviceName)) {
      const mapToggle = page.locator('text="Doomed map"');
      await mapToggle.scrollIntoViewIfNeeded();
      await mapToggle.click();
    }

    // Click the delete button on the map card (use dispatchEvent to avoid
    // version badge interception on small viewports)
    const deleteMapBtn = page.locator('button.btn-danger').filter({
      has: page.locator('svg[data-icon="xmark"]')
    }).first();
    await deleteMapBtn.scrollIntoViewIfNeeded();
    await deleteMapBtn.dispatchEvent('click');

    // Confirm map deletion
    await expect(page.locator('text="Do you really want to delete Doomed map?"')).toBeVisible();
    await page.click('text="Yes, delete map!"');

    // Wait for map to disappear
    await expect(page.locator('text="Doomed map"')).not.toBeVisible({ timeout: 3000 });

    // Now delete the adventure
    await page.click('text="Delete adventure"');
    await expect(page.locator('text="Do you really want to delete this adventure?"')).toBeVisible();
    await page.click('text="Yes, delete adventure!"');

    // Should redirect to home
    await expect(page).toHaveURL(/\/app$/);
    await expect(page.locator('text="Doomed adventure"')).not.toBeVisible({ timeout: 3000 });
  });

  test('cannot delete adventure with maps', async ({ page }, testInfo) => {
    const deviceName = Util.getDeviceNameFromProject(testInfo.project.name);

    // Sign up via browser, then create adventure + map via API for speed
    const user = await Util.signUp(page, deviceName);
    const userApi = await Api.loginApiUser(user.email, user.password);
    const adventureId = await Api.setupAdventure(userApi, 'Protected adventure', 'Has maps');
    await Api.setupMap(userApi, adventureId, 'Blocking map', 'A map', 'hex');

    // Navigate to the adventure page
    await page.goto(`/adventure/${adventureId}`);
    await expect(page.locator('.card-title >> text="Protected adventure"')).toBeVisible({ timeout: 5000 });

    // Try to delete — should show "cannot delete" message
    await page.click('text="Delete adventure"');
    await expect(page.locator('text="Adventures with maps cannot be deleted."')).toBeVisible();

    // The confirm button should be disabled
    const deleteBtn = page.locator('button >> text="Yes, delete adventure!"');
    await expect(deleteBtn).toBeDisabled();

    // Close modal
    await page.click('.modal button >> text="Cancel"');
    await expect(page.locator('.card-title >> text="Protected adventure"')).toBeVisible();
  });
});
