import { HTTPException } from 'hono/http-exception';

type HttpStatus = ConstructorParameters<typeof HTTPException>[0];

const statusMap: Record<string, HttpStatus> = {
  'invalid-argument': 400,
  'unauthenticated': 401,
  'permission-denied': 403,
  'not-found': 404,
  'deadline-exceeded': 408,
  'resource-exhausted': 429,
  'internal': 500,
};

export function throwApiError(code: string, message: string): never {
  const status = statusMap[code] ?? 500;
  throw new HTTPException(status, { message });
}
