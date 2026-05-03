/**
 * Single source of truth for all network quality monitoring thresholds and
 * timings. Tune values here; nowhere else.
 */

/** Rolling window used for both reconnect-count and resync-count tracking. */
export const QUALITY_WINDOW_MS = 60 * 1_000;

/** WebSocket ping interval. */
export const HEARTBEAT_INTERVAL_MS = 15_000;

/** RTT above this → 'danger'. Also used as the pending-exit timeout after the
 *  first ping: if no pong arrives within this window the connection is treated
 *  as high-latency and the "Getting ready…" state is exited. */
export const RTT_DANGER_MS = 800;

/** RTT above this (but ≤ RTT_DANGER_MS) → 'warning'. */
export const RTT_WARNING_MS = 300;

/** Reconnection count in QUALITY_WINDOW_MS ≥ this → 'danger'. */
export const RECONNECT_DANGER_COUNT = 3;

/** Reconnection count in QUALITY_WINDOW_MS ≥ this (but < RECONNECT_DANGER_COUNT) → 'warning'. */
export const RECONNECT_WARNING_COUNT = 1;

/** Resync count in QUALITY_WINDOW_MS ≥ this → 'danger'. */
export const RESYNC_DANGER_COUNT = 3;

/** Resync count in QUALITY_WINDOW_MS ≥ this (but < RESYNC_DANGER_COUNT) → 'warning'. */
export const RESYNC_WARNING_COUNT = 1;

/** Smoothing factor α for the RTT exponential moving average. */
export const RTT_EMA_ALPHA = 0.2;

/** Fallback timeout for exiting 'pending' if the WebSocket never connects. */
export const PENDING_EXIT_FALLBACK_MS = 10_000;

/** How long the "Reconnect now" button stays disabled after being clicked. */
export const RECONNECT_BUTTON_COOLDOWN_MS = 3_000;
