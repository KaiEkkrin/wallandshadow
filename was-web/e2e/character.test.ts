import { test, expect } from '@playwright/test';

import * as Util from './util';
import * as Api from './apiFixture';

test.describe('Character CRUD tests', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.App-login-text').first()).toBeVisible();
  });

  test('create, edit, and delete character', async ({ page }, testInfo) => {
    const deviceName = Util.getDeviceNameFromProject(testInfo.project.name);

    // Sign up and create an adventure
    await Util.signUp(page, deviceName);
    await Util.createNewAdventure(page, 'Character test', 'Testing characters');
    await expect(page).toHaveURL(/\/adventure\//);

    // Verify the character list starts empty
    await expect(page.locator('h5:has-text("My Characters (0/")')).toBeVisible();

    // Create a character
    await page.click('text="New character"');
    await expect(page.locator('#characterName')).toBeVisible();
    await page.fill('#characterName', 'Gandalf');
    await page.fill('#characterLabel', 'GAN');
    await page.click('.modal button >> text="Save"');

    // Wait for character to appear in the list
    await expect(page.locator('.list-group-item >> text="Gandalf"')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('h5:has-text("My Characters (1/")')).toBeVisible({ timeout: 5000 });

    // Edit the character name and label
    const gandalfRow = page.locator('.list-group-item', { hasText: 'Gandalf' });
    await gandalfRow.locator('button.btn-primary').click();

    await expect(page.locator('#characterName')).toBeVisible();
    await page.fill('#characterName', 'Gandalf the Grey');
    await page.fill('#characterLabel', 'GTG');
    await page.click('.modal button >> text="Save"');

    // Verify the updated name appears
    await expect(page.locator('.list-group-item >> text="Gandalf the Grey"')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('.list-group-item >> text="Gandalf"').first()).not.toBeVisible();

    // Delete the character
    const greyRow = page.locator('.list-group-item', { hasText: 'Gandalf the Grey' });
    await greyRow.locator('button.btn-danger').click();

    // Confirm deletion
    await expect(page.locator('text="You are about to delete Gandalf the Grey. Are you sure?"')).toBeVisible();
    await page.click('text="Yes, delete character!"');

    // Verify character is gone
    await expect(page.locator('.list-group-item >> text="Gandalf the Grey"')).not.toBeVisible({ timeout: 5000 });
    await expect(page.locator('h5:has-text("My Characters (0/")')).toBeVisible({ timeout: 5000 });
  });

  test('second user sees other characters', async ({ browser, page }, testInfo) => {
    const deviceName = Util.getDeviceNameFromProject(testInfo.project.name);

    // User 1 signs up and creates an adventure
    const user1 = await Util.signUp(page, deviceName, 'Owner');
    await Util.createNewAdventure(page, 'Party adventure', 'Team building');
    await expect(page).toHaveURL(/\/adventure\//);
    const adventureId = page.url().split('/adventure/')[1];

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
      await expect(page2.locator('.card-title >> text="Party adventure"')).toBeVisible({ timeout: 5000 });

      // User 1 creates a character
      await page.click('text="New character"');
      await expect(page.locator('#characterName')).toBeVisible();
      await page.fill('#characterName', 'Fighter');
      await page.fill('#characterLabel', 'FTR');
      await page.click('.modal button >> text="Save"');

      // User 1 sees the character
      await expect(page.locator('.list-group-item >> text="Fighter"')).toBeVisible({ timeout: 5000 });

      // User 2 should see it under "Other Characters"
      await expect(page2.locator('h5:has-text("Other Characters")')).toBeVisible({ timeout: 5000 });
      await expect(page2.locator('.list-group-item >> text="Fighter"')).toBeVisible({ timeout: 5000 });
    } finally {
      await page2.close();
      await context2.close();
    }
  });
});
