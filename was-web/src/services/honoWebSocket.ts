import { Change, UpdateScope, createChangesConverter } from '@wallandshadow/shared';

// Wire-compatible with was-web/server/src/ws/{handler,notify,subscriptions}.ts.
// Application-specific close code: token verification failed.
// Kept in sync with the server constant in ws/handler.ts.
const WS_CLOSE_AUTH_REJECTED = 4001;

export type { UpdateScope };

interface SnapshotFrame {
  type: 'snapshot';
  subId: number;
  scope: UpdateScope;
  key: string;
  data: unknown;
}
interface UpdateFrame {
  type: 'roomUpdate';
  scope: UpdateScope;
  key: string;
  data: unknown;
}
interface SubscribeErrorFrame {
  type: 'subscribeError';
  subId: number;
  scope: UpdateScope;
  message: string;
}
interface MapChangeAckFrame {
  type: 'mapChangeAck';
  ackId: number;
  id?: string;
  error?: string;
}

type ServerFrame = SnapshotFrame | UpdateFrame | SubscribeErrorFrame | MapChangeAckFrame;

export interface SubscriptionHandlers {
  onSnapshot: (data: unknown) => void;
  onUpdate: (data: unknown) => void;
  onError?: (error: Error) => void;
  onSubscribed?: () => void;  // called when a full-reload mapChanges snapshot arrives
}

interface OutgoingFrame {
  type: 'subscribe' | 'unsubscribe' | 'mapChange';
  [key: string]: unknown;
}

interface ActiveSubscription {
  scope: UpdateScope;
  id?: string;
  lastSeq?: string;  // last seq seen for mapChanges subscriptions; sent on reconnect
  handlers: SubscriptionHandlers;
}

/**
 * Single multiplexed WebSocket connection to /ws. Owns every live subscription
 * and every pending map-change ack for this tab's data service. Auto-reconnects
 * with exponential backoff; on reconnect it re-sends each active `subscribe`
 * so callers never see a blip beyond one extra snapshot.
 *
 * If the server closes the connection with code 4001 (auth failure), retrying
 * is stopped and `onAuthFailure` is called so the app can redirect to login.
 * On each reconnect the token is fetched fresh via `getToken()`, so a silently
 * renewed OIDC token is picked up automatically.
 */
export class HonoWebSocket {
  private ws: WebSocket | null = null;
  private closed = false;
  private reconnectDelay = 1000;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  private readonly baseHttpUrl: string;
  private readonly getToken: () => string | null;
  private readonly onAuthFailure: () => void;
  private readonly changesConverter = createChangesConverter();

  private nextSubId = 1;
  private readonly subs = new Map<number, ActiveSubscription>();

  private nextAckId = 1;
  private readonly pendingAcks = new Map<number, { resolve: (id: string) => void; reject: (e: Error) => void }>();

  // Frames queued while the socket is connecting / reconnecting. Bounded to
  // avoid runaway memory if the server stays down under heavy user activity.
  private readonly sendQueue: string[] = [];
  private static readonly SEND_QUEUE_LIMIT = 256;

  constructor(baseUrl: string, getToken: () => string | null, onAuthFailure: () => void) {
    // In dev, __HONO_WS_BASE__ is injected by Vite's `define` to point directly
    // at the Hono server (e.g. 'http://localhost:3000'), bypassing Vite's unreliable
    // WS proxy. In production it's '' (same origin).
    this.baseHttpUrl = __HONO_WS_BASE__ || baseUrl || window.location.origin;
    this.getToken = getToken;
    this.onAuthFailure = onAuthFailure;
    this.connect();
  }

