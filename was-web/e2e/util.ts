import * as path from 'path';

import { Page, expect } from '@playwright/test';
import { v7 as uuidv7 } from 'uuid';

import { SCREENSHOTS_PATH } from './globals';

// Various utility functions for testing.

/**
 * Accepts the cookie consent banner by clicking the Accept button and waiting for it to disappear.
 * Uses precise mouse positioning to avoid clicks being intercepted by the Firebase emulator warning.
 */
export async function acceptCookieConsent(page: Page) {
  // Click on the top-left of the Accept button to avoid the Firebase emulator warning banner
  const acceptButton = page.locator('.App-consent-card .btn-success');
  const buttonBox = await acceptButton.boundingBox();
  if (buttonBox) {
    // Click 10px from left, 8px from top (top half of button)
    await page.mouse.click(buttonBox.x + 10, buttonBox.y + 8);
  } else {
    throw new Error('Accept button not found');
  }

  // Wait for consent banner to hide after accepting (localStorage must save before we navigate)
  await expect(page.locator('.App-consent-container')).not.toBeVisible({ timeout: 3000 });
}

// Helper to extract device name from project name (e.g., "chromium-iphone7" -> "iPhone 7")
export function getDeviceNameFromProject(projectName: string): string {
  if (projectName.includes('iphone7')) return 'iPhone 7';
  if (projectName.includes('pixel2')) return 'Pixel 2';
  if (projectName.includes('laptop')) return 'Laptop';
  if (projectName.includes('desktop')) return 'Desktop';
  return 'Desktop'; // default
}

// Helper to extract browser name from project name (e.g., "chromium-laptop" -> "chromium")
export function getBrowserNameFromProject(projectName: string): string {
  if (projectName.startsWith('chromium')) return 'chromium';
  if (projectName.startsWith('firefox')) return 'firefox';
  if (projectName.startsWith('webkit')) return 'webkit';
  return 'chromium'; // default
}

export function takeScreenshot(page: Page, browserName: string, deviceName: string, message: string) {
  return page.screenshot({
    path: path.join(
      SCREENSHOTS_PATH, `${browserName}_${deviceName}_${message}.png`
    )
  });
}

export async function takeAndVerifyScreenshot(page: Page, browserName: string, deviceName: string, message: string) {
  // Wait a bit to give animations some time to complete
  // (I don't see a nice way to do this better)
  await new Promise((resolve) => setTimeout(resolve, 500));

  // Use Playwright's native screenshot comparison
  await expect(page).toHaveScreenshot(`${browserName}_${deviceName}_${message}.png`, {
    maxDiffPixelRatio: 0.05, // 5% threshold (matching failureThreshold from old setup)
  });
}

export function isPhone(deviceName: string) {
  return /(iPhone)|(Pixel)/.test(deviceName);
}

export async function ensureNavbarExpanded(page: Page, deviceName: string) {
  // On phones we'll get the collapsed hamburger thingy
  if (isPhone(deviceName)) {
    // Click the navbar toggle
    await page.click('[aria-controls="basic-navbar-nav"]');
    // Wait for the navbar to actually expand by checking for a link inside it
    await expect(page.locator('#basic-navbar-nav .nav-link').first()).toBeVisible({ timeout: 5000 });
  }
}

export async function whileNavbarExpanded(page: Page, deviceName: string, fn: () => Promise<void>) {
  // Likewise
  if (isPhone(deviceName)) {
    // Click the navbar toggle
    await page.click('[aria-controls="basic-navbar-nav"]');
    // Wait for the navbar to actually expand by checking for a link inside it
    await expect(page.locator('#basic-navbar-nav .nav-link').first()).toBeVisible({ timeout: 5000 });

    await fn();

    await page.click('[aria-controls="basic-navbar-nav"]'); // collapse it back down again
  } else {
    await fn();
  }
}

export type User = { displayName: string, email: string, number: number, password: string };
let signupNumber = 0;

export async function signIn(page: Page, user: User, deviceName: string) {
  await ensureNavbarExpanded(page, deviceName);

  // Go through the login page
  await page.click('text="Sign up/Login"');
  await expect(page.locator('.App-login-text').first()).toBeVisible();

  // Click the "Login existing user" button and wait for it to be clickable
  const loginButton = page.locator('button >> text="Login existing user"');
  await loginButton.waitFor({ state: 'visible' });
  await loginButton.click();

  // Wait for the modal to open and the form fields to be visible
  await expect(page.locator('[id=emailInput]')).toBeVisible();

  // Fill in the form (email/password radio is selected by default)
  await page.fill('[id=emailInput]', user.email);
  await page.fill('[id=passwordInput]', user.password);
  await page.click('button >> text=/^Sign in$/');

  // Wait for the home page to load (shows Latest maps/adventures when logged in)
  await expect(page.locator('h5 >> text="Latest maps"')).toBeVisible();
}

