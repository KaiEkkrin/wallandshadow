import { describe, test, expect } from 'vitest';

import { userNameText, DELETED_USER_LABEL } from './userNameText';

describe('userNameText', () => {
  test('returns the literal name when present', () => {
    expect(userNameText('Alice')).toBe('Alice');
  });

  test('falls back to DELETED_USER_LABEL for null', () => {
    expect(userNameText(null)).toBe(DELETED_USER_LABEL);
  });

  test('falls back to DELETED_USER_LABEL for undefined', () => {
    expect(userNameText(undefined)).toBe(DELETED_USER_LABEL);
  });

  test('falls back to DELETED_USER_LABEL for empty string', () => {
    expect(userNameText('')).toBe(DELETED_USER_LABEL);
  });
});