  private buildUrl(token: string): string {
    const wsProtocol = this.baseHttpUrl.startsWith('https') ? 'wss' : 'ws';
    const host = this.baseHttpUrl.replace(/^https?:\/\//, '');
    return `${wsProtocol}://${host}/ws?token=${encodeURIComponent(token)}`;
  }

  // ── Public API ────────────────────────────────────────────────────────────

  subscribe(
    scope: UpdateScope,
    id: string | undefined,
    handlers: SubscriptionHandlers,
  ): { unsubscribe: () => void } {
    const subId = this.nextSubId++;
    this.subs.set(subId, { scope, id, lastSeq: undefined, handlers });
    this.sendFrame({ type: 'subscribe', subId, scope, id });

    return {
      unsubscribe: () => {
        if (!this.subs.has(subId)) return;
        this.subs.delete(subId);
        this.sendFrame({ type: 'unsubscribe', subId });
      },
    };
  }

  sendMapChange(adventureId: string, mapId: string, chs: Change[]): Promise<string> {
    const ackId = this.nextAckId++;
    return new Promise<string>((resolve, reject) => {
      this.pendingAcks.set(ackId, { resolve, reject });
      this.sendFrame({ type: 'mapChange', ackId, adventureId, mapId, chs });
    });
  }

  close(): void {
    this.closed = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    // Reject everything pending so callers stop waiting.
    for (const [, pending] of this.pendingAcks) {
      pending.reject(new Error('WebSocket closed'));
    }
    this.pendingAcks.clear();
    this.subs.clear();
    if (this.ws) {
      this.ws.onclose = null;
      this.ws.onerror = null;
      this.ws.onmessage = null;
      this.ws.onopen = null;
      this.ws.close();
      this.ws = null;
    }
  }

  // ── Connection lifecycle ─────────────────────────────────────────────────

  private connect(): void {
    if (this.closed) return;

    const token = this.getToken();
    if (!token) {
      this.onAuthFailure();
      return;
    }

    try {
      this.ws = new WebSocket(this.buildUrl(token));
    } catch (e) {
      console.error('WebSocket connect failed:', e);
      this.failPendingAcks(e);
      this.scheduleReconnect();
      return;
    }

    this.ws.onopen = () => {
      this.reconnectDelay = 1000;
      // Drop any stale subscribe frames for subs we're about to re-send; also
      // drop subscribe/unsubscribe for subs that no longer exist. mapChange
      // frames in the queue keep their order.
      this.pruneQueueForReconnect();
      for (const [subId, sub] of this.subs) {
        this.writeFrame({
          type: 'subscribe',
          subId,
          scope: sub.scope,
          id: sub.id,
          ...(sub.scope === 'mapChanges' && sub.lastSeq !== undefined ? { lastSeq: sub.lastSeq } : {}),
        });
      }
      while (this.sendQueue.length > 0) {
        this.rawSend(this.sendQueue.shift()!);
      }
    };

    this.ws.onmessage = (event) => this.onMessage(event.data as string);
    this.ws.onclose = (event: CloseEvent) => {
      this.failPendingAcks(new Error('WebSocket closed'));
      if (this.closed) return;
      if (event.code === WS_CLOSE_AUTH_REJECTED) {
        // Server explicitly rejected our token. Stop retrying — the app needs
        // to re-authenticate rather than loop forever with an expired token.
        this.onAuthFailure();
      } else {
        this.scheduleReconnect();
      }
    };
    this.ws.onerror = () => { /* surfaced via onclose */ };
  }

  private scheduleReconnect(): void {
    if (this.closed || this.reconnectTimer) return;
    // ±20% jitter to avoid thundering herd on server restart.
    const jitter = this.reconnectDelay * (0.8 + Math.random() * 0.4);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, jitter);
    // 1s → 2s → 4s → 8s → ... → 30s
    this.reconnectDelay = Math.min(this.reconnectDelay * 2, 30000);
  }

  private pruneQueueForReconnect(): void {
    // Subscribe frames are re-sent from this.subs below; any subscribe /
    // unsubscribe frames queued before reconnect are redundant or stale.
    // Relies on the leading `{"type":"..."` that JSON.stringify produces
    // first (key insertion order is preserved).
    for (let i = this.sendQueue.length - 1; i >= 0; i--) {
      const frame = this.sendQueue[i];
      if (frame.startsWith('{"type":"subscribe"') ||
          frame.startsWith('{"type":"unsubscribe"')) {
        this.sendQueue.splice(i, 1);
      }
    }
  }

