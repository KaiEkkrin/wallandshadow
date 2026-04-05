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

    // Derive WebSocket URL from HTTP base URL
    const httpUrl = baseUrl || window.location.origin;
    const wsProtocol = httpUrl.startsWith('https') ? 'wss' : 'ws';
    const host = httpUrl.replace(/^https?:\/\//, '');
    this.url = `${wsProtocol}://${host}/ws/maps/${mapId}?token=${encodeURIComponent(token)}`;

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
      // Reset reconnect delay on successful connection
      this.reconnectDelay = 1000;
    };

    this.ws.onclose = (event) => {
      if (!this.closed) {
        console.debug(`WebSocket closed (code=${event.code}), reconnecting...`);
        this.scheduleReconnect();
      }
    };

    this.ws.onerror = () => {
      // onclose will fire after onerror, which handles reconnection
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
