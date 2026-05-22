import { describe, test, expect } from 'vitest';
import {
  UserLevel,
  getUserPolicy,
  basicUser,
  higherUser,
  adminUser,
  canUploadImages,
  isAdmin,
} from './policy';

describe('getUserPolicy', () => {
  test('Basic tier returns the basicUser policy', () => {
    expect(getUserPolicy(UserLevel.Basic)).toEqual(basicUser);
  });

  test('Higher tier returns the higherUser policy', () => {
    expect(getUserPolicy(UserLevel.Higher)).toEqual(higherUser);
  });

  test('Admin tier returns the adminUser policy', () => {
    expect(getUserPolicy(UserLevel.Admin)).toEqual(adminUser);
  });

  test('every UserLevel value resolves to a policy', () => {
    // Guards against a future tier being added to the enum without a switch arm.
    for (const level of Object.values(UserLevel)) {
      expect(getUserPolicy(level)).toBeDefined();
    }
  });

  test('the Basic tier cannot upload images', () => {
    expect(basicUser.images).toBe(0);
  });
});

describe('canUploadImages', () => {
  test('is false for Basic', () => {
    expect(canUploadImages(UserLevel.Basic)).toBe(false);
  });

  test('is true for Higher and Admin', () => {
    expect(canUploadImages(UserLevel.Higher)).toBe(true);
    expect(canUploadImages(UserLevel.Admin)).toBe(true);
  });
});

describe('isAdmin', () => {
  test('is true only for the Admin tier', () => {
    expect(isAdmin(UserLevel.Admin)).toBe(true);
    expect(isAdmin(UserLevel.Higher)).toBe(false);
    expect(isAdmin(UserLevel.Basic)).toBe(false);
  });
});
