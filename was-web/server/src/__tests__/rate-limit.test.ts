import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { createApp } from '../app.js';

// These tests need the rate limiters to be active. They are disabled by
// DISABLE_RATE_LIMIT=true (set in vitest.config) and by IS_LOCAL_DEV=true
// (inherited from the dev container env). We temporarily clear both flags
// for this file and restore them afterward.
//
// The skip() callback in each limiter is evaluated per-request, so toggling
// the env vars here is sufficient.

describe('rate limiting', () => {
  let savedDisable: string | undefined;
  let savedDev: string | undefined;

  beforeAll(() => {
    savedDisable = process.env.DISABLE_RATE_LIMIT;
    savedDev = process.env.IS_LOCAL_DEV;
    delete process.env.DISABLE_RATE_LIMIT;
    delete process.env.IS_LOCAL_DEV;
  });

  afterAll(() => {
    if (savedDisable !== undefined) {
      process.env.DISABLE_RATE_LIMIT = savedDisable;
    } else {
      delete process.env.DISABLE_RATE_LIMIT;
    }
    if (savedDev !== undefined) {
      process.env.IS_LOCAL_DEV = savedDev;
    } else {
      delete process.env.IS_LOCAL_DEV;
    }
  });

  test('POST /api/auth/login returns 429 after 10 attempts from the same IP', async () => {
    const app = createApp();
    // Use a TEST-NET-3 address (RFC 5737) so this IP never collides with
    // genuine test traffic from other test files.
    const headers = {
      'Content-Type': 'application/json',
      'X-Forwarded-For': '203.0.113.1',
    };
    const body = JSON.stringify({ email: 'brute@example.com', password: 'WrongPassword1' });

    for (let i = 0; i < 10; i++) {
      const res = await app.request('/api/auth/login', { method: 'POST', headers, body });
      expect(res.status).toBe(401);
    }

    const limited = await app.request('/api/auth/login', { method: 'POST', headers, body });
    expect(limited.status).toBe(429);
    const json = (await limited.json()) as { error: string };
    expect(json.error).toContain('Too many');
  });

  test('POST /api/auth/register returns 429 after 5 attempts from the same IP', async () => {
    const app = createApp();
    const headers = {
      'Content-Type': 'application/json',
      'X-Forwarded-For': '203.0.113.2',
    };

    for (let i = 0; i < 5; i++) {
      const res = await app.request('/api/auth/register', {
        method: 'POST',
        headers,
        body: JSON.stringify({ email: `spammer${i}@example.com`, password: 'TestPass1', name: `Spammer ${i}` }),
      });
      // 201 on success, or 409 if the email collides — both are fine here
      expect([201, 409]).toContain(res.status);
    }

    const limited = await app.request('/api/auth/register', {
      method: 'POST',
      headers,
      body: JSON.stringify({ email: 'spammer99@example.com', password: 'TestPass1', name: 'Spammer 99' }),
    });
    expect(limited.status).toBe(429);
    const json = (await limited.json()) as { error: string };
    expect(json.error).toContain('Too many');
  });
});
