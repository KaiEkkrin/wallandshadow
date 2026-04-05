import { Hono } from 'hono';
import { emailIsValid, passwordIsValid } from '@wallandshadow/shared';
import { db } from '../db/connection.js';
import { users } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import { hashPassword, verifyPassword } from './password.js';
import { signJwt } from './jwt.js';
import { authMiddleware, type AuthVariables } from './middleware.js';

export const authRoutes = new Hono<{ Variables: AuthVariables }>();

// ── Current user info ───────────────────────────────────────────────────────

authRoutes.get('/me', authMiddleware, async (c) => {
  const uid = c.get('uid');
  const [user] = await db.select({
    id: users.id,
    email: users.email,
    name: users.name,
    level: users.level,
  }).from(users).where(eq(users.id, uid)).limit(1);

  if (!user) {
    return c.json({ error: 'User not found' }, 404);
  }

  return c.json({
    uid: user.id,
    email: user.email,
    name: user.name,
    level: user.level,
  });
});

authRoutes.post('/register', async (c) => {
  const body = await c.req.json<{ email?: string; password?: string; name?: string }>();
  const { email: rawEmail, password, name } = body;

  if (!rawEmail || !emailIsValid(rawEmail)) {
    return c.json({ error: 'Invalid email address' }, 400);
  }
  if (!password || !passwordIsValid(password)) {
    return c.json({ error: 'Password must be at least 8 characters and contain a letter and a number' }, 400);
  }
  if (!name || name.trim().length === 0) {
    return c.json({ error: 'Name is required' }, 400);
  }

  const email = rawEmail.trim().toLowerCase();
  const existing = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
  if (existing.length > 0) {
    return c.json({ error: 'Email already registered' }, 409);
  }

  const id = uuidv7();
  const providerSub = `local:${id}`;
  const passwordHash = await hashPassword(password);

  await db.insert(users).values({
    id,
    providerSub,
    email,
    name: name.trim(),
    level: 'standard',
    passwordHash,
  });

  const token = await signJwt(id);
  return c.json({ token, uid: id }, 201);
});

authRoutes.post('/login', async (c) => {
  const body = await c.req.json<{ email?: string; password?: string }>();
  const { email: rawEmail, password } = body;

  if (!rawEmail || !password) {
    return c.json({ error: 'Email and password are required' }, 400);
  }

  const email = rawEmail.trim().toLowerCase();
  const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  if (!user || !user.passwordHash) {
    return c.json({ error: 'Invalid credentials' }, 401);
  }

  const valid = await verifyPassword(password, user.passwordHash);
  if (!valid) {
    return c.json({ error: 'Invalid credentials' }, 401);
  }

  const token = await signJwt(user.id);
  return c.json({ token, uid: user.id });
});
