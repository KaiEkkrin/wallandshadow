import { IAuth, IAuthProvider, IUser } from '@wallandshadow/shared';
import { HonoApiClient, isAccountSuspendedError } from './honoApiClient';
import { isOidcEnabled, startOidcLogin, getOidcUser, getOidcBearerToken, oidcSignOut, subscribeToTokenRenewal } from './oidcAuth';
import md5 from 'blueimp-md5';

const TOKEN_KEY = 'was_hono_token';

// ── IUser implementation ─────────────────────────────────────────────────────

export class HonoUser implements IUser {
  readonly uid: string;
  readonly email: string | null;
  readonly displayName: string;
  readonly emailMd5: string | null;
  readonly emailVerified: boolean;
  readonly providerId: string;

  constructor(uid: string, email: string | null, name: string, emailVerified: boolean, providerId: string = 'password') {
    this.uid = uid;
    this.email = email;
    this.displayName = name;
    this.emailMd5 = email ? md5(email.trim().toLowerCase()) : null;
    this.emailVerified = emailVerified;
    this.providerId = providerId;
  }
}

// ── IAuth implementation ─────────────────────────────────────────────────────

type AuthListener = (user: IUser | null) => void;

export class HonoAuth implements IAuth {
  private readonly api: HonoApiClient;
  private readonly listeners = new Set<AuthListener>();
  private currentUser: IUser | null = null;
  private initialized = false;
  // True once the initial restoreSession() has settled. Until then currentUser
  // is the pre-restore default and must not be reported as a settled state.
  private sessionResolved = false;
  // Set when a /auth/me call is rejected with 403 account-suspended. The user
  // is not signed in, but must be shown the Suspended page rather than login.
  suspended = false;
  readonly oidcEnabled: boolean;

  constructor(api: HonoApiClient) {
    this.api = api;
    this.oidcEnabled = isOidcEnabled();
    if (this.oidcEnabled) {
      // Keep api.token current whenever oidc-client-ts silently renews the token
      // so that the next WebSocket reconnect uses a fresh URL.
      subscribeToTokenRenewal(
        token => this.api.setToken(token),
        () => {
          this.clearSession();
          this.fireListeners(null);
        },
      );
    }
  }

  private fireListeners(user: IUser | null): void {
    this.currentUser = user;
    for (const listener of this.listeners) {
      listener(user);
    }
  }

  private storeLocalToken(token: string): void {
    localStorage.setItem(TOKEN_KEY, token);
    this.api.setToken(token);
  }

  private clearSession(): void {
    localStorage.removeItem(TOKEN_KEY);
    this.api.setToken(null);
  }

  /** Try to restore a session from local JWT or OIDC session storage. */
  private async restoreSession(): Promise<IUser | null> {
    // Try OIDC session first
    if (this.oidcEnabled) {
      const oidcUser = await this.tryRestoreOidcSession();
      if (oidcUser) return oidcUser;
    }

    // Fall back to local JWT
    return this.tryRestoreLocalSession();
  }

  private async tryRestoreOidcSession(): Promise<IUser | null> {
    try {
      const oidcUser = await getOidcUser();
      if (!oidcUser || oidcUser.expired) return null;

      const token = getOidcBearerToken(oidcUser);
      this.api.setToken(token);
      const me = await this.api.getMe();
      return new HonoUser(me.uid, me.email, me.name, me.emailVerified, 'oidc');
    } catch (e) {
      // Keep the persisted OIDC session so a reload re-detects suspension
      // instead of dropping the user to the login page; but drop the in-memory
      // bearer so subsequent API/WS calls don't re-attempt as the banned user.
      if (isAccountSuspendedError(e)) {
        this.suspended = true;
        this.api.setToken(null);
      }
      return null;
    }
  }

