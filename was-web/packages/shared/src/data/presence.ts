// Per-user ephemeral presence state for an adventure room. Broadcast over the
// WebSocket on the `presence` scope; never persisted. Extra fields (e.g.
// currentMapId, viewport, scribbles) can be added here as new ephemeral
// features land — the server registry stores whatever this shape says.
export interface PresenceUserState {
  userId: string;
  /** ms since epoch. While `connected` is true this tracks the most recent
   *  connect time; once disconnected it freezes at the moment of disconnect. */
  lastSeen: number;
  /** True iff the user has at least one open WebSocket subscribed to this
   *  adventure's presence scope. */
  connected: boolean;
}
