import { Changes, createChangesConverter } from '@wallandshadow/shared';

/**
 * WebSocket client for receiving real-time map changes.
 * Connects to /ws/maps/:mapId, receives Changes objects,
 * and calls the provided callback for each message.
 * Reconnects with exponential backoff on unexpected disconnection.
 */
export class MapWebSocket {
  private ws: WebSocket | null = null;
  private closed = false;
  private reconnectDelay = 1000;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly converter = createChangesConverter();
  private readonly url: string;
  private readonly onMessage: (changes: Changes) => void;
  private readonly onError?: (error: Error) => void;

  constructor(
    baseUrl: string,
    mapId: string,
    token: string,
    onMessage: (changes: Changes) => void,
    onError?: (error: Error) => void,
  ) {
    this.onMessage = onMessage;
    this.onError = onError;

    // In dev, __HONO_WS_BASE__ is injected by Vite's `define` to point directly
    // at the Hono server (e.g. 'http://localhost:3000'), bypassing Vite's unreliable
    // WS proxy. In production it's '' (same origin).
    const httpUrl = __HONO_WS_BASE__ || baseUrl || window.location.origin;
    const wsProtocol = httpUrl.startsWith('https') ? 'wss' : 'ws';
    const host = httpUrl.replace(/^https?:\/\//, '');
    this.url = `${wsProtocol}://${host}/ws/maps/${mapId}?token=${encodeURIComponent(token)}`;

    console.log('[MapWebSocket] connecting to', this.url);
    this.connect();
  }

  private connect(): void {
    if (this.closed) return;

    try {
      this.ws = new WebSocket(this.url);
    } catch (e) {
      this.onError?.(e instanceof Error ? e : new Error(String(e)));
      this.scheduleReconnect();
      return;
    }

    this.ws.onmessage = (event) => {
      try {
        const raw = JSON.parse(event.data as string) as Record<string, unknown>;
        const changes = this.converter.convert(raw);
        this.onMessage(changes);
      } catch (e) {
        console.error('Failed to parse WebSocket message:', e);
      }
    };

    this.ws.onopen = () => {
      console.log('[MapWebSocket] connected successfully');
      this.reconnectDelay = 1000;
    };

    this.ws.onclose = (event) => {
      console.log(`[MapWebSocket] closed (code=${event.code}, reason=${event.reason})`);
      if (!this.closed) {
        console.log(`[MapWebSocket] reconnecting in ${this.reconnectDelay}ms...`);
        this.scheduleReconnect();
      }
    };

    this.ws.onerror = (_event) => {
      console.log('[MapWebSocket] error event fired');
    };
  }

  private scheduleReconnect(): void {
    if (this.closed) return;
    if (this.reconnectTimer) return; // already scheduled

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, this.reconnectDelay);

    // Exponential backoff: 1s → 2s → 4s → 8s → ... → 30s max
    this.reconnectDelay = Math.min(this.reconnectDelay * 2, 30000);
  }

  /** Close the WebSocket connection permanently (no reconnect). */
  close(): void {
    this.closed = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.onclose = null;
      this.ws.onerror = null;
      this.ws.onmessage = null;
      this.ws.close();
      this.ws = null;
    }
  }
}
