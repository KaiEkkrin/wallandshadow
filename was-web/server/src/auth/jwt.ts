import { SignJWT, jwtVerify, type JWTPayload } from 'jose';

const DEV_SECRET = 'dev-only-secret-change-in-production-please-do-not-use';

function getSecret(): Uint8Array {
  const secret = process.env.JWT_SECRET ?? (process.env.NODE_ENV !== 'production' ? DEV_SECRET : undefined);
  if (!secret) {
    throw new Error('JWT_SECRET environment variable is required in production');
  }
  return new TextEncoder().encode(secret);
}

export async function signJwt(uid: string): Promise<string> {
  return new SignJWT({ sub: uid })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('24h')
    .sign(getSecret());
}

export async function verifyJwt(token: string): Promise<{ uid: string }> {
  const { payload } = await jwtVerify(token, getSecret());
  const sub = (payload as JWTPayload).sub;
  if (!sub) {
    throw new Error('JWT missing sub claim');
  }
  return { uid: sub };
}
