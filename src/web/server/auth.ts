import { timingSafeEqual } from 'node:crypto';
import process from 'node:process';
import type { Context, Next } from 'hono';
import { HTTPException } from 'hono/http-exception';

const TOKEN_ENV = 'LOCAL_OPENFINANCE_WEB_TOKEN';

export function getWebToken(): string {
  const token = process.env[TOKEN_ENV]?.trim();
  if (!token) {
    throw new Error(`${TOKEN_ENV} is required for serve. Generate with: openssl rand -hex 32`);
  }
  return token;
}

export function authMiddleware() {
  return async (c: Context, next: Next): Promise<void> => {
    const expected = getWebToken();
    const header = c.req.header('Authorization');
    const token = header?.startsWith('Bearer ') ? header.slice(7) : null;

    if (!token || !safeEqual(token, expected)) {
      throw new HTTPException(401, { message: 'Unauthorized' });
    }

    await next();
  };
}

function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) {
    return false;
  }
  return timingSafeEqual(bufA, bufB);
}
