import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { IUser } from '@wallandshadow/shared';

import { ApiError, HonoApiClient, isAccountSuspendedError } from '../../src/services/honoApiClient';
import { HonoAuth } from '../../src/services/honoAuth';

// honoAuth.ts uses localStorage, which does not exist in the Vitest `node`
// environment — provide a minimal in-memory stub (as recentMaps.test.ts does).
function makeLocalStorageStub(): Storage {
  const store = new Map<string, string>();
  return {
    get length() { return store.size; },
    clear: () => store.clear(),
    getItem: (k: string) => store.get(k) ?? null,
    key: (i: number) => [...store.keys()][i] ?? null,
    removeItem: (k: string) => { store.delete(k); },
    setItem: (k: string, v: string) => { store.set(k, String(v)); },
  };
}

// A local JWT with a far-future exp claim, so tryRestoreLocalSession proceeds
// to the getMe() call rather than discarding the token as expired.
function makeUnexpiredToken(): string {
  const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = btoa(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 }));
  return `${header}.${payload}.signature`;
}

function stubClient(getMe: () => Promise<never>): HonoApiClient {
  return {
    setToken() {},
    getToken: () => null,
    getMe,
  } as unknown as HonoApiClient;
}

// A richer stub that records every setToken call and lets each test supply its
// own getMe / login behaviour — used by the completion/login tests below.
interface RecordingClient {
  client: HonoApiClient;
  setTokenCalls: (string | null)[];
}

function recordingClient(opts: {
  getMe: () => Promise<{ uid: string; email: string | null; name: string; emailVerified: boolean }>;
  login?: () => Promise<{ token: string }>;
}): RecordingClient {
  const setTokenCalls: (string | null)[] = [];
  const client = {
    setToken(token: string | null) { setTokenCalls.push(token); },
    getToken: () => null,
    getMe: opts.getMe,
    login: opts.login ?? (async () => ({ token: 'unused' })),
  } as unknown as HonoApiClient;
  return { client, setTokenCalls };
}

// Resolves with the value the auth listener is notified with once the initial
// session restore settles.
function firstAuthState(auth: HonoAuth): Promise<IUser | null> {
  return new Promise((resolve) => {
    auth.onAuthStateChanged((u) => resolve(u));
  });
}

describe('isAccountSuspendedError', () => {
  test('true for a 403 with the account-suspended message', () => {
    expect(isAccountSuspendedError(new ApiError('account-suspended', 403))).toBe(true);
  });

  test('false for other 403s and other statuses', () => {
    expect(isAccountSuspendedError(new ApiError('Forbidden', 403))).toBe(false);
    expect(isAccountSuspendedError(new ApiError('account-suspended', 401))).toBe(false);
    expect(isAccountSuspendedError(new Error('account-suspended'))).toBe(false);
  });
});

describe('HonoAuth: suspended account on session restore', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', makeLocalStorageStub());
    // Disable OIDC so HonoAuth stays on the local-session restore path — the
    // OIDC path needs browser globals absent from the Vitest `node` env.
    vi.stubEnv('VITE_OIDC_ISSUER', '');
    vi.stubEnv('VITE_OIDC_CLIENT_ID', '');
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  test('a 403 account-suspended from /auth/me leaves the user signed out but flagged suspended', async () => {
    localStorage.setItem('was_hono_token', makeUnexpiredToken());
    const auth = new HonoAuth(stubClient(
      async () => { throw new ApiError('account-suspended', 403); },
    ));

    const user = await firstAuthState(auth);

    // Not signed in — but distinguishable from a plain logout, so the app
    // routes to the Suspended page instead of back through login.
    expect(user).toBeNull();
    expect(auth.suspended).toBe(true);
  });

  test('an ordinary 401 from /auth/me is a plain logout, not a suspension', async () => {
    localStorage.setItem('was_hono_token', makeUnexpiredToken());
    const auth = new HonoAuth(stubClient(
      async () => { throw new ApiError('Unauthorized', 401); },
    ));

    const user = await firstAuthState(auth);

    expect(user).toBeNull();
    expect(auth.suspended).toBe(false);
  });
});

describe('HonoAuth: completeOidcLogin', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', makeLocalStorageStub());
    vi.stubEnv('VITE_OIDC_ISSUER', '');
    vi.stubEnv('VITE_OIDC_CLIENT_ID', '');
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  test('a successful login clears a stale `suspended` flag from a prior failed restore', async () => {
    const { client } = recordingClient({
      getMe: async () => ({ uid: 'u1', email: 'a@b', name: 'A', emailVerified: true }),
    });
    const auth = new HonoAuth(client);
    // Simulate the prior tryRestoreOidcSession rejection that left suspended=true.
    auth.suspended = true;

    await auth.completeOidcLogin('token');

    expect(auth.suspended).toBe(false);
  });

  test('the suspended branch clears the in-memory api token', async () => {
    const { client, setTokenCalls } = recordingClient({
      getMe: async () => { throw new ApiError('account-suspended', 403); },
    });
    const auth = new HonoAuth(client);

    await auth.completeOidcLogin('token');

    expect(auth.suspended).toBe(true);
    // setToken should have been called twice: first to set the bearer for
    // getMe(), then to clear it after the suspension is detected. The final
    // call wins — the API client must not carry a banned-user token.
    expect(setTokenCalls.at(-1)).toBeNull();
  });
});

describe('HonoAuth: signInWithEmailAndPassword', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', makeLocalStorageStub());
    vi.stubEnv('VITE_OIDC_ISSUER', '');
    vi.stubEnv('VITE_OIDC_CLIENT_ID', '');
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  test('a successful login clears a stale `suspended` flag from a prior failed restore', async () => {
    const { client } = recordingClient({
      getMe: async () => ({ uid: 'u1', email: 'a@b', name: 'A', emailVerified: true }),
      login: async () => ({ token: makeUnexpiredToken() }),
    });
    const auth = new HonoAuth(client);
    auth.suspended = true;

    await auth.signInWithEmailAndPassword('a@b', 'pw');

    expect(auth.suspended).toBe(false);
  });

  test('the suspended branch clears the in-memory api token', async () => {
    const { client, setTokenCalls } = recordingClient({
      getMe: async () => { throw new ApiError('account-suspended', 403); },
      login: async () => ({ token: makeUnexpiredToken() }),
    });
    const auth = new HonoAuth(client);

    await auth.signInWithEmailAndPassword('a@b', 'pw');

    expect(auth.suspended).toBe(true);
    expect(setTokenCalls.at(-1)).toBeNull();
  });
});

describe('HonoAuth: session-restore suspended branches clear api token', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', makeLocalStorageStub());
    vi.stubEnv('VITE_OIDC_ISSUER', '');
    vi.stubEnv('VITE_OIDC_CLIENT_ID', '');
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  test('tryRestoreLocalSession suspended branch clears the api token but keeps the localStorage JWT', async () => {
    localStorage.setItem('was_hono_token', makeUnexpiredToken());
    const { client, setTokenCalls } = recordingClient({
      getMe: async () => { throw new ApiError('account-suspended', 403); },
    });
    const auth = new HonoAuth(client);

    await firstAuthState(auth);

    expect(auth.suspended).toBe(true);
    expect(localStorage.getItem('was_hono_token')).not.toBeNull();
    // The in-memory client must not retain the bearer post-suspension.
    expect(setTokenCalls.at(-1)).toBeNull();
  });
});
