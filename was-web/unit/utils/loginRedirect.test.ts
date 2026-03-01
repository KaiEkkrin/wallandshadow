import { getPostLoginPath } from '../../src/utils/loginRedirect';

test('returns /app for undefined', () => {
  expect(getPostLoginPath(undefined)).toBe('/app');
});

test('returns /app for null', () => {
  expect(getPostLoginPath(null)).toBe('/app');
});

test('returns /app for non-string types', () => {
  expect(getPostLoginPath(42)).toBe('/app');
  expect(getPostLoginPath({})).toBe('/app');
  expect(getPostLoginPath([])).toBe('/app');
  expect(getPostLoginPath(true)).toBe('/app');
});

test('returns /app for empty string', () => {
  expect(getPostLoginPath('')).toBe('/app');
});

test('returns /app for external https URLs', () => {
  expect(getPostLoginPath('https://evil.com')).toBe('/app');
  expect(getPostLoginPath('http://evil.com')).toBe('/app');
});

test('returns /app for protocol-relative URLs', () => {
  expect(getPostLoginPath('//evil.com')).toBe('/app');
  expect(getPostLoginPath('//evil.com/steal-tokens')).toBe('/app');
});

test('returns /app for /login to prevent redirect loop', () => {
  expect(getPostLoginPath('/login')).toBe('/app');
});

test('returns the path for valid invite paths', () => {
  expect(getPostLoginPath('/invite/abc123')).toBe('/invite/abc123');
  expect(getPostLoginPath('/invite/some-longer-id-here')).toBe('/invite/some-longer-id-here');
});

test('returns the path for other valid internal paths', () => {
  expect(getPostLoginPath('/app')).toBe('/app');
  expect(getPostLoginPath('/adventure/xyz789')).toBe('/adventure/xyz789');
  expect(getPostLoginPath('/adventure/xyz789/map/map001')).toBe('/adventure/xyz789/map/map001');
});
