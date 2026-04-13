/**
 * Validate auth-related environment variables at startup.
 * Throws if production is misconfigured — fail fast rather than serving
 * requests with broken auth.
 */
export function validateAuthEnv(): void {
  const isProduction = process.env.NODE_ENV === 'production';
  if (!isProduction) return;

  const errors: string[] = [];

  if (!process.env.JWT_SECRET) {
    errors.push('JWT_SECRET is required in production');
  }

  if (process.env.AUTH_MODE !== 'oidc') {
    errors.push('AUTH_MODE must be "oidc" in production (local password auth is not allowed)');
  }

  if (!process.env.OIDC_ISSUER) {
    errors.push('OIDC_ISSUER is required in production when AUTH_MODE=oidc');
  }

  if (!process.env.OIDC_CLIENT_ID) {
    errors.push('OIDC_CLIENT_ID is required in production when AUTH_MODE=oidc');
  }

  if (errors.length > 0) {
    throw new Error(`Auth configuration errors:\n  - ${errors.join('\n  - ')}`);
  }
}
