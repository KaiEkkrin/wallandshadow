import { test, expect } from '@playwright/test';

import * as Util from './util';
import * as Api from './apiFixture';

test.describe('Map CRUD tests', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await Promise.race([
      expect(page.locator('.App-login-text').first()).toBeVisible(),
      expect(page.locator('.App-consent-container')).toBeVisible()
    ]);
    await Util.acceptCookieConsent(page);
  });

  // Map editing from the map page requires WebGL because the MapContextProvider
  // only populates the map data after the state machine (which needs WebGL) is
  // created. Without a GPU, the map editor modal opens with empty fields.
  // This test is skipped until the map context is refactored to separate map
  // metadata fetching from the rendering pipeline.
  test.skip('edit map name and description from map page', async () => {
    // Placeholder — see comment above
  });

  test('delete map from adventure page', async ({ page }, testInfo) => {
    const deviceName = Util.getDeviceNameFromProject(testInfo.project.name);

    // Sign up and create an adventure with a map
    await Util.signUp(page, deviceName);
    await Util.createNewAdventure(page, 'Map delete test', 'Testing map deletion');
    await expect(page).toHaveURL(/\/adventure\//);

    // Create a map, then navigate back to the adventure page
    await Util.createNewMap(page, 'Sacrificial map', 'Will be deleted', 'square');
    await Util.handleWebGLOrError(page);
    await Util.navigateHome(page, deviceName);

    // Open the adventure
    if (Util.isPhone(deviceName)) {
      const toggle = page.locator('text="Map delete test"');
      await toggle.scrollIntoViewIfNeeded();
      await toggle.click();
    }
    await page.click('text="Open adventure"');
    await expect(page.locator('.card-text >> text="Testing map deletion"')).toBeVisible();

    // Click the delete button on the map card (expand accordion on phones)
    if (Util.isPhone(deviceName)) {
      const mapToggle = page.locator('text="Sacrificial map"');
      await mapToggle.scrollIntoViewIfNeeded();
      await mapToggle.click();
    }

    // Use dispatchEvent to avoid version badge interception on small viewports
    const deleteMapBtn = Util.deleteButton(page);
    await deleteMapBtn.scrollIntoViewIfNeeded();
    await deleteMapBtn.dispatchEvent('click');

    // Confirm deletion and verify the map disappears
    await expect(page.locator('text="Do you really want to delete Sacrificial map?"')).toBeVisible();
    await page.click('text="Yes, delete map!"');
    await expect(page.locator('text="Sacrificial map"')).not.toBeVisible({ timeout: 5000 });
  });

  test('delete map - second user sees deletion', async ({ browser, page }, testInfo) => {
    const deviceName = Util.getDeviceNameFromProject(testInfo.project.name);

    // User 1 signs up and creates an adventure
    const user1 = await Util.signUp(page, deviceName, 'Owner');
    await Util.createNewAdventure(page, 'Shared map test', 'Testing shared map deletion');
    await expect(page).toHaveURL(/\/adventure\//);
    const adventureId = page.url().split('/adventure/')[1];

    // Create map via API for speed (don't need to navigate to map page)
    const user1Api = await Api.loginApiUser(user1.email, user1.password);
    await Api.setupMap(user1Api, adventureId, 'Shared map', 'Will vanish', 'hex');

    // Refresh to pick up the new map
    await page.reload();
    await expect(page.locator('.card-title >> text="Shared map test"')).toBeVisible();

    // Invite user 2 via the API
    const user2 = await Api.createApiUser('Guest');
    await Api.inviteAndJoin(user1Api, user2.api, adventureId);

    // User 2 signs in and navigates to the adventure
    const { page2, context2 } = await Util.setupSecondUser(browser, {
      displayName: user2.displayName, email: user2.email, number: 0, password: user2.password,
    }, deviceName);
    try {
      await page2.goto(`/adventure/${adventureId}`);
      await expect(page2.locator('.card-title >> text="Shared map test"')).toBeVisible({ timeout: 5000 });

      // User 2 should see the map
      if (Util.isPhone(deviceName)) {
        await expect(page2.locator('text="Shared map"')).toBeVisible({ timeout: 5000 });
      } else {
        await expect(page2.locator('.card-title >> text="Shared map"')).toBeVisible({ timeout: 5000 });
      }

      // User 1 deletes the map (expand accordion on phones)
      if (Util.isPhone(deviceName)) {
        const mapToggle = page.locator('text="Shared map"');
        await mapToggle.scrollIntoViewIfNeeded();
        await mapToggle.click();
        // Wait for accordion body to expand and show "Open map" link
        await expect(page.locator('text="Open map"')).toBeVisible();
      }
      // Use dispatchEvent to avoid version badge interception on small viewports
      await Util.deleteButton(page).dispatchEvent('click');
      await page.click('text="Yes, delete map!"');

      // User 2 should see the map disappear
      await expect(page2.locator('text="Shared map"')).not.toBeVisible({ timeout: 5000 });
    } finally {
      await page2.close();
      await context2.close();
    }
  });
});
