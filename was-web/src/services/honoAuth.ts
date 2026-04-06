import { IAuth, IAuthProvider, IUser } from '@wallandshadow/shared';
import { HonoApiClient } from './honoApi';
import { isOidcEnabled, startOidcLogin, getOidcUser, oidcSignOut } from './oidcAuth';
import md5 from 'blueimp-md5';

const TOKEN_KEY = 'was_hono_token';

// ── IUser implementation ─────────────────────────────────────────────────────

export class HonoUser implements IUser {
  readonly uid: string;
  readonly email: string | null;
  readonly displayName: string;
  readonly emailMd5: string | null;
  readonly emailVerified = true;
  readonly providerId: string;

  constructor(uid: string, email: string | null, name: string, providerId: string = 'password') {
    this.uid = uid;
    this.email = email;
    this.displayName = name;
    this.emailMd5 = email ? md5(email.trim().toLowerCase()) : null;
    this.providerId = providerId;
  }

  async changePassword(_oldPassword: string, _newPassword: string): Promise<void> {
    throw new Error('changePassword not implemented');
  }

  async sendEmailVerification(): Promise<void> {
    // No-op: handled by auth provider
  }

  async updateProfile(_p: { displayName?: string | null; photoURL?: string | null }): Promise<void> {
    // No-op: profile updates go through PATCH /api/auth/me
  }
}

// ── IAuth implementation ─────────────────────────────────────────────────────

type AuthListener = (user: IUser | null) => void;

export class HonoAuth implements IAuth {
  private readonly api: HonoApiClient;
  private readonly listeners = new Set<AuthListener>();
  private currentUser: IUser | null = null;
  private initialized = false;
  readonly oidcEnabled: boolean;

  constructor(api: HonoApiClient) {
    this.api = api;
    this.oidcEnabled = isOidcEnabled();
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

      // Use id_token (always a JWT) rather than access_token (may be opaque)
      const token = oidcUser.id_token ?? oidcUser.access_token;
      this.api.setToken(token);
      const me = await this.api.getMe();
      return new HonoUser(me.uid, me.email, me.name, 'oidc');
    } catch {
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
      return new HonoUser(me.uid, me.email, me.name, 'password');
    } catch {
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
      const user = new HonoUser(me.uid, me.email, me.name, 'oidc');
      this.fireListeners(user);
    } catch (e) {
      this.api.setToken(null);
      throw e;
    }
  }

  async createUserWithEmailAndPassword(email: string, password: string, displayName: string): Promise<IUser | null> {
    const { token, uid } = await this.api.register(email, password, displayName);
    this.storeLocalToken(token);
    const user = new HonoUser(uid, email, displayName, 'password');
    this.fireListeners(user);
    return user;
  }

  async fetchSignInMethodsForEmail(_email: string): Promise<string[]> {
    return ['password'];
  }

  async sendPasswordResetEmail(_email: string): Promise<void> {
    // Not implemented — Zitadel handles password reset for OIDC users
  }

  async signInWithEmailAndPassword(email: string, password: string): Promise<IUser | null> {
    const { token } = await this.api.login(email, password);
    this.storeLocalToken(token);
    const me = await this.api.getMe();
    const user = new HonoUser(me.uid, me.email, me.name, 'password');
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

    if (this.initialized) {
      onNext(this.currentUser);
    } else {
      this.initialized = true;
      this.restoreSession()
        .then(user => this.fireListeners(user))
        .catch(e => {
          this.fireListeners(null);
          onError?.(e instanceof Error ? e : new Error(String(e)));
        });
    }

    return () => {
      this.listeners.delete(onNext);
    };
  }
}
