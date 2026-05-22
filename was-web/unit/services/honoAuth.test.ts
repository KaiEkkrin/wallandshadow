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
