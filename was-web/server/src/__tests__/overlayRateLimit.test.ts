import { describe, test, expect } from 'vitest';
import { consumeToken, type TokenBucket } from '../ws/liveOverlay.js';

describe('consumeToken (overlay rate limiter)', () => {
  test('allows up to capacity in a burst, then blocks', () => {
    const bucket: TokenBucket = { tokens: 3, last: 1000 };
    // No time passes between calls (same `now`).
    expect(consumeToken(bucket, 1000, 3, 3)).toBe(true);
    expect(consumeToken(bucket, 1000, 3, 3)).toBe(true);
    expect(consumeToken(bucket, 1000, 3, 3)).toBe(true);
    expect(consumeToken(bucket, 1000, 3, 3)).toBe(false); // bucket empty
  });

  test('refills over time up to capacity', () => {
    const bucket: TokenBucket = { tokens: 0, last: 1000 };
    // 1 second later at 3 tokens/sec refills to capacity (3), allowing one.
    expect(consumeToken(bucket, 2000, 3, 3)).toBe(true);
    expect(bucket.tokens).toBeCloseTo(2, 5);
  });

  test('does not exceed capacity on long idle', () => {
    const bucket: TokenBucket = { tokens: 0, last: 1000 };
    expect(consumeToken(bucket, 100000, 5, 3)).toBe(true);
    expect(bucket.tokens).toBeCloseTo(4, 5); // capped at 5, then minus 1
  });
});
