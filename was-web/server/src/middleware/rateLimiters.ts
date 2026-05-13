import { rateLimiter } from 'hono-rate-limiter';
import type { Context } from 'hono';
import type { AuthVariables } from '../auth/middleware.js';

// Caddy appends the real client IP as the last X-Forwarded-For entry.
// Falls back to socket address in local dev (no proxy).
function clientIp(c: Context): string {
  const xff = c.req.header('x-forwarded-for');
  if (xff) return xff.split(',').at(-1)!.trim();
  // @hono/node-server exposes the Node IncomingMessage via c.env
  const env = c.env as { incoming?: { socket?: { remoteAddress?: string } } };
  return env?.incoming?.socket?.remoteAddress ?? 'unknown';
}

// Skip rate limits when tests explicitly disable them, or when running inside
// the dev container (where the e2e suite signs up many fresh users per run
// from the loopback IP). Production sets NODE_ENV=production via the
// Ansible-rendered env-file, which hard-overrides both opt-out flags so a
// stray IS_LOCAL_DEV in a prod env-file can't silently disable the limiters.
const skipRateLimiting = () => {
  if (process.env.NODE_ENV === 'production') return false;
  return process.env.DISABLE_RATE_LIMIT === 'true'
    || process.env.IS_LOCAL_DEV === 'true';
};

// 10 attempts per 15 minutes. bcrypt at 12 rounds costs ~250ms/attempt;
// this is generous for a legitimate user but blocks a credential sweep.
export const loginRateLimiter = rateLimiter({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  keyGenerator: clientIp,
  skip: skipRateLimiting,
  message: { error: 'Too many login attempts, please try again later.' },
  standardHeaders: 'draft-6',
});

// 5 registrations per hour per IP is more than enough for a friend group
// signing up together; prevents account-creation spam.
export const registerRateLimiter = rateLimiter({
  windowMs: 60 * 60 * 1000,
  limit: 5,
  keyGenerator: clientIp,
  skip: skipRateLimiting,
  message: { error: 'Too many registration attempts, please try again later.' },
  standardHeaders: 'draft-6',
});

// Invite IDs are UUID v7 (128-bit entropy) — brute-force enumeration is
// infeasible regardless. This limit is a DoS guard keyed on the authenticated
// user, not IP, so a shared NAT doesn't penalise unrelated users.
export const inviteJoinRateLimiter = rateLimiter<{ Variables: AuthVariables }>({
  windowMs: 10 * 60 * 1000,
  limit: 30,
  keyGenerator: (c) => c.get('uid'),
  skip: skipRateLimiting,
  message: { error: 'Too many requests, please try again later.' },
  standardHeaders: 'draft-6',
});
