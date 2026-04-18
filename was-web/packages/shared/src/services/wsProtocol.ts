// Wire-protocol scopes carried over the multiplexed WebSocket. Kept shared so
// server and client can't drift.
export type UpdateScope = 'adventures' | 'players' | 'spritesheets' | 'mapChanges';
