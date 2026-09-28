import { createHash, timingSafeEqual } from 'node:crypto';
import process from 'node:process';
import type { DatabaseSync } from 'node:sqlite';
import type { Context, Hono, Next } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { getCookie, setCookie } from 'hono/cookie';
import { HTTPException } from 'hono/http-exception';
import {
  requiresWebAuthCsrf,
  WEB_AUTH_CSRF_HEADER,
  WEB_AUTH_CSRF_VALUE,
} from '../auth-contract.js';
import {
  parseWebSessionId,
  pruneExpiredWebSessions,
  refreshWebSession,
  revokeWebSession,
  rotateWebSession,
  validateWebSession,
  WEB_SESSION_MAX_AGE_SECONDS,
} from './web-sessions.js';

const TOKEN_ENV = 'LOCAL_OPENFINANCE_WEB_TOKEN';
const SESSION_COOKIE = 'local-openfinance.session';
const LOGIN_BODY_MAX_BYTES = 1024;

export type AuthenticationPrincipal =
  | { readonly kind: 'bearer' }
  | { readonly kind: 'session'; readonly id: string };

declare module 'hono' {
  interface ContextVariableMap {
    authPrincipal: AuthenticationPrincipal;
  }
}

type LoginBody = {
  readonly token: string;
};

export function getWebToken(): string {
  const token = process.env[TOKEN_ENV]?.trim();
  if (!token) {
    throw new Error(`${TOKEN_ENV} is required for serve. Generate with: openssl rand -hex 32`);
  }
  return token;
}

export function installAuth(app: Hono, db: DatabaseSync): void {
  pruneExpiredWebSessions(db);

  app.use('/api/auth/*', async (c, next) => {
    c.header('Cache-Control', 'no-store');
    await next();
  });

  app.post('/api/auth/login', bodyLimit({ maxSize: LOGIN_BODY_MAX_BYTES }), async (c) => {
    requireCsrfHeader(c);
    const body = await readLoginBody(c);
    const expected = getWebToken();
    if (!safeEqual(body.token, expected)) {
      throw new HTTPException(401, { message: 'Unauthorized' });
    }
    const previousId = parseWebSessionId(getCookie(c, SESSION_COOKIE));
    issueSessionCookie(c, rotateWebSession(db, expected, previousId));
    return c.body(null, 204);
  });

  app.post('/api/auth/logout', (c) => {
    requireCsrfHeader(c);
    const id = parseWebSessionId(getCookie(c, SESSION_COOKIE));
    if (id) {
      revokeWebSession(db, id, getWebToken());
    }
    clearSessionCookie(c);
    return c.body(null, 204);
  });

  app.use('/api/*', authMiddleware(db));

  app.get('/api/auth/session', (c) => {
    const principal = c.get('authPrincipal');
    if (principal.kind === 'session') {
      if (!refreshWebSession(db, principal.id, getWebToken())) {
        throw new HTTPException(401, { message: 'Unauthorized' });
      }
      issueSessionCookie(c, principal.id);
    }
    return c.json({ authenticated: true });
  });
}

export function authMiddleware(db: DatabaseSync) {
  return async (c: Context, next: Next): Promise<void> => {
    const principal = authenticateRequest(c, db);
    if (!principal) {
      throw new HTTPException(401, { message: 'Unauthorized' });
    }
    if (principal.kind === 'session' && requiresWebAuthCsrf(c.req.method)) {
      requireCsrfHeader(c);
    }
    c.set('authPrincipal', principal);
    await next();
  };
}

function authenticateRequest(c: Context, db: DatabaseSync): AuthenticationPrincipal | null {
  const authorization = c.req.header('Authorization');
  if (authorization !== undefined) {
    const token = parseBearerToken(authorization);
    return token && safeEqual(token, getWebToken()) ? { kind: 'bearer' } : null;
  }

  const id = parseWebSessionId(getCookie(c, SESSION_COOKIE));
  return id && validateWebSession(db, id, getWebToken()) ? { kind: 'session', id } : null;
}

function parseBearerToken(authorization: string): string | null {
  const match = /^Bearer ([^\s]+)$/i.exec(authorization);
  return match?.[1] ?? null;
}

async function readLoginBody(c: Context): Promise<LoginBody> {
  let value: unknown;
  try {
    value = await c.req.json<unknown>();
  } catch {
    throw new HTTPException(400, { message: 'Expected a JSON body' });
  }
  if (!isRecord(value) || typeof value['token'] !== 'string' || !value['token'].trim()) {
    throw new HTTPException(400, { message: 'Expected a non-empty token string' });
  }
  return { token: value['token'].trim() };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireCsrfHeader(c: Context): void {
  if (c.req.header(WEB_AUTH_CSRF_HEADER) !== WEB_AUTH_CSRF_VALUE) {
    throw new HTTPException(403, { message: 'Forbidden' });
  }
}

function issueSessionCookie(c: Context, id: string): void {
  setCookie(c, SESSION_COOKIE, id, {
    ...sessionCookieOptions(c),
    maxAge: WEB_SESSION_MAX_AGE_SECONDS,
  });
}

function clearSessionCookie(c: Context): void {
  setCookie(c, SESSION_COOKIE, '', {
    ...sessionCookieOptions(c),
    maxAge: 0,
  });
}

function sessionCookieOptions(c: Context): {
  readonly httpOnly: true;
  readonly path: '/api';
  readonly priority: 'High';
  readonly sameSite: 'Strict';
  readonly secure: boolean;
} {
  return {
    httpOnly: true,
    path: '/api',
    priority: 'High',
    sameSite: 'Strict',
    secure: isSecureRequest(c),
  };
}

function isSecureRequest(c: Context): boolean {
  if (new URL(c.req.url).protocol === 'https:') {
    return true;
  }
  const remoteAddress: unknown = c.env?.incoming?.socket?.remoteAddress;
  if (typeof remoteAddress !== 'string' || !isLoopbackAddress(remoteAddress)) {
    return false;
  }
  const forwardedProto = c.req.header('X-Forwarded-Proto')?.split(',', 1)[0]?.trim().toLowerCase();
  if (forwardedProto === 'https') {
    return true;
  }
  const forwarded = c.req.header('Forwarded');
  return (
    forwarded
      ?.split(',', 1)[0]
      ?.split(';')
      .some((part) => /^proto=https$/i.test(part.trim())) ?? false
  );
}

function isLoopbackAddress(address: string): boolean {
  return address === '::1' || address.startsWith('127.') || address.startsWith('::ffff:127.');
}

function safeEqual(a: string, b: string): boolean {
  const digestA = createHash('sha256').update(a).digest();
  const digestB = createHash('sha256').update(b).digest();
  return timingSafeEqual(digestA, digestB);
}
