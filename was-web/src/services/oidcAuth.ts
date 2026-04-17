import { UserManager, WebStorageStateStore, type User as OidcUser } from 'oidc-client-ts';

let _userManager: UserManager | undefined;

function getUserManager(): UserManager {
  if (_userManager) return _userManager;

  const issuer = import.meta.env.VITE_OIDC_ISSUER;
  const clientId = import.meta.env.VITE_OIDC_CLIENT_ID;
  if (!issuer || !clientId) {
    throw new Error('OIDC is not configured (VITE_OIDC_ISSUER and VITE_OIDC_CLIENT_ID required)');
  }

  _userManager = new UserManager({
    authority: issuer,
    client_id: clientId,
    redirect_uri: `${window.location.origin}/auth/callback`,
    post_logout_redirect_uri: `${window.location.origin}/login`,
    response_type: 'code',
    scope: 'openid profile email',
    // localStorage so the user record is shared across tabs; sessionStorage left
    // a fresh tab (invite link opened externally) appearing logged-out.
    userStore: new WebStorageStateStore({ store: localStorage }),
    automaticSilentRenew: true,
  });

  return _userManager;
}

/** Whether OIDC is configured (env vars present). */
export function isOidcEnabled(): boolean {
  return !!(import.meta.env.VITE_OIDC_ISSUER && import.meta.env.VITE_OIDC_CLIENT_ID);
}

/**
 * Redirect to the OIDC provider's login page. A string `from` is round-tripped
 * through the provider and recovered in `handleOidcCallback` via `user.state.from`.
 */
export async function startOidcLogin(from?: unknown): Promise<void> {
  const state = typeof from === 'string' ? { from } : undefined;
  await getUserManager().signinRedirect(state ? { state } : undefined);
}

/** Process the OIDC callback after redirect. Returns the authenticated OIDC user. */
export async function handleOidcCallback(): Promise<OidcUser> {
  return getUserManager().signinRedirectCallback();
}

/** Get the current OIDC user from session storage (if any). */
export async function getOidcUser(): Promise<OidcUser | null> {
  return getUserManager().getUser();
}

/** Sign out via the OIDC provider. */
export async function oidcSignOut(): Promise<void> {
  await getUserManager().signoutRedirect();
}

/**
 * Extract the Bearer token from an OIDC user object.
 * Prefers id_token (always a JWT) over access_token (which may be opaque
 * depending on Zitadel project settings).
 */
export function getOidcBearerToken(user: OidcUser): string {
  return user.id_token ?? user.access_token;
}
