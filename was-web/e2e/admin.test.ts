import { test, expect } from '@playwright/test';

import * as Util from './util';
import { createApiUser, setupAdventure } from './apiFixture';
import { promoteToAdmin, setUserLevel } from './dbAdmin';

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

  // Promotes a Basic user to Higher via the admin UI; verifies the new caps
  // take effect by attempting an image upload before and after promotion.
  test('an admin can promote a Basic user to Higher', async ({ page }, testInfo) => {
    const deviceName = Util.getDeviceNameFromProject(testInfo.project.name);

    const admin = await createApiUser('PromoteAdmin');
    await promoteToAdmin(admin.email);
    const target = await createApiUser('PromoteTarget');

    // A 1x1 red PNG (68 bytes) — the same fixture the server-side tests use.
    const tinyPng = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==',
      'base64',
    );

    // Before promotion: Basic-tier upload is rejected (images: 0 cap).
    await expect(
      target.api.uploadImage(tinyPng, 'before-promotion'),
    ).rejects.toThrow();

    // Sign in as admin and navigate to the target's account-info page.
    await page.goto('/');
    await Util.signIn(
      page,
      { displayName: admin.displayName, email: admin.email, number: 0, password: admin.password },
      deviceName,
    );
    await page.goto(`/admin/users/${target.uid}`);
    await expect(page.locator('h5', { hasText: 'Account:' })).toBeVisible();

    // Pick Higher in the tier dropdown and apply.
    await page.locator('#adminTierSelect').selectOption('higher');
    await page.locator('#adminTierApply').click();

    // The card refreshes to show the new tier (toast surfaces success too).
    await expect(page.locator('text=/^Tier: higher$/')).toBeVisible();

    // After promotion: the same upload succeeds (Higher-tier limit is 200).
    const result = await target.api.uploadImage(tinyPng, 'after-promotion');
    expect(result.path).toMatch(/^images\//);
  });

  // Bans a user via the admin UI; verifies they land on the Suspended page on
  // their next page load (using a second browser context for the banned user).
  test('an admin can ban a user; the banned user is locked out', async ({ browser, page }, testInfo) => {
    const deviceName = Util.getDeviceNameFromProject(testInfo.project.name);

    const admin = await createApiUser('BanAdmin');
    await promoteToAdmin(admin.email);
    const target = await createApiUser('BanTarget');

    // Sign in as admin and navigate to the target's account-info page.
    await page.goto('/');
    await Util.signIn(
      page,
      { displayName: admin.displayName, email: admin.email, number: 0, password: admin.password },
      deviceName,
    );
    await page.goto(`/admin/users/${target.uid}`);

    // Open the ban confirmation modal.
    await page.locator('#adminBanButton').click();
    await expect(page.locator('#banConfirmInput')).toBeVisible();

    // The destructive button is disabled until the operator types the
    // target's display name verbatim.
    await expect(page.locator('#banConfirmButton')).toBeDisabled();
    await page.locator('#banConfirmInput').fill(target.displayName);
    await expect(page.locator('#banConfirmButton')).toBeEnabled();
    await page.locator('#banConfirmButton').click();

    // The modal closes and the banned badge appears on the account-info page.
    await expect(page.locator('#bannedBadge')).toBeVisible();

    // In a separate browser context, sign in as the banned target. We can't
    // reuse Util.signIn here because it asserts the home page renders after
    // login — for a banned account the next /me request returns 403 and
    // SuspendedGate replaces the route with the Suspended page instead.
    const bannedContext = await browser.newContext();
    const bannedPage = await bannedContext.newPage();
    try {
      await bannedPage.goto('/');
      await Util.ensureNavbarExpanded(bannedPage, deviceName);
      await bannedPage.click('text="Sign up/Login"');
      await expect(bannedPage.locator('.App-login-text').first()).toBeVisible();
      await bannedPage.locator('button >> text="Login existing user"').click();
      await expect(bannedPage.locator('[id=emailInput]')).toBeVisible();
      await bannedPage.fill('[id=emailInput]', target.email);
      await bannedPage.fill('[id=passwordInput]', target.password);
      await bannedPage.click('button >> text=/^Sign in$/');

      // SuspendedGate renders the Suspended page in place of the normal
      // routes once the client detects the account-suspended state.
      await expect(bannedPage.locator('text="Account suspended"')).toBeVisible();
    } finally {
      await bannedContext.close();
    }
  });

  // Basic-tier users have images cap = 0 and cannot upload images. Every UI
  // affordance that leads to an image picker should be hidden for them — not
  // merely shown-then-rejected. This test asserts that the adventure banner
  // button and the character editor's Image tab are absent on Basic and
  // reappear after the tier is bumped to Higher.
  test('image-upload affordances are hidden on Basic and shown after promotion', async ({ page }, testInfo) => {
    const deviceName = Util.getDeviceNameFromProject(testInfo.project.name);

    // Fresh user starts as Basic (the default for new registrations). Create
    // an adventure via the API so the user can navigate straight to it.
    const user = await createApiUser('TierGate');
    const adventureId = await setupAdventure(user.api, 'TierGate Adventure', 'an adventure');

    // Sign in via the browser and open the adventure page.
    await page.goto('/');
    await Util.signIn(
      page,
      { displayName: user.displayName, email: user.email, number: 0, password: user.password },
      deviceName,
    );
    await page.goto(`/adventure/${adventureId}`);

    // Owner is signed in, so the Edit button on the adventure card is present
    // — assert that as the anchor that proves the card has rendered before
    // checking for the absence of the image button next to it.
    const editButton = page.locator('button', { hasText: 'Edit' }).first();
    await expect(editButton).toBeVisible();
    const bannerImageButton = page.locator('button[aria-label="Set adventure image"]');
    await expect(bannerImageButton).toHaveCount(0);

    // Open the character editor and assert the Image tab is not rendered.
    await page.locator('button', { hasText: 'New character' }).click();
    await expect(page.locator('.modal-title', { hasText: 'Character' })).toBeVisible();
    await expect(
      page.locator('[role="tab"]', { hasText: 'Properties' }),
    ).toBeVisible();
    await expect(page.locator('[role="tab"]', { hasText: 'Image' })).toHaveCount(0);
    // Dismiss the modal before promoting the user.
    await page.locator('.modal-footer button', { hasText: 'Close' }).click();
    await expect(page.locator('.modal-title', { hasText: 'Character' })).not.toBeVisible();

    // Promote in the DB and reload — the client picks up the fresh tier from
    // /api/auth/me on next page load.
    await setUserLevel(user.email, 'higher');
    await page.reload();
    await page.waitForURL(`**/adventure/${adventureId}`);

    // Same anchor + presence assertions, post-promotion.
    await expect(page.locator('button', { hasText: 'Edit' }).first()).toBeVisible();
    await expect(bannerImageButton).toBeVisible();

    await page.locator('button', { hasText: 'New character' }).click();
    await expect(page.locator('.modal-title', { hasText: 'Character' })).toBeVisible();
    await expect(page.locator('[role="tab"]', { hasText: 'Image' })).toBeVisible();
  });

  // Regression: the ban confirmation modal wraps its input in a <Form>.
  // Without an onSubmit handler that calls preventDefault, pressing Enter in
  // the input triggers HTML implicit form submission and the page reloads —
  // dismissing the modal without performing the ban. The fix is to call
  // preventDefault and chain Enter into handleBan. This test exercises that
  // path: type the confirm string, press Enter, and assert the ban proceeds.
  test('pressing Enter in the ban confirm input submits the ban (no reload)', async ({ page }, testInfo) => {
    const deviceName = Util.getDeviceNameFromProject(testInfo.project.name);

    const admin = await createApiUser('BanEnterAdmin');
    await promoteToAdmin(admin.email);
    const target = await createApiUser('BanEnterTarget');

    await page.goto('/');
    await Util.signIn(
      page,
      { displayName: admin.displayName, email: admin.email, number: 0, password: admin.password },
      deviceName,
    );
    await page.goto(`/admin/users/${target.uid}`);

    // Open modal, type the confirm string, press Enter (no button click).
    await page.locator('#adminBanButton').click();
    await page.locator('#banConfirmInput').fill(target.displayName);
    await page.locator('#banConfirmInput').press('Enter');

    // The ban succeeds: banned badge appears. If implicit form submission
    // had reloaded the page, the modal would have dismissed without making
    // the ban request and #bannedBadge would never appear.
    await expect(page.locator('#bannedBadge')).toBeVisible();
  });
});
