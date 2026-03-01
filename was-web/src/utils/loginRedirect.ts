/**
 * Returns the path the user should land on after a successful login.
 * Validates that `from` is a safe internal path to prevent open-redirect attacks.
 */
export function getPostLoginPath(from: unknown): string {
  if (typeof from !== 'string') return '/app';
  if (!from.startsWith('/') || from.startsWith('//')) return '/app'; // block external URLs
  if (from === '/login') return '/app';                               // prevent redirect loop
  return from;
}
