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

    // Sign up and create an adventure
    await Util.signUp(page, deviceName);
    await Util.createNewAdventure(page, 'Original name', 'Original description');

    // Verify the adventure page loaded
    await expect(page).toHaveURL(/\/adventure\//);
    await expect(page.locator('.card-title >> text="Original name"')).toBeVisible();
    await expect(page.locator('.card-text >> text="Original description"')).toBeVisible();

    // Open the edit modal and change the name and description
    await page.click('button >> text="Edit"');
    await expect(page.locator('#adventureNameInput')).toBeVisible();
    await page.fill('#adventureNameInput', 'Updated name');
    await page.fill('#adventureDescriptionInput', 'Updated description');
    await page.click('text="Save adventure"');

    // Verify the updated values appear on the adventure page
    await expect(page.locator('#adventureNameInput')).not.toBeVisible();
    await expect(page.locator('.card-title >> text="Updated name"')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('.card-text >> text="Updated description"')).toBeVisible({ timeout: 5000 });
  });

  test('edit adventure - second user sees changes', async ({ browser, page }, testInfo) => {
    const deviceName = Util.getDeviceNameFromProject(testInfo.project.name);

    // User 1 signs up and creates an adventure
    const user1 = await Util.signUp(page, deviceName, 'Owner');
    await Util.createNewAdventure(page, 'Shared adventure', 'Shared desc');
    await expect(page.locator('.card-title >> text="Shared adventure"')).toBeVisible();
    await expect(page).toHaveURL(/\/adventure\//);
    const adventureId = page.url().split('/adventure/')[1];
    expect(adventureId).toBeTruthy();

    // Invite user 2 via the API
    const user1Api = await Api.loginApiUser(user1.email, user1.password);
    const user2 = await Api.createApiUser('Guest');
    await Api.inviteAndJoin(user1Api, user2.api, adventureId);

    // User 2 signs in and navigates to the adventure
    const { page2, context2 } = await Util.setupSecondUser(browser, {
      displayName: user2.displayName, email: user2.email, number: 0, password: user2.password,
    }, deviceName);
    try {
      await page2.goto(`/adventure/${adventureId}`);
      await expect(page2.locator('.card-title >> text="Shared adventure"')).toBeVisible({ timeout: 5000 });

      // User 1 edits the adventure name
      await page.click('button >> text="Edit"');
      await expect(page.locator('#adventureNameInput')).toBeVisible();
      await page.fill('#adventureNameInput', 'Renamed adventure');
      await page.click('text="Save adventure"');
      await expect(page.locator('#adventureNameInput')).not.toBeVisible();

      // User 2 should see the renamed adventure
      await expect(page2.locator('.card-title >> text="Renamed adventure"')).toBeVisible({ timeout: 5000 });
    } finally {
      await page2.close();
      await context2.close();
    }
  });

  test('delete adventure after deleting maps', async ({ page }, testInfo) => {
    const deviceName = Util.getDeviceNameFromProject(testInfo.project.name);

    // Sign up and create an adventure with a map
    await Util.signUp(page, deviceName);
    await Util.createNewAdventure(page, 'Doomed adventure', 'Will be deleted');
    await expect(page.locator('.card-title >> text="Doomed adventure"')).toBeVisible();
    await Util.createNewMap(page, 'Doomed map', 'Also deleted', 'hex');

    // Navigate back from the map page to the adventure
    await Util.handleWebGLOrError(page);
    await Util.navigateHome(page, deviceName);
    if (Util.isPhone(deviceName)) {
      const toggle = page.locator('text="Doomed adventure"');
      await toggle.scrollIntoViewIfNeeded();
      await toggle.click();
    }
    await page.click('text="Open adventure"');
    await expect(page.locator('.card-text >> text="Will be deleted"')).toBeVisible();

    // Delete the map first (expand accordion on phones)
    if (Util.isPhone(deviceName)) {
      const mapToggle = page.locator('text="Doomed map"');
      await mapToggle.scrollIntoViewIfNeeded();
      await mapToggle.click();
    }
    // Use dispatchEvent to avoid version badge interception on small viewports
    const deleteMapBtn = Util.deleteButton(page);
    await deleteMapBtn.scrollIntoViewIfNeeded();
    await deleteMapBtn.dispatchEvent('click');

    // Confirm map deletion and wait for it to disappear
    await expect(page.locator('text="Do you really want to delete Doomed map?"')).toBeVisible();
    await page.click('text="Yes, delete map!"');
    await expect(page.locator('text="Doomed map"')).not.toBeVisible({ timeout: 5000 });

    // Delete the adventure and confirm
    await page.click('text="Delete adventure"');
    await expect(page.locator('text="Do you really want to delete this adventure?"')).toBeVisible();
    await page.click('text="Yes, delete adventure!"');

    // Should redirect to home with the adventure gone
    await expect(page).toHaveURL(/\/app$/);
    await expect(page.locator('text="Doomed adventure"')).not.toBeVisible({ timeout: 5000 });
  });

  test('cannot delete adventure with maps', async ({ page }, testInfo) => {
    const deviceName = Util.getDeviceNameFromProject(testInfo.project.name);

    // Create adventure + map via API for speed
    const user = await Util.signUp(page, deviceName);
    const userApi = await Api.loginApiUser(user.email, user.password);
    const adventureId = await Api.setupAdventure(userApi, 'Protected adventure', 'Has maps');
    await Api.setupMap(userApi, adventureId, 'Blocking map', 'A map', 'hex');

    // Navigate to the adventure page
    await page.goto(`/adventure/${adventureId}`);
    await expect(page.locator('.card-title >> text="Protected adventure"')).toBeVisible({ timeout: 5000 });

    // Try to delete — should show "cannot delete" and disable the confirm button
    await page.click('text="Delete adventure"');
    await expect(page.locator('text="Adventures with maps cannot be deleted."')).toBeVisible();
    await expect(page.locator('button >> text="Yes, delete adventure!"')).toBeDisabled();

    // Close modal — adventure should still be there
    await page.click('.modal button >> text="Cancel"');
    await expect(page.locator('.card-title >> text="Protected adventure"')).toBeVisible();
  });
});
