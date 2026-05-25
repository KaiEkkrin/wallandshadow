// Application-specific WebSocket close codes (4000-4999 range, per RFC 6455).
// Kept in sync with the client-side constants in honoWebSocket.ts so the
// client can render a typed error per code instead of generic "disconnected".

// Token verification failed at upgrade time.
export const WS_CLOSE_AUTH_REJECTED = 4001;

// Account is suspended (banned). Sent at upgrade rejection AND fired
// post-ban by disconnectBannedUser to kick a live session off.
export const WS_CLOSE_ACCOUNT_SUSPENDED = 4003;
