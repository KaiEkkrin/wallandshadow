import type { Change, ICharacter, IInviteExpiryPolicy, MapType, UserLevel } from '@wallandshadow/shared';

// ── Response types ───────────────────────────────────────────────────────────

export interface AuthResponse {
  token: string;
  uid: string;
}

export interface MeResponse {
  uid: string;
  email: string;
  name: string;
  level: UserLevel;
}

export interface AdventureRow {
  id: string;
  name: string;
  description: string;
  owner: string;
  ownerName: string;
  imagePath: string;
}

export interface AdventureDetailRow extends AdventureRow {
  maps: MapSummaryRow[];
}

export interface MapSummaryRow {
  adventureId: string;
  id: string;
  name: string;
  description: string;
  ty: MapType;
  imagePath: string;
}

export interface MapRow extends MapSummaryRow {
  ffa: boolean;
}

export interface PlayerRow {
  playerId: string;
  playerName: string;
  allowed: boolean;
  characters: ICharacter[];
}

export interface InviteDetailRow {
  id: string;
  adventureId: string;
  adventureName: string;
  ownerName: string;
  expiresAt: string;
}

export interface ImageRow {
  id: string;
  name: string;
  path: string;
}

export interface MapChangesResponse {
  base: Record<string, unknown> | null;
  incremental: { id: string; changes: Record<string, unknown> }[];
}

export interface SpritesheetRow {
  id: string;
  sprites: string[];
  geometry: string;
  freeSpaces: number;
  supersededBy: string;
  refs: number;
}

// ── API Error ────────────────────────────────────────────────────────────────

export class ApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

// ── API Client ───────────────────────────────────────────────────────────────

export class HonoApiClient {
  readonly baseUrl: string;
  private token: string | null = null;

  constructor(baseUrl = '') {
    this.baseUrl = baseUrl;
  }

  setToken(token: string | null): void {
    this.token = token;
  }

  getToken(): string | null {
    return this.token;
  }

