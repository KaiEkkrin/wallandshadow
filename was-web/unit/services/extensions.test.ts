import { vi } from 'vitest';
import { DataService } from './dataService';
import { ensureProfile } from './extensions';
import { IUser } from './interfaces';

import { Firestore, serverTimestamp } from 'firebase/firestore';
import {
  initializeTestEnvironment,
  RulesTestEnvironment,
} from '@firebase/rules-unit-testing';

import { v7 as uuidv7 } from 'uuid';
import md5 from 'blueimp-md5';
import * as fs from 'fs';
import * as path from 'path';

import adminCredentials from '../../firebase-admin-credentials.json';

export function createTestUser(
  displayName: string | null,
  email: string | null,
  providerId: string,
  emailVerified?: boolean | undefined,
): IUser {
  return {
    displayName: displayName,
    email: email,
    emailMd5: email ? md5(email) : null,
    emailVerified: emailVerified ?? true,
    providerId: providerId,
    uid: uuidv7(),
    changePassword: vi.fn(),
    sendEmailVerification: vi.fn(),
    updateProfile: vi.fn()
  };
}

describe('test extensions', () => {
  const projectId = String(adminCredentials?.project_id ?? 'hexland-test');
  let testEnv: RulesTestEnvironment;

  beforeAll(async () => {
    // Read the Firestore rules
    const rulesPath = path.join(__dirname, '../../firestore.rules');
    const rules = fs.readFileSync(rulesPath, 'utf8');

    testEnv = await initializeTestEnvironment({
      projectId: projectId,
      firestore: {
        host: 'localhost',
        port: 8080,
        rules: rules,
      },
    });
  });

  afterAll(async () => {
    await testEnv?.cleanup();
  });

  beforeEach(async () => {
    await testEnv?.clearFirestore();
  });

  test('create a new profile entry', async () => {
    const user = createTestUser('Owner', 'owner@example.com', 'google.com');

    // Get an authenticated Firestore context for this user
    const context = testEnv.authenticatedContext(user.uid, {
      email: user.email ?? undefined,
      email_verified: user.emailVerified,
    });
    const db = context.firestore() as unknown as Firestore;
    const dataService = new DataService(db, serverTimestamp);
    const profile = await ensureProfile(dataService, user, undefined);

    expect(profile?.name).toBe('Owner');

    // If we fetch it, it should not get re-created or updated (changing their Wall & Shadow display
    // name should be our UI feature, it shouldn't sync with the provider's idea of it)
    const profile2 = await ensureProfile(dataService, { ...user, displayName: 'fish' }, undefined);
    expect(profile2?.name).toBe('Owner');
  });

  test('create a new profile entry using user-entered display name instead of Google display name', async () => {
    // This simulates the Google OAuth signup flow: the user object has Google's display
    // name, but we pass the user-entered displayName to ensureProfile so the profile is
    // created with the right name.
    const user = createTestUser('John Smith (Google)', 'john@example.com', 'google.com');

    const context = testEnv.authenticatedContext(user.uid, {
      email: user.email ?? undefined,
      email_verified: user.emailVerified,
    });
    const db = context.firestore() as unknown as Firestore;
    const dataService = new DataService(db, serverTimestamp);

    // Pass the user-entered display name explicitly (as ProfileContextProvider does
    // via popNewUser when expectGoogleSignup was called before the popup)
    const profile = await ensureProfile(dataService, user, undefined, 'My Custom Name');

    expect(profile?.name).toBe('My Custom Name');
  });

  test('user-entered display name does not overwrite an existing non-default profile name', async () => {
    // Verifies that passing a displayName to ensureProfile only affects NEW profiles
    // (or profiles with empty/default names), not existing ones with real names.
    const user = createTestUser('Original Name', 'user2@example.com', 'google.com');

    const context = testEnv.authenticatedContext(user.uid, {
      email: user.email ?? undefined,
      email_verified: user.emailVerified,
    });
    const db = context.firestore() as unknown as Firestore;
    const dataService = new DataService(db, serverTimestamp);

    // First login: profile created with the user's displayName
    await ensureProfile(dataService, user, undefined);

    // Second login (e.g. returning user): passing a displayName should NOT overwrite
    // the existing profile name
    const profile2 = await ensureProfile(dataService, user, undefined, 'Should Not Apply');
    expect(profile2?.name).toBe('Original Name');
  });
});