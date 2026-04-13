import { test, expect } from '@playwright/test';

import * as Util from './util';
import { TINY_PNG } from './testImage';

test.describe('Image management tests', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await Promise.race([
      expect(page.locator('.App-login-text').first()).toBeVisible(),
      expect(page.locator('.App-consent-container')).toBeVisible()
    ]);
    await Util.acceptCookieConsent(page);
  });

  test('upload image and assign to adventure', async ({ page }, testInfo) => {
    const deviceName = Util.getDeviceNameFromProject(testInfo.project.name);

    // Sign up and create an adventure
    await Util.signUp(page, deviceName);
    await Util.createNewAdventure(page, 'Image test', 'Testing images');
    await expect(page).toHaveURL(/\/adventure\//);

    // Open the image picker and upload a test image
    await Util.adventureImageButton(page).click();
    await expect(page.locator('.modal-title:has-text("Choose image")')).toBeVisible();

    await page.setInputFiles('#uploadButton', {
      name: 'test.png',
      mimeType: 'image/png',
      buffer: TINY_PNG,
    });

    // Wait for the uploaded image to appear, then assign it
    await expect(page.locator('.App-image-collection-image')).toBeVisible({ timeout: 5000 });
    await page.click('text="Use this image"');
    await expect(page.locator('.modal-title:has-text("Choose image")')).not.toBeVisible();

    // Verify the adventure card now shows an image
    await expect(page.locator('.card img.App-image-collection-image, .card img[alt="Image test"]')).toBeVisible({ timeout: 5000 });
  });

  test('remove image from adventure', async ({ page }, testInfo) => {
    const deviceName = Util.getDeviceNameFromProject(testInfo.project.name);

    // Sign up and create an adventure
    await Util.signUp(page, deviceName);
    await Util.createNewAdventure(page, 'Remove image test', 'Will remove image');
    await expect(page).toHaveURL(/\/adventure\//);

    // Upload and assign an image
    await Util.adventureImageButton(page).click();
    await expect(page.locator('.modal-title:has-text("Choose image")')).toBeVisible();

    await page.setInputFiles('#uploadButton', {
      name: 'test.png',
      mimeType: 'image/png',
      buffer: TINY_PNG,
    });
    await expect(page.locator('.App-image-collection-image')).toBeVisible({ timeout: 5000 });
    await page.click('text="Use this image"');
    await expect(page.locator('.modal-title:has-text("Choose image")')).not.toBeVisible();

    // Verify the image is shown on the card
    await expect(page.locator('.card img')).toBeVisible({ timeout: 5000 });

    // Re-open image picker and click "Use no image"
    await Util.adventureImageButton(page).click();
    await expect(page.locator('.modal-title:has-text("Choose image")')).toBeVisible();
    await page.click('text="Use no image"');
    await expect(page.locator('.modal-title:has-text("Choose image")')).not.toBeVisible();

    // Verify the adventure card image is gone
    await expect(page.locator('.card img')).not.toBeVisible({ timeout: 5000 });
  });

  test('delete an image', async ({ page }, testInfo) => {
    const deviceName = Util.getDeviceNameFromProject(testInfo.project.name);

    // Sign up and create an adventure
    await Util.signUp(page, deviceName);
    await Util.createNewAdventure(page, 'Delete image test', 'Will delete image');
    await expect(page).toHaveURL(/\/adventure\//);

    // Open the image picker and upload a test image
    await Util.adventureImageButton(page).click();
    await expect(page.locator('.modal-title:has-text("Choose image")')).toBeVisible();

    await page.setInputFiles('#uploadButton', {
      name: 'test.png',
      mimeType: 'image/png',
      buffer: TINY_PNG,
    });
    await expect(page.locator('.App-image-collection-image')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('.modal-title:has-text("Choose image (1/")')).toBeVisible({ timeout: 5000 });

    // Click the delete button and confirm deletion
    await Util.deleteButton(page, true).click();
    await expect(page.locator('text="Yes, delete image!"')).toBeVisible();
    await page.click('text="Yes, delete image!"');

    // Both modals close after deletion
    await expect(page.locator('.modal')).not.toBeVisible({ timeout: 5000 });

    // Re-open image picker and verify image count went to 0
    await Util.adventureImageButton(page).click();
    await expect(page.locator('.modal-title:has-text("Choose image (0/")')).toBeVisible({ timeout: 5000 });
  });

  test('assign image to map', async ({ page }, testInfo) => {
    const deviceName = Util.getDeviceNameFromProject(testInfo.project.name);

    // Sign up and create an adventure
    await Util.signUp(page, deviceName);
    await Util.createNewAdventure(page, 'Map image test', 'Testing map images');
    await expect(page).toHaveURL(/\/adventure\//);

    // Upload an image via the adventure image picker (don't assign it)
    await Util.adventureImageButton(page).click();
    await expect(page.locator('.modal-title:has-text("Choose image")')).toBeVisible();

    await page.setInputFiles('#uploadButton', {
      name: 'test.png',
      mimeType: 'image/png',
      buffer: TINY_PNG,
    });
    await expect(page.locator('.App-image-collection-image')).toBeVisible({ timeout: 5000 });
    await page.click('.modal button >> text="Close"');

    // Create a map, then navigate back to the adventure page
    await Util.createNewMap(page, 'Mapped image', 'Has an image', 'hex');
    await Util.handleWebGLOrError(page);
    await Util.navigateHome(page, deviceName);

    // Open the adventure
    if (Util.isPhone(deviceName)) {
      const toggle = page.locator('text="Map image test"');
      await toggle.scrollIntoViewIfNeeded();
      await toggle.click();
    }
    await page.click('text="Open adventure"');
    await expect(page.locator('.card-text >> text="Testing map images"')).toBeVisible();

    // Click the pick-image button on the map card (expand accordion on phones)
    if (Util.isPhone(deviceName)) {
      const mapToggle = page.locator('text="Mapped image"');
      await mapToggle.scrollIntoViewIfNeeded();
      await mapToggle.click();
    }

    // Use dispatchEvent to avoid version badge interception on small viewports
    const mapImageBtn = page.locator('button.btn-secondary').filter({
      has: page.locator('svg[data-icon="image"]')
    }).first();
    await mapImageBtn.scrollIntoViewIfNeeded();
    await mapImageBtn.dispatchEvent('click');

    // Select the previously uploaded image
    await expect(page.locator('.modal-title:has-text("Choose image")')).toBeVisible();
    await expect(page.locator('.App-image-collection-image')).toBeVisible({ timeout: 5000 });

    await page.click('text="Use this image"');
    await expect(page.locator('.modal-title:has-text("Choose image")')).not.toBeVisible();
  });
});
