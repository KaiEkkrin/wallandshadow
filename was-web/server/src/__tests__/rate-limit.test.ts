import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { createApp } from '../app.js';

// These tests need the rate limiters to be active, which the global test
// config disables via DISABLE_RATE_LIMIT=true. We temporarily clear that
// flag for this file and restore it afterward.
//
// The skip() callback in each limiter is evaluated per-request, so toggling
// the env var here is sufficient.

describe('rate limiting', () => {
  let savedEnv: string | undefined;

  beforeAll(() => {
    savedEnv = process.env.DISABLE_RATE_LIMIT;
    delete process.env.DISABLE_RATE_LIMIT;
  });

  afterAll(() => {
    if (savedEnv !== undefined) {
      process.env.DISABLE_RATE_LIMIT = savedEnv;
    } else {
      delete process.env.DISABLE_RATE_LIMIT;
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
