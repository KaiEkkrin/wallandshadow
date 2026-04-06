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
    userStore: new WebStorageStateStore({ store: sessionStorage }),
    automaticSilentRenew: true,
  });

  return _userManager;
}

/** Whether OIDC is configured (env vars present). */
export function isOidcEnabled(): boolean {
  return !!(import.meta.env.VITE_OIDC_ISSUER && import.meta.env.VITE_OIDC_CLIENT_ID);
}

/** Redirect to the OIDC provider's login page. */
export async function startOidcLogin(): Promise<void> {
  await getUserManager().signinRedirect();
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

/** Get the access token from the current OIDC session. */
export async function getOidcAccessToken(): Promise<string | null> {
  const user = await getUserManager().getUser();
  return user?.access_token ?? null;
}
