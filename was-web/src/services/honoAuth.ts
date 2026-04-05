import { IAuth, IAuthProvider, IUser } from '@wallandshadow/shared';
import { HonoApiClient } from './honoApi';
import md5 from 'blueimp-md5';

const TOKEN_KEY = 'was_hono_token';

// ── IUser implementation ─────────────────────────────────────────────────────

// TODO Phase 2: replace with OIDC-aware user
export class HonoUser implements IUser {
  readonly uid: string;
  readonly email: string;
  readonly displayName: string;
  readonly emailMd5: string;
  readonly emailVerified = true;
  readonly providerId = 'password';

  constructor(uid: string, email: string, name: string) {
    this.uid = uid;
    this.email = email;
    this.displayName = name;
    this.emailMd5 = md5(email.trim().toLowerCase());
  }

  async changePassword(_oldPassword: string, _newPassword: string): Promise<void> {
    throw new Error('changePassword not implemented in Phase 1');
  }

  async sendEmailVerification(): Promise<void> {
    // No-op: server handles verification
  }

  async updateProfile(_p: { displayName?: string | null; photoURL?: string | null }): Promise<void> {
    // No-op for Phase 1
  }
}

// ── IAuth implementation ─────────────────────────────────────────────────────

type AuthListener = (user: IUser | null) => void;

// TODO Phase 2: replace local JWT auth with OIDC
export class HonoAuth implements IAuth {
  private readonly api: HonoApiClient;
  private readonly listeners = new Set<AuthListener>();
  private currentUser: IUser | null = null;
  private initialized = false;

  constructor(api: HonoApiClient) {
    this.api = api;
  }

  private fireListeners(user: IUser | null): void {
    this.currentUser = user;
    for (const listener of this.listeners) {
      listener(user);
    }
  }

  private storeToken(token: string): void {
    localStorage.setItem(TOKEN_KEY, token);
    this.api.setToken(token);
  }

  private clearSession(): void {
    localStorage.removeItem(TOKEN_KEY);
    this.api.setToken(null);
  }

  private async restoreSession(): Promise<IUser | null> {
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
      return new HonoUser(me.uid, me.email, me.name);
    } catch {
      this.clearSession();
      return null;
    }
  }

  async createUserWithEmailAndPassword(email: string, password: string, displayName: string): Promise<IUser | null> {
    const { token, uid } = await this.api.register(email, password, displayName);
    this.storeToken(token);
    const user = new HonoUser(uid, email, displayName);
    this.fireListeners(user);
    return user;
  }

  async fetchSignInMethodsForEmail(_email: string): Promise<string[]> {
    return ['password'];
  }

  async sendPasswordResetEmail(_email: string): Promise<void> {
    // Not implemented in Phase 1
  }

  async signInWithEmailAndPassword(email: string, password: string): Promise<IUser | null> {
    const { token } = await this.api.login(email, password);
    // Token must be set before getMe() can authenticate
    this.storeToken(token);
    const me = await this.api.getMe();
    const user = new HonoUser(me.uid, me.email, me.name);
    this.fireListeners(user);
    return user;
  }

  async signInWithPopup(_provider: IAuthProvider | undefined): Promise<IUser | null> {
    throw new Error('Google sign-in not available in Phase 1');
  }

  async signOut(): Promise<void> {
    this.clearSession();
    this.fireListeners(null);
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
