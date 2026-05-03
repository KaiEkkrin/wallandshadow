// Shared WebSocket test scaffolding. Imported by ws.test.ts and ws-presence.test.ts.
import type { Hono } from 'hono';
import { WebSocket } from 'ws';
import { MapType } from '@wallandshadow/shared';
import { apiPost } from './helpers.js';

export interface ServerFrame {
  type: string;
  subId?: number;
  scope?: string;
  key?: string;
  data?: unknown;
  message?: string;
  ackId?: number;
  id?: string | number;
  seq?: string;
  error?: string;
}

export function connectWs(port: number, token: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://localhost:${port}/ws?token=${token}`);
    ws.on('open', () => resolve(ws));
    ws.on('error', reject);
    setTimeout(() => reject(new Error('WebSocket connect timeout')), 5000);
  });
}

export function send(ws: WebSocket, frame: Record<string, unknown>): void {
  ws.send(JSON.stringify(frame));
}

export function nextFrame(ws: WebSocket, timeoutMs = 5000): Promise<ServerFrame> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('WS message timeout')), timeoutMs);
    ws.once('message', (data) => {
      clearTimeout(timer);
      resolve(JSON.parse(data.toString()));
    });
  });
}

/** Wait for a frame matching `predicate` (or timeout). */
export function waitForFrame(
  ws: WebSocket,
  predicate: (f: ServerFrame) => boolean,
  timeoutMs = 5000,
): Promise<ServerFrame> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      ws.off('message', handler);
      reject(new Error('WS frame predicate timeout'));
    }, timeoutMs);
    const handler = (data: WebSocket.Data) => {
      try {
        const f = JSON.parse(data.toString()) as ServerFrame;
        if (predicate(f)) {
          clearTimeout(timer);
          ws.off('message', handler);
          resolve(f);
        }
      } catch { /* ignore non-JSON */ }
    };
    ws.on('message', handler);
  });
}

/** Resolves true iff no frame matching `predicate` arrives within `ms`. */
export function noFrameWithin(
  ws: WebSocket,
  predicate: (f: ServerFrame) => boolean,
  ms: number,
): Promise<boolean> {
  return new Promise(resolve => {
    let matched = false;
    const handler = (data: WebSocket.Data) => {
      try {
        const f = JSON.parse(data.toString()) as ServerFrame;
        if (predicate(f)) matched = true;
      } catch { /* ignore */ }
    };
    ws.on('message', handler);
    setTimeout(() => {
      ws.off('message', handler);
      resolve(!matched);
    }, ms);
  });
}

/** Buffer every frame that arrives within `ms`. */
export function collectFrames(ws: WebSocket, ms: number): Promise<ServerFrame[]> {
  return new Promise(resolve => {
    const frames: ServerFrame[] = [];
    const handler = (data: WebSocket.Data) => {
      try { frames.push(JSON.parse(data.toString()) as ServerFrame); } catch { /* ignore */ }
    };
    ws.on('message', handler);
    setTimeout(() => {
      ws.off('message', handler);
      resolve(frames);
    }, ms);
  });
}

export function waitForClose(ws: WebSocket, timeoutMs = 5000): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('WS close timeout')), timeoutMs);
    ws.on('close', () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

// ── Adventure / map / invite helpers (assert success) ────────────────────────

export async function createAdventure(
  app: Hono,
  token: string,
  name = 'Test Adventure',
): Promise<string> {
  const res = await apiPost(app, '/api/adventures', { name, description: '' }, token);
  if (res.status !== 201) throw new Error(`createAdventure failed: ${res.status} ${await res.text()}`);
  return ((await res.json()) as { id: string }).id;
}

export async function createMap(
  app: Hono,
  token: string,
  adventureId: string,
  name = 'Test Map',
): Promise<string> {
  const res = await apiPost(app, `/api/adventures/${adventureId}/maps`, {
    name, description: '', ty: MapType.Square, ffa: false,
  }, token);
  if (res.status !== 201) throw new Error(`createMap failed: ${res.status} ${await res.text()}`);
  return ((await res.json()) as { id: string }).id;
}

export async function joinAdventure(
  app: Hono,
  ownerToken: string,
  joinerToken: string,
  adventureId: string,
): Promise<void> {
  const inviteRes = await apiPost(app, `/api/adventures/${adventureId}/invites`, {}, ownerToken);
  const { inviteId } = (await inviteRes.json()) as { inviteId: string };
  const joinRes = await apiPost(app, `/api/invites/${inviteId}/join`, {}, joinerToken);
  if (joinRes.status !== 200) throw new Error(`joinAdventure failed: ${joinRes.status} ${await joinRes.text()}`);
}
