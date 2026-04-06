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

    await Util.signUp(page, deviceName);
    await Util.createNewAdventure(page, 'Image test', 'Testing images');
    await expect(page).toHaveURL(/\/adventure\//);

    // Click the image button (camera icon next to Edit button)
    const imageBtn = page.locator('.card-row-spaced button').filter({
      has: page.locator('svg[data-icon="image"]')
    }).first();
    await imageBtn.click();

    // Wait for image picker modal
    await expect(page.locator('.modal-title:has-text("Choose image")')).toBeVisible();

    // Upload a test image using Playwright's buffer API
    await page.setInputFiles('#uploadButton', {
      name: 'test.png',
      mimeType: 'image/png',
      buffer: TINY_PNG,
    });

    // Wait for the image to appear in the picker (polling picks up the new image)
    await expect(page.locator('.App-image-collection-image')).toBeVisible({ timeout: 5000 });

    // Click "Use this image"
    await page.click('text="Use this image"');

    // Modal should close
    await expect(page.locator('.modal-title:has-text("Choose image")')).not.toBeVisible();

    // The adventure card should now have an image
    await expect(page.locator('.card img.App-image-collection-image, .card img[alt="Image test"]')).toBeVisible({ timeout: 3000 });
  });

  test('remove image from adventure', async ({ page }, testInfo) => {
    const deviceName = Util.getDeviceNameFromProject(testInfo.project.name);

    await Util.signUp(page, deviceName);
    await Util.createNewAdventure(page, 'Remove image test', 'Will remove image');
    await expect(page).toHaveURL(/\/adventure\//);

    // First upload and assign an image
    const imageBtn = page.locator('.card-row-spaced button').filter({
      has: page.locator('svg[data-icon="image"]')
    }).first();
    await imageBtn.click();
    await expect(page.locator('.modal-title:has-text("Choose image")')).toBeVisible();

    await page.setInputFiles('#uploadButton', {
      name: 'test.png',
      mimeType: 'image/png',
      buffer: TINY_PNG,
    });
    await expect(page.locator('.App-image-collection-image')).toBeVisible({ timeout: 5000 });
    await page.click('text="Use this image"');
    await expect(page.locator('.modal-title:has-text("Choose image")')).not.toBeVisible();

    // Verify image is shown
    await expect(page.locator('.card img')).toBeVisible({ timeout: 3000 });

    // Re-open image picker
    await imageBtn.click();
    await expect(page.locator('.modal-title:has-text("Choose image")')).toBeVisible();

    // Click "Use no image"
    await page.click('text="Use no image"');
    await expect(page.locator('.modal-title:has-text("Choose image")')).not.toBeVisible();

    // The adventure card image should be gone (only the card content remains)
    // Wait a polling cycle for the update to propagate
    await expect(page.locator('.card img')).not.toBeVisible({ timeout: 3000 });
  });

  test('delete an image', async ({ page }, testInfo) => {
    const deviceName = Util.getDeviceNameFromProject(testInfo.project.name);

    await Util.signUp(page, deviceName);
    await Util.createNewAdventure(page, 'Delete image test', 'Will delete image');
    await expect(page).toHaveURL(/\/adventure\//);

    // Upload an image
    const imageBtn = page.locator('.card-row-spaced button').filter({
      has: page.locator('svg[data-icon="image"]')
    }).first();
    await imageBtn.click();
    await expect(page.locator('.modal-title:has-text("Choose image")')).toBeVisible();

    await page.setInputFiles('#uploadButton', {
      name: 'test.png',
      mimeType: 'image/png',
      buffer: TINY_PNG,
    });
    await expect(page.locator('.App-image-collection-image')).toBeVisible({ timeout: 5000 });

    // Verify image count shows 1
    await expect(page.locator('.modal-title:has-text("Choose image (1/")')).toBeVisible({ timeout: 3000 });

    // Click the delete button (danger X icon in the image grid)
    const deleteImageBtn = page.locator('.modal-body button.btn-danger').filter({
      has: page.locator('svg[data-icon="xmark"]')
    });
    await deleteImageBtn.click();

    // Image deletion modal should appear
    await expect(page.locator('text="Yes, delete image!"')).toBeVisible();
    await page.click('text="Yes, delete image!"');

    // Both modals close after deletion — we're back on the adventure page
    await expect(page.locator('.modal')).not.toBeVisible({ timeout: 3000 });

    // Re-open the image picker to verify the image count went to 0
    const imageBtn2 = page.locator('.card-row-spaced button').filter({
      has: page.locator('svg[data-icon="image"]')
    }).first();
    await imageBtn2.click();
    await expect(page.locator('.modal-title:has-text("Choose image (0/")')).toBeVisible({ timeout: 5000 });
  });

  test('assign image to map', async ({ page }, testInfo) => {
    const deviceName = Util.getDeviceNameFromProject(testInfo.project.name);

    await Util.signUp(page, deviceName);
    await Util.createNewAdventure(page, 'Map image test', 'Testing map images');
    await expect(page).toHaveURL(/\/adventure\//);

    // First upload an image via the adventure image picker
    const adventureImageBtn = page.locator('.card-row-spaced button').filter({
      has: page.locator('svg[data-icon="image"]')
    }).first();
    await adventureImageBtn.click();
    await expect(page.locator('.modal-title:has-text("Choose image")')).toBeVisible();

    await page.setInputFiles('#uploadButton', {
      name: 'test.png',
      mimeType: 'image/png',
      buffer: TINY_PNG,
    });
    await expect(page.locator('.App-image-collection-image')).toBeVisible({ timeout: 5000 });
    await page.click('.modal button >> text="Close"');

    // Create a map (navigates to map page, then navigate back)
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

    // On phones, expand the map accordion
    if (Util.isPhone(deviceName)) {
      const mapToggle = page.locator('text="Mapped image"');
      await mapToggle.scrollIntoViewIfNeeded();
      await mapToggle.click();
    }

    // Click the pick-image button on the map card (secondary button with image icon)
    const mapImageBtn = page.locator('button.btn-secondary').filter({
      has: page.locator('svg[data-icon="image"]')
    }).first();
    await mapImageBtn.scrollIntoViewIfNeeded();
    await mapImageBtn.dispatchEvent('click');

    // Image picker opens — the previously uploaded image should be available
    await expect(page.locator('.modal-title:has-text("Choose image")')).toBeVisible();
    await expect(page.locator('.App-image-collection-image')).toBeVisible({ timeout: 3000 });

    // Select the image
    await page.click('text="Use this image"');
    await expect(page.locator('.modal-title:has-text("Choose image")')).not.toBeVisible();
  });
});