  private failPendingAcks(e: unknown): void {
    const err = e instanceof Error ? e : new Error(String(e));
    for (const [, pending] of this.pendingAcks) pending.reject(err);
    this.pendingAcks.clear();
  }

  // ── Message handling ─────────────────────────────────────────────────────

  private onMessage(raw: string): void {
    let frame: ServerFrame;
    try {
      frame = JSON.parse(raw) as ServerFrame;
    } catch (e) {
      console.warn('Dropping malformed WS frame:', e);
      return;
    }

    switch (frame.type) {
      case 'snapshot': {
        const sub = this.subs.get(frame.subId);
        if (!sub) return;
        const decoded = this.decode(frame.scope, frame.data);
        if (frame.scope === 'mapChanges') {
          const snap = frame.data as { lastSeq?: string | null; full?: boolean };
          if (snap.full) {
            sub.lastSeq = snap.lastSeq ?? undefined;
            sub.handlers.onSubscribed?.();
          } else if (snap.lastSeq !== undefined && snap.lastSeq !== null) {
            sub.lastSeq = snap.lastSeq;
          }
        }
        sub.handlers.onSnapshot(decoded);
        return;
      }
      case 'roomUpdate': {
        // Routed by scope (+ id for non-user scopes) to every matching
        // subscription. User-scoped updates (`adventures`, `profile`) only
        // reach the user's own room, so no id match is needed.
        const isUserScoped = frame.scope === 'adventures' || frame.scope === 'profile';
        for (const [, sub] of this.subs) {
          if (sub.scope !== frame.scope) continue;
          if (!isUserScoped && sub.id !== frame.key) continue;
          if (frame.scope === 'mapChanges') {
            const raw = frame.data as { seq?: string };
            if (raw.seq) sub.lastSeq = raw.seq;
          }
          sub.handlers.onUpdate(this.decode(frame.scope, frame.data));
        }
        return;
      }
      case 'subscribeError': {
        const sub = this.subs.get(frame.subId);
        if (sub) sub.handlers.onError?.(new Error(frame.message));
        return;
      }
      case 'mapChangeAck': {
        const pending = this.pendingAcks.get(frame.ackId);
        if (!pending) return;
        this.pendingAcks.delete(frame.ackId);
        if (frame.error) pending.reject(new Error(frame.error));
        else pending.resolve(frame.id ?? '');
        return;
      }
    }
  }

  // For mapChanges, run payloads through the shared Changes converter.
  // Snapshot frames carry { changes: Changes[], lastSeq: string|null, full: boolean }.
  // Update frames carry { seq: string, changes: Changes }.
  private decode(scope: UpdateScope, data: unknown): unknown {
    if (scope !== 'mapChanges') return data;
    const d = data as Record<string, unknown>;
    if (Array.isArray(d.changes)) {
      // Snapshot: decode each Changes in the array
      const arr = d.changes as Record<string, unknown>[];
      return { ...d, changes: arr.map(c => this.changesConverter.convert(c)) };
    }
    // Update: decode the single Changes object
    return { seq: d.seq, changes: this.changesConverter.convert(d.changes as Record<string, unknown>) };
  }

  // ── Frame send plumbing ──────────────────────────────────────────────────

  private sendFrame(frame: OutgoingFrame): void {
    const encoded = JSON.stringify(frame);
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.rawSend(encoded);
    } else {
      if (this.sendQueue.length >= HonoWebSocket.SEND_QUEUE_LIMIT) {
        this.sendQueue.shift();
      }
      this.sendQueue.push(encoded);
    }
  }

  private writeFrame(frame: OutgoingFrame): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.rawSend(JSON.stringify(frame));
    }
  }

  private rawSend(encoded: string): void {
    try {
      this.ws?.send(encoded);
    } catch (e) {
      console.error('WebSocket send failed:', e);
    }
  }
}

