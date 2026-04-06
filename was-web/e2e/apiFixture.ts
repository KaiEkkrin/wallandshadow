import { v7 as uuidv7 } from 'uuid';

/**
 * Lightweight API client for e2e test setup.
 * Calls the Hono server through the Vite proxy at http://localhost:5000.
 * Self-contained — does not import from src/ to avoid shared package resolution issues.
 */

const BASE_URL = 'http://localhost:5000';

interface AuthResponse {
  token: string;
  uid: string;
}

export class TestApiClient {
  private token: string | null = null;

  setToken(token: string): void {
    this.token = token;
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const headers: Record<string, string> = {};
    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`;
    }
    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
    }

    const res = await fetch(`${BASE_URL}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`API ${method} ${path} failed (${res.status}): ${text}`);
    }

    if (res.status === 204) return undefined as T;
    return res.json() as Promise<T>;
  }

  register(email: string, password: string, name: string): Promise<AuthResponse> {
    return this.request('POST', '/api/auth/register', { email, password, name });
  }

  login(email: string, password: string): Promise<AuthResponse> {
    return this.request('POST', '/api/auth/login', { email, password });
  }

  createAdventure(name: string, description: string): Promise<{ id: string }> {
    return this.request('POST', '/api/adventures', { name, description });
  }

  createMap(adventureId: string, name: string, description: string, ty: string, ffa = false): Promise<{ id: string }> {
    return this.request('POST', `/api/adventures/${adventureId}/maps`, { name, description, ty, ffa });
  }

  createInvite(adventureId: string): Promise<{ inviteId: string }> {
    return this.request('POST', `/api/adventures/${adventureId}/invites`, {});
  }

  joinInvite(inviteId: string): Promise<{ adventureId: string }> {
    return this.request('POST', `/api/invites/${inviteId}/join`, {});
  }

  async uploadImage(pngBuffer: Buffer, name: string): Promise<{ id: string; path: string }> {
    const headers: Record<string, string> = {};
    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`;
    }
    const formData = new FormData();
    formData.append('file', new Blob([pngBuffer], { type: 'image/png' }), 'test.png');
    formData.append('name', name);
    const res = await fetch(`${BASE_URL}/api/images`, {
      method: 'POST',
      headers,
      body: formData,
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Image upload failed (${res.status}): ${text}`);
    }
    return res.json() as Promise<{ id: string; path: string }>;
  }
}

// ── User info returned by createApiUser ─────────────────────────────────────

export interface ApiUser {
  api: TestApiClient;
  uid: string;
  email: string;
  password: string;
  displayName: string;
}

// Counter shared with util.ts signUp (they use the same auth backend,
// so email uniqueness is all that matters — UUID handles that)
let apiUserCounter = 100;

/**
 * Register a new user via the API and return an authenticated client.
 */
export async function createApiUser(prefix = 'ApiUser'): Promise<ApiUser> {
  const n = ++apiUserCounter;
  const displayName = `${prefix} ${n}`;
  const email = `${prefix}${n}-${uuidv7()}@example.com`.toLowerCase();
  const password = `${prefix}_password${n}`;

  const api = new TestApiClient();
  const { token, uid } = await api.register(email, password, displayName);
  api.setToken(token);
  return { api, uid, email, password, displayName };
}

/**
 * Login as an existing user (e.g. one created via browser signUp) and return an API client.
 */
export async function loginApiUser(email: string, password: string): Promise<TestApiClient> {
  const api = new TestApiClient();
  const { token } = await api.login(email, password);
  api.setToken(token);
  return api;
}

/**
 * Create an adventure via API, returns the adventure ID.
 */
export async function setupAdventure(api: TestApiClient, name: string, description: string): Promise<string> {
  const { id } = await api.createAdventure(name, description);
  return id;
}

/**
 * Create a map via API, returns the map ID.
 */
export async function setupMap(
  api: TestApiClient, adventureId: string,
  name: string, description: string, ty = 'hex',
): Promise<string> {
  const { id } = await api.createMap(adventureId, name, description, ty);
  return id;
}

/**
 * Invite a second user to an adventure via API.
 * Both users must be authenticated (setToken called).
 */
export async function inviteAndJoin(
  ownerApi: TestApiClient, joinerApi: TestApiClient, adventureId: string,
): Promise<void> {
  const { inviteId } = await ownerApi.createInvite(adventureId);
  await joinerApi.joinInvite(inviteId);
}
