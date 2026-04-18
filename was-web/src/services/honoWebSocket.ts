import { Change, Changes, UpdateScope, createChangesConverter } from '@wallandshadow/shared';

// Wire-compatible with was-web/server/src/ws/{handler,notify,subscriptions}.ts.

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
}

interface OutgoingFrame {
  type: 'subscribe' | 'unsubscribe' | 'mapChange';
  [key: string]: unknown;
}

interface ActiveSubscription {
  scope: UpdateScope;
  id?: string;
  handlers: SubscriptionHandlers;
}

/**
 * Single multiplexed WebSocket connection to /ws. Owns every live subscription
 * and every pending map-change ack for this tab's data service. Auto-reconnects
 * with exponential backoff; on reconnect it re-sends each active `subscribe`
 * so callers never see a blip beyond one extra snapshot.
 */
export class HonoWebSocket {
  private ws: WebSocket | null = null;
  private closed = false;
  private reconnectDelay = 1000;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  private readonly url: string;
  private readonly changesConverter = createChangesConverter();

  private nextSubId = 1;
  private readonly subs = new Map<number, ActiveSubscription>();

  private nextAckId = 1;
  private readonly pendingAcks = new Map<number, { resolve: (id: string) => void; reject: (e: Error) => void }>();

  // Frames queued while the socket is connecting / reconnecting. Bounded to
  // avoid runaway memory if the server stays down under heavy user activity.
  private readonly sendQueue: string[] = [];
  private static readonly SEND_QUEUE_LIMIT = 256;

  constructor(baseUrl: string, token: string) {
    // In dev, __HONO_WS_BASE__ is injected by Vite's `define` to point directly
    // at the Hono server (e.g. 'http://localhost:3000'), bypassing Vite's unreliable
    // WS proxy. In production it's '' (same origin).
    const httpUrl = __HONO_WS_BASE__ || baseUrl || window.location.origin;
    const wsProtocol = httpUrl.startsWith('https') ? 'wss' : 'ws';
    const host = httpUrl.replace(/^https?:\/\//, '');
    this.url = `${wsProtocol}://${host}/ws?token=${encodeURIComponent(token)}`;

    this.connect();
  }

  // ── Public API ────────────────────────────────────────────────────────────

  subscribe(
    scope: UpdateScope,
    id: string | undefined,
    handlers: SubscriptionHandlers,
  ): { unsubscribe: () => void } {
    const subId = this.nextSubId++;
    this.subs.set(subId, { scope, id, handlers });
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

    try {
      this.ws = new WebSocket(this.url);
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
        this.writeFrame({ type: 'subscribe', subId, scope: sub.scope, id: sub.id });
      }
      while (this.sendQueue.length > 0) {
        this.rawSend(this.sendQueue.shift()!);
      }
    };

    this.ws.onmessage = (event) => this.onMessage(event.data as string);
    this.ws.onclose = () => {
      this.failPendingAcks(new Error('WebSocket closed'));
      if (!this.closed) this.scheduleReconnect();
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
        sub.handlers.onSnapshot(this.decode(frame.scope, frame.data));
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

  // For mapChanges we run the payload through the shared Changes converter so
  // downstream code receives the same Changes object shape it always has.
  private decode(scope: UpdateScope, data: unknown): unknown {
    if (scope !== 'mapChanges') return data;
    if (Array.isArray((data as { changes?: unknown[] })?.changes)) {
      const arr = (data as { changes: Record<string, unknown>[] }).changes;
      return { changes: arr.map(c => this.changesConverter.convert(c)) as Changes[] };
    }
    // Update frames carry a single Changes object.
    return this.changesConverter.convert(data as Record<string, unknown>);
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

