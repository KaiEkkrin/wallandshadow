// Wire-protocol scopes carried over the multiplexed WebSocket. Kept shared so
// server and client can't drift.
export type UpdateScope =
  | 'adventures'
  | 'players'
  | 'spritesheets'
  | 'mapChanges'
  | 'profile'
  | 'adventure'
  | 'map';

// Heartbeat frames. Client sends ping; server echoes pong with the same id.
// Used to measure round-trip time and detect dead connections.
export interface PingFrame { type: 'ping'; id: number }
export interface PongFrame { type: 'pong'; id: number }
