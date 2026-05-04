// Per-user ephemeral presence state for an adventure room. Broadcast over the
// WebSocket on the `presence` scope; never persisted. Extra fields (e.g.
// viewport, scribbles) can be added here as new ephemeral features land —
// the server registry stores whatever this shape says.
export interface PresenceUserState {
  userId: string;
  /** ms since epoch. While `connected` is true this tracks the most recent
   *  connect time; once disconnected it freezes at the moment of disconnect. */
  lastSeen: number;
  /** True iff the user has at least one open WebSocket subscribed to this
   *  adventure's presence scope. */
  connected: boolean;
  /** Which page within the adventure the user is currently viewing.
   *  `undefined` ⇒ adventure overview (or no recognised in-adventure page);
   *  otherwise the id of the map they are looking at. Frozen at the
   *  last-known value when `connected` flips to false. */
  currentMapId?: string;
}

export interface PresenceSubscription {
  /** Push a new currentMapId to the server for this presence subscription.
   *  No-op if the value is unchanged since the last call. */
  setCurrentMapId(currentMapId: string | undefined): void;
  unsubscribe(): void;
}