  private async throwIfNotOk(res: Response): Promise<void> {
    if (res.ok) return;
    const text = await res.text();
    let message: string;
    try { message = JSON.parse(text).error ?? text; } catch { message = text; }
    throw new ApiError(message, res.status);
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const headers: Record<string, string> = {};
    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`;
    }
    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
    }

    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });

    await this.throwIfNotOk(res);

    if (res.status === 204) {
      return undefined as T;
    }

    return res.json() as Promise<T>;
  }

  // ── Auth ──────────────────────────────────────────────────────────────────

  register(email: string, password: string, name: string): Promise<AuthResponse> {
    return this.request('POST', '/api/auth/register', { email, password, name });
  }

  login(email: string, password: string): Promise<AuthResponse> {
    return this.request('POST', '/api/auth/login', { email, password });
  }

  getMe(): Promise<MeResponse> {
    return this.request('GET', '/api/auth/me');
  }

  updateMe(name: string): Promise<{ uid: string; name: string }> {
    return this.request('PATCH', '/api/auth/me', { name });
  }

  // ── Adventures ────────────────────────────────────────────────────────────

  getAdventures(): Promise<AdventureRow[]> {
    return this.request('GET', '/api/adventures');
  }

  getAdventure(id: string): Promise<AdventureDetailRow> {
    return this.request('GET', `/api/adventures/${id}`);
  }

  createAdventure(name: string, description: string): Promise<{ id: string }> {
    return this.request('POST', '/api/adventures', { name, description });
  }

  updateAdventure(id: string, fields: { name?: string; description?: string; imagePath?: string }): Promise<void> {
    return this.request('PATCH', `/api/adventures/${id}`, fields);
  }

  deleteAdventure(id: string): Promise<void> {
    return this.request('DELETE', `/api/adventures/${id}`);
  }

  leaveAdventure(id: string): Promise<void> {
    return this.request('DELETE', `/api/adventures/${id}/players/me`);
  }

  // ─��� Players ───────────────────────────────────────────────────────────────

  getPlayers(adventureId: string): Promise<PlayerRow[]> {
    return this.request('GET', `/api/adventures/${adventureId}/players`);
  }

  updatePlayer(adventureId: string, userId: string, fields: { allowed?: boolean; characters?: ICharacter[] }): Promise<void> {
    return this.request('PATCH', `/api/adventures/${adventureId}/players/${userId}`, fields);
  }

  // ── Maps ──────────────────────────────────────────────────────────────────

  getMaps(adventureId: string): Promise<MapRow[]> {
    return this.request('GET', `/api/adventures/${adventureId}/maps`);
  }

  getMap(adventureId: string, mapId: string): Promise<MapRow> {
    return this.request('GET', `/api/adventures/${adventureId}/maps/${mapId}`);
  }

  createMap(adventureId: string, name: string, description: string, ty: MapType, ffa: boolean): Promise<{ id: string }> {
    return this.request('POST', `/api/adventures/${adventureId}/maps`, { name, description, ty, ffa });
  }

  updateMap(adventureId: string, mapId: string, fields: { name?: string; description?: string; imagePath?: string; ffa?: boolean }): Promise<void> {
    return this.request('PATCH', `/api/adventures/${adventureId}/maps/${mapId}`, fields);
  }

  cloneMap(adventureId: string, mapId: string, name: string, description: string): Promise<{ id: string }> {
    return this.request('POST', `/api/adventures/${adventureId}/maps/${mapId}/clone`, { name, description });
  }

  consolidateMapChanges(adventureId: string, mapId: string, resync: boolean): Promise<void> {
    return this.request('POST', `/api/adventures/${adventureId}/maps/${mapId}/consolidate`, { resync });
  }

  deleteMap(adventureId: string, mapId: string): Promise<void> {
    return this.request('DELETE', `/api/adventures/${adventureId}/maps/${mapId}`);
  }

  addMapChanges(adventureId: string, mapId: string, chs: Change[]): Promise<{ id: string }> {
    return this.request('POST', `/api/adventures/${adventureId}/maps/${mapId}/changes`, { chs });
  }

  // ── Invites ────────────────────────────────────────────────────────���──────

  getInvite(inviteId: string): Promise<InviteDetailRow> {
    return this.request('GET', `/api/invites/${inviteId}`);
  }

  createInvite(adventureId: string, policy?: IInviteExpiryPolicy): Promise<{ inviteId: string }> {
    return this.request('POST', `/api/adventures/${adventureId}/invites`, policy ? { policy } : {});
  }

  joinInvite(inviteId: string, policy?: IInviteExpiryPolicy): Promise<{ adventureId: string }> {
    return this.request('POST', `/api/invites/${inviteId}/join`, policy ? { policy } : {});
  }

  // ── Map changes ───────────────────────────────────────────────────────────

  getMapChanges(adventureId: string, mapId: string): Promise<MapChangesResponse> {
    return this.request('GET', `/api/adventures/${adventureId}/maps/${mapId}/changes`);
  }

  // ── Images ────────────────────────────────────────────────────────────────

  getImages(): Promise<{ images: ImageRow[] }> {
    return this.request('GET', '/api/images');
  }

  getImageDownloadUrl(path: string): Promise<{ url: string }> {
    return this.request('GET', `/api/images/download?path=${encodeURIComponent(path)}`);
  }

  async uploadImage(file: Blob, name?: string): Promise<ImageRow> {
    const headers: Record<string, string> = {};
    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`;
    }
    const formData = new FormData();
    formData.append('file', file);
    if (name) {
      formData.append('name', name);
    }
    const res = await fetch(`${this.baseUrl}/api/images`, {
      method: 'POST',
      headers,
      body: formData,
    });
    await this.throwIfNotOk(res);
    return res.json() as Promise<ImageRow>;
  }

  deleteImage(path: string): Promise<void> {
    // Storage paths are "images/{uid}/{id}" but the route is /api/images/*
    // so strip the leading "images/" to avoid doubling it
    const relativePath = path.replace(/^images\//, '');
    return this.request('DELETE', `/api/images/${relativePath}`);
  }

  // ── Spritesheets ──────────────────────────────────────────────────────────

  getSpritesheets(adventureId: string): Promise<SpritesheetRow[]> {
    return this.request('GET', `/api/adventures/${adventureId}/spritesheets`);
  }

  addSprites(adventureId: string, geometry: string, sources: string[]): Promise<{ sprites: unknown[] }> {
    return this.request('POST', `/api/adventures/${adventureId}/spritesheets`, { geometry, sources });
  }
}