export async function signUp(page: Page, deviceName: string, prefix?: string | undefined): Promise<User> {
  await ensureNavbarExpanded(page, deviceName);

  // Go through the login page
  await page.click('text="Sign up/Login"');
  await expect(page.locator('.App-login-text').first()).toBeVisible();

  // Click the "Sign up new user" button and wait for it to be clickable
  const signUpButton = page.locator('button >> text="Sign up new user"');
  await signUpButton.waitFor({ state: 'visible' });
  await signUpButton.click();

  // Wait for the modal to open and the form fields to be visible
  await expect(page.locator('[id=nameInput]')).toBeVisible();

  // Fill in the form.  Take care to create unique email addresses because
  // we may be re-using the authentication emulator instance from another run
  const n = ++signupNumber;
  const user = {
    displayName: `${prefix ?? "Test"} ${n}`,
    email: `${prefix ?? "Test"}${n}-${uuidv7()}@example.com`.toLowerCase(),
    number: n,
    password: `${prefix ?? "Test"}_password${n}`
  };
  await page.fill('[id=nameInput]', user.displayName);
  // Email/password radio is selected by default, so fill in email/password fields
  await page.fill('[id=newEmailInput]', user.email);
  await page.fill('[id=newPasswordInput]', user.password);
  await page.fill('[id=confirmPasswordInput]', user.password);

  // Sign up
  await page.click('button >> text="Sign up"');

  // Wait for the home page to load (shows Latest maps/adventures when logged in)
  await expect(page.locator('h5 >> text="Latest maps"')).toBeVisible();

  return user;
}

export async function createNewAdventure(page: Page, name: string, description: string) {
  await page.click('text="New adventure"');

  await page.fill('[id=adventureNameInput]', name);
  await page.fill('[id=adventureDescriptionInput]', description);
  await page.click('text="Save adventure"');
}

export async function createNewMap(
  page: Page,
  name: string, description: string, type: string, adventureId?: string | undefined, ffa?: boolean | undefined
) {
  // This tends to disappear off the bottom on phones
  const newMap = await page.waitForSelector('text="New map"');
  await newMap.scrollIntoViewIfNeeded();
  await newMap.click();

  await page.fill('[id=mapNameInput]', name);
  await page.fill('[id=mapDescriptionInput]', description);
  await page.selectOption('select#mapType', type);
  if (adventureId !== undefined) {
    await page.selectOption('select#mapAdventureSelect', { value: adventureId });
  }

  if (ffa === true) {
    await page.check('[id=mapFfa]');
  }

  // Wait for navigation to complete after clicking Save
  // React Router uses history.replace() which is client-side navigation
  await Promise.all([
    page.waitForURL('**/map/**', { timeout: 10000 }), // Wait for URL to change to map page
    page.click('text="Save map"'),
  ]);

  console.log('✓ Navigation to map page completed, URL:', page.url());
}

export async function verifyMap(
  page: Page, browserName: string, deviceName: string,
  adventureName: string, adventureDescription: string, mapName: string, message: string
) {
  // After createNewMap, we should be on the map page.
  // Two possible outcomes:
  // 1. WebGL works: .Throbber-container disappears, map renders normally
  // 2. WebGL fails: "Error loading map" toast appears, map stays on page with controls

  const throbberGone = expect(page.locator('.Throbber-container')).not.toBeVisible({ timeout: 30000 });
  const errorToast = page.locator('.toast-header:has-text("Error loading map")');
  const errorAppeared = errorToast.waitFor({ state: 'visible', timeout: 30000 });

  const which = await Promise.race([
    throbberGone.then(() => 'map' as const),
    errorAppeared.then(() => 'error' as const),
  ]);

  if (which === 'map') {
    // WebGL succeeded -- full verification path
    console.log('✓ Throbber disappeared, WebGL working');

    await page.waitForLoadState('networkidle', { timeout: 10000 });
    console.log('✓ Network idle');

    await whileNavbarExpanded(page, deviceName, async () => {
      const adventureLink = page.locator('[aria-label="Link to this adventure"]');
      await expect(adventureLink).toBeVisible({ timeout: 10000 });
      await expect(adventureLink).toContainText(adventureName);

      const mapLink = page.locator('[aria-label="Link to this map"]');
      await expect(mapLink).toBeVisible({ timeout: 10000 });
      await expect(mapLink).toContainText(mapName);
    });

    await page.waitForTimeout(500);
    await takeAndVerifyScreenshot(page, browserName, deviceName, message);

    // Return to the adventure page via breadcrumb
    await whileNavbarExpanded(page, deviceName, async () => {
      await page.locator('[aria-label="Link to this adventure"]').filter({ hasText: adventureName }).click();
    });
    await expect(page.locator('.card-text').filter({ hasText: adventureDescription })).toBeVisible();
  } else {
    // WebGL failed -- verify map controls still rendered, then navigate back
    console.log('✓ WebGL not available, verifying map controls are present');
    await expect(page.locator('.Map-controls')).toBeVisible();

    await page.click('.toast-header .btn-close');

    // Navigate back to adventure page via Home
    await navigateToAdventure(page, deviceName, adventureName, adventureDescription);
  }
}

export async function dismissAllToasts(page: Page) {
  // Close any visible toasts (WebGL errors may fire multiple times)
  while (true) {
    const closeBtn = page.locator('.toast-header .btn-close').first();
    if (await closeBtn.isVisible({ timeout: 500 }).catch(() => false)) {
      await closeBtn.click();
      await page.waitForTimeout(200);
    } else {
      break;
    }
  }
}

async function navigateToAdventure(
  page: Page, deviceName: string, adventureName: string, adventureDescription: string
) {
  await dismissAllToasts(page);
  await ensureNavbarExpanded(page, deviceName);
  await page.click('.nav-link >> text="Home"');
  await expect(page.locator('h5 >> text="Latest maps"')).toBeVisible();
  await dismissAllToasts(page);

  if (isPhone(deviceName)) {
    const adventureToggle = page.locator(`text="${adventureName}"`);
    await adventureToggle.scrollIntoViewIfNeeded();
    await adventureToggle.click();
  }

  await page.click('text="Open adventure"');
  await expect(page.locator('.card-text').filter({ hasText: adventureDescription })).toBeVisible();
  await dismissAllToasts(page);
}