  private async tryRestoreLocalSession(): Promise<IUser | null> {
    const token = localStorage.getItem(TOKEN_KEY);
    if (!token) return null;

    // Check expiration by decoding the JWT payload (no verification — just the exp claim)
    try {
      const payload = JSON.parse(atob(token.split('.')[1]));
      if (payload.exp && payload.exp * 1000 < Date.now()) {
        this.clearSession();
        return null;
      }
    } catch {
      this.clearSession();
      return null;
    }

    // Validate with server and get current user data
    this.api.setToken(token);
    try {
      const me = await this.api.getMe();
      return new HonoUser(me.uid, me.email, me.name, me.emailVerified, 'password');
    } catch (e) {
      if (isAccountSuspendedError(e)) {
        // Keep the persisted JWT so a reload re-detects suspension rather than
        // dropping the user back to the login page; but drop the in-memory
        // bearer so subsequent API/WS calls don't re-attempt as the banned user.
        this.suspended = true;
        this.api.setToken(null);
        return null;
      }
      this.clearSession();
      return null;
    }
  }

  /**
   * Complete an OIDC login after the callback redirect.
   * Called by OidcCallback component.
   */
  async completeOidcLogin(accessToken: string): Promise<void> {
    this.api.setToken(accessToken);
    try {
      const me = await this.api.getMe();
      const user = new HonoUser(me.uid, me.email, me.name, me.emailVerified, 'oidc');
      // A successful getMe() is authoritative — clear any stale suspended flag
      // left behind by an earlier failed session-restore.
      this.suspended = false;
      this.fireListeners(user);
    } catch (e) {
      if (isAccountSuspendedError(e)) {
        // A banned account: surface the Suspended page rather than an error.
        this.suspended = true;
        this.api.setToken(null);
        this.fireListeners(null);
        return;
      }
      this.api.setToken(null);
      throw e;
    }
  }

  async createUserWithEmailAndPassword(email: string, password: string, displayName: string): Promise<IUser | null> {
    const { token, uid } = await this.api.register(email, password, displayName);
    this.storeLocalToken(token);
    const user = new HonoUser(uid, email, displayName, false, 'password');
    this.fireListeners(user);
    return user;
  }

  async signInWithEmailAndPassword(email: string, password: string): Promise<IUser | null> {
    const { token } = await this.api.login(email, password);
    this.storeLocalToken(token);
    let me;
    try {
      me = await this.api.getMe();
    } catch (e) {
      if (isAccountSuspendedError(e)) {
        // A banned account: surface the Suspended page rather than an error.
        // Keep the persisted JWT so a reload re-detects suspension; drop the
        // in-memory bearer so subsequent calls don't re-attempt as the banned user.
        this.suspended = true;
        this.api.setToken(null);
        this.fireListeners(null);
        return null;
      }
      throw e;
    }
    const user = new HonoUser(me.uid, me.email, me.name, me.emailVerified, 'password');
    // A successful getMe() is authoritative — clear any stale suspended flag.
    this.suspended = false;
    this.fireListeners(user);
    return user;
  }

  async signInWithPopup(_provider: IAuthProvider | undefined): Promise<IUser | null> {
    if (this.oidcEnabled) {
      // Redirect to OIDC provider — returns null because auth completes after redirect
      await startOidcLogin();
      return null;
    }
    throw new Error('External sign-in not available (OIDC not configured)');
  }

  async signOut(): Promise<void> {
    const wasOidcUser = this.currentUser?.providerId === 'oidc';
    this.suspended = false;
    this.clearSession();
    this.fireListeners(null);
    if (wasOidcUser) {
      try {
        await oidcSignOut();
      } catch {
        // Best-effort OIDC sign-out — local session is already cleared
      }
    }
  }

  onAuthStateChanged(
    onNext: (user: IUser | null) => void,
    onError?: ((e: Error) => void) | undefined
  ): () => void {
    this.listeners.add(onNext);

    if (!this.initialized) {
      this.initialized = true;
      this.restoreSession()
        .then(user => {
          this.sessionResolved = true;
          this.fireListeners(user);
        })
        .catch(e => {
          this.sessionResolved = true;
          this.fireListeners(null);
          onError?.(e instanceof Error ? e : new Error(String(e)));
        });
    } else if (this.sessionResolved) {
      // The initial restore has settled — a late subscriber gets the current
      // value immediately.
      onNext(this.currentUser);
    }
    // Otherwise restoreSession() is still in flight: do NOT emit currentUser.
    // It is still the pre-restore default (null); a subscriber arriving in this
    // window — e.g. React StrictMode re-running the effect — would mistake it
    // for "logged out" and redirect away from a protected route. The listener
    // is registered and will be notified when the restore resolves.

    return () => {
      this.listeners.delete(onNext);
    };
  }
}
