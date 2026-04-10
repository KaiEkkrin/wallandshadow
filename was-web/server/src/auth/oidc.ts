import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';

export interface OidcClaims {
  sub: string;
  email?: string;
  emailVerified?: boolean;
  name?: string;
}

export interface OidcVerifier {
  verify(token: string): Promise<OidcClaims>;
  issuer: string;
}

/**
 * Create an OIDC token verifier for the given issuer.
 * Uses the issuer's JWKS endpoint to validate RS256 tokens.
 *
 * Accepts an optional jwks parameter for testing (inject a local key set
 * instead of fetching from a remote URL).
 */
export function createOidcVerifier(issuer: string, audience: string, jwks?: JWTVerifyGetKey): OidcVerifier {
  const keySet = jwks ?? createRemoteJWKSet(new URL(`${issuer}/oauth/v2/keys`));

  return {
    issuer,
    async verify(token: string): Promise<OidcClaims> {
      const { payload } = await jwtVerify(token, keySet, { issuer, audience });
      if (!payload.sub) {
        throw new Error('OIDC token missing sub claim');
      }
      return {
        sub: payload.sub,
        email: typeof payload.email === 'string' ? payload.email : undefined,
        emailVerified: typeof payload.email_verified === 'boolean' ? payload.email_verified : undefined,
        name: typeof payload.name === 'string' ? payload.name : undefined,
      };
    },
  };
}

let _verifier: OidcVerifier | undefined;
let _overridden = false;

/** Get the global OIDC verifier, or undefined if OIDC is not configured. */
export function getOidcVerifier(): OidcVerifier | undefined {
  if (_overridden) return _verifier;
  const issuer = process.env.OIDC_ISSUER;
  if (!issuer) return undefined;
  const audience = process.env.OIDC_CLIENT_ID;
  if (!audience) return undefined;
  if (!_verifier || _verifier.issuer !== issuer) {
    _verifier = createOidcVerifier(issuer, audience);
  }
  return _verifier;
}

/**
 * Override the global OIDC verifier (for testing).
 * Pass undefined to clear the override and revert to env-based behaviour.
 */
export function setOidcVerifier(verifier: OidcVerifier | undefined): void {
  _verifier = verifier;
  _overridden = verifier !== undefined;
}
