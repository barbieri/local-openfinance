import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { migrateDatabase } from '../src/db/migrate.js';
import { apiFetch } from '../src/web/client/lib/api.js';
import {
  bootstrapAuth,
  invalidateAuth,
  login,
  logout,
  onAuthInvalidated,
  probeAuth,
} from '../src/web/client/lib/auth.js';
import { installAuth } from '../src/web/server/auth.js';

const TOKEN = 'web-auth-test-token';
const CSRF_HEADERS = { 'X-Local-OpenFinance-CSRF': '1' };
const databases: DatabaseSync[] = [];

afterEach(() => {
  delete process.env['LOCAL_OPENFINANCE_WEB_TOKEN'];
  invalidateAuth();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  for (const db of databases.splice(0)) {
    db.close();
  }
});

function createDatabase(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  migrateDatabase(db);
  databases.push(db);
  return db;
}

function createApp(db = createDatabase()): Hono {
  process.env['LOCAL_OPENFINANCE_WEB_TOKEN'] = TOKEN;
  const app = new Hono();
  installAuth(app, db);
  return app;
}

async function logIn(app: Hono, token = TOKEN): Promise<Response> {
  return app.request('/api/auth/login', {
    method: 'POST',
    headers: { ...CSRF_HEADERS, 'Content-Type': 'application/json' },
    body: JSON.stringify({ token }),
  });
}

function readCookiePair(response: Response): string {
  const setCookie = response.headers.get('set-cookie');
  if (!setCookie) {
    throw new Error('Expected Set-Cookie response header');
  }
  return setCookie.split(';', 1)[0] ?? '';
}

function readStringField(row: unknown, field: string): string {
  if (!isRecord(row) || typeof row[field] !== 'string') {
    throw new Error(`Expected ${field} to be a string`);
  }
  return row[field];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

describe('web auth routes', () => {
  it('logs in with an opaque host-only cookie and stores only its hash', async () => {
    const db = createDatabase();
    const response = await logIn(createApp(db));

    expect(response.status).toBe(204);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('access-control-allow-origin')).toBeNull();
    const cookie = response.headers.get('set-cookie') ?? '';
    expect(cookie).toContain('local-openfinance.session=');
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('Max-Age=34560000');
    expect(cookie).toContain('Path=/api');
    expect(cookie).toContain('Priority=High');
    expect(cookie).toContain('SameSite=Strict');
    expect(cookie).not.toContain('Domain=');
    expect(cookie).not.toContain('Secure');
    expect(cookie).not.toContain(TOKEN);
    const id = readCookiePair(response).split('=', 2)[1] ?? '';
    expect(id).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    const stored = readStringField(
      db.prepare('SELECT session_hash FROM web_sessions').get(),
      'session_hash',
    );
    expect(stored).toMatch(/^[a-f0-9]{64}$/u);
    expect(stored).not.toBe(id);
  });

  it('authenticates, refreshes expiry, and keeps the same session id', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
    const db = createDatabase();
    const app = createApp(db);
    const cookie = readCookiePair(await logIn(app));
    const initialExpiry = readStringField(
      db.prepare('SELECT expires_at FROM web_sessions').get(),
      'expires_at',
    );
    vi.setSystemTime(new Date('2026-01-02T00:00:00.000Z'));

    const response = await app.request('/api/auth/session', { headers: { Cookie: cookie } });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ authenticated: true });
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('set-cookie')).toContain('Max-Age=34560000');
    expect(readCookiePair(response)).toBe(cookie);
    const refreshedExpiry = readStringField(
      db.prepare('SELECT expires_at FROM web_sessions').get(),
      'expires_at',
    );
    expect(refreshedExpiry).not.toBe(initialExpiry);
    expect(refreshedExpiry).toBe('2027-02-06T00:00:00.000Z');
  });

  it('keeps sessions valid when a fresh app uses the same database', async () => {
    const db = createDatabase();
    const cookie = readCookiePair(await logIn(createApp(db)));

    const response = await createApp(db).request('/api/auth/session', {
      headers: { Cookie: cookie },
    });

    expect(response.status).toBe(200);
  });

  it('invalidates existing sessions when the web token rotates', async () => {
    const app = createApp();
    const cookie = readCookiePair(await logIn(app));
    process.env['LOCAL_OPENFINANCE_WEB_TOKEN'] = 'rotated-token';

    const response = await app.request('/api/auth/session', { headers: { Cookie: cookie } });

    expect(response.status).toBe(401);
  });

  it('rotates a presented session when logging in again', async () => {
    const db = createDatabase();
    const app = createApp(db);
    const firstCookie = readCookiePair(await logIn(app));

    const secondLogin = await app.request('/api/auth/login', {
      method: 'POST',
      headers: { ...CSRF_HEADERS, 'Content-Type': 'application/json', Cookie: firstCookie },
      body: JSON.stringify({ token: TOKEN }),
    });
    const secondCookie = readCookiePair(secondLogin);
    const firstReplay = await app.request('/api/auth/session', {
      headers: { Cookie: firstCookie },
    });
    const secondReplay = await app.request('/api/auth/session', {
      headers: { Cookie: secondCookie },
    });

    expect(secondLogin.status).toBe(204);
    expect(secondCookie).not.toBe(firstCookie);
    expect(firstReplay.status).toBe(401);
    expect(secondReplay.status).toBe(200);
    expect(db.prepare('SELECT COUNT(*) AS count FROM web_sessions').get()).toEqual({ count: 1 });
  });

  it('preserves Bearer authentication without minting a cookie', async () => {
    const response = await createApp().request('/api/auth/session', {
      headers: { Authorization: `Bearer ${TOKEN}` },
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ authenticated: true });
    expect(response.headers.get('set-cookie')).toBeNull();
  });

  it('fails closed when an invalid Authorization header accompanies a valid cookie', async () => {
    const app = createApp();
    const cookie = readCookiePair(await logIn(app));

    const response = await app.request('/api/auth/session', {
      headers: { Authorization: 'Bearer wrong-token', Cookie: cookie },
    });

    expect(response.status).toBe(401);
  });

  it('validates login JSON, the token, and the CSRF header', async () => {
    const app = createApp();
    const missingCsrf = await app.request('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: TOKEN }),
    });
    const malformed = await app.request('/api/auth/login', {
      method: 'POST',
      headers: { ...CSRF_HEADERS, 'Content-Type': 'application/json' },
      body: '{',
    });
    const wrongShape = await app.request('/api/auth/login', {
      method: 'POST',
      headers: { ...CSRF_HEADERS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: 42 }),
    });
    const wrongToken = await logIn(app, 'wrong-token');

    expect(missingCsrf.status).toBe(403);
    expect(malformed.status).toBe(400);
    expect(wrongShape.status).toBe(400);
    expect(wrongToken.status).toBe(401);
  });

  it('rejects oversized login bodies with and without a declared length', async () => {
    const app = createApp();
    const oversizedBody = JSON.stringify({ token: 'x'.repeat(2048) });
    const declaredLength = await app.request('/api/auth/login', {
      method: 'POST',
      headers: {
        ...CSRF_HEADERS,
        'Content-Length': String(new TextEncoder().encode(oversizedBody).byteLength),
        'Content-Type': 'application/json',
      },
      body: oversizedBody,
    });
    const encoder = new TextEncoder();
    const streamedRequestInit: RequestInit & { readonly duplex: 'half' } = {
      method: 'POST',
      headers: { ...CSRF_HEADERS, 'Content-Type': 'application/json' },
      body: new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(encoder.encode('{"token":"'));
          controller.enqueue(encoder.encode('x'.repeat(2048)));
          controller.enqueue(encoder.encode('"}'));
          controller.close();
        },
      }),
      duplex: 'half',
    };
    const streamed = await app.fetch(
      new Request('http://localhost/api/auth/login', streamedRequestInit),
    );

    expect(declaredLength.status).toBe(413);
    expect(streamed.status).toBe(413);
  });

  it('requires CSRF for unsafe session requests but not Bearer requests', async () => {
    const app = createApp();
    const cookie = readCookiePair(await logIn(app));

    const sessionWithoutCsrf = await app.request('/api/not-found', {
      method: 'POST',
      headers: { Cookie: cookie },
    });
    const sessionWithCsrf = await app.request('/api/not-found', {
      method: 'POST',
      headers: { Cookie: cookie, ...CSRF_HEADERS },
    });
    const bearer = await app.request('/api/not-found', {
      method: 'POST',
      headers: { Authorization: `Bearer ${TOKEN}` },
    });

    expect(sessionWithoutCsrf.status).toBe(403);
    expect(sessionWithCsrf.status).toBe(404);
    expect(bearer.status).toBe(404);
  });

  it('sets Secure only for HTTPS or HTTPS forwarded by a loopback proxy', async () => {
    const directHttps = await createApp().request('https://finance.test/api/auth/login', {
      method: 'POST',
      headers: { ...CSRF_HEADERS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: TOKEN }),
    });
    const app = createApp();
    const createProxyRequest = () =>
      new Request('http://finance.test/api/auth/login', {
        method: 'POST',
        headers: {
          ...CSRF_HEADERS,
          'Content-Type': 'application/json',
          'X-Forwarded-Proto': 'https',
        },
        body: JSON.stringify({ token: TOKEN }),
      });
    const trustedProxy = await app.fetch(createProxyRequest(), {
      incoming: { socket: { remoteAddress: '127.0.0.1' } },
    });
    const untrustedProxy = await app.fetch(createProxyRequest(), {
      incoming: { socket: { remoteAddress: '192.0.2.1' } },
    });

    expect(directHttps.headers.get('set-cookie')).toContain('Secure');
    expect(trustedProxy.headers.get('set-cookie')).toContain('Secure');
    expect(untrustedProxy.headers.get('set-cookie')).not.toContain('Secure');
  });

  it('revokes the session on logout and rejects a replayed cookie', async () => {
    const app = createApp();
    const cookie = readCookiePair(await logIn(app));

    const missingCsrf = await app.request('/api/auth/logout', {
      method: 'POST',
      headers: { Cookie: cookie },
    });
    const response = await app.request('/api/auth/logout', {
      method: 'POST',
      headers: { Cookie: cookie, ...CSRF_HEADERS },
    });
    const replay = await app.request('/api/auth/session', { headers: { Cookie: cookie } });

    expect(missingCsrf.status).toBe(403);
    expect(response.status).toBe(204);
    expect(replay.status).toBe(401);
    const cleared = response.headers.get('set-cookie') ?? '';
    expect(cleared).toContain('local-openfinance.session=');
    expect(cleared).toContain('Max-Age=0');
    expect(cleared).toContain('HttpOnly');
    expect(cleared).toContain('Path=/api');
    expect(cleared).toContain('Priority=High');
    expect(cleared).toContain('SameSite=Strict');
  });

  it('clears stale and malformed cookies on repeated logout', async () => {
    const app = createApp();
    const cookie = readCookiePair(await logIn(app));
    const firstLogout = await app.request('/api/auth/logout', {
      method: 'POST',
      headers: { Cookie: cookie, ...CSRF_HEADERS },
    });
    const staleLogout = await app.request('/api/auth/logout', {
      method: 'POST',
      headers: { Cookie: cookie, ...CSRF_HEADERS },
    });
    const malformedLogout = await app.request('/api/auth/logout', {
      method: 'POST',
      headers: { Cookie: 'local-openfinance.session=malformed', ...CSRF_HEADERS },
    });

    expect(firstLogout.status).toBe(204);
    expect(staleLogout.status).toBe(204);
    expect(staleLogout.headers.get('set-cookie')).toContain('Max-Age=0');
    expect(malformedLogout.status).toBe(204);
    expect(malformedLogout.headers.get('set-cookie')).toContain('Max-Age=0');
  });

  it('keeps bearer logout idempotent while requiring CSRF', async () => {
    const app = createApp();
    const missingCsrf = await app.request('/api/auth/logout', {
      method: 'POST',
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    const response = await app.request('/api/auth/logout', {
      method: 'POST',
      headers: { Authorization: `Bearer ${TOKEN}`, ...CSRF_HEADERS },
    });

    expect(missingCsrf.status).toBe(403);
    expect(response.status).toBe(204);
    expect(response.headers.get('set-cookie')).toContain('Max-Age=0');
  });
});

describe('web auth client', () => {
  it('removes and exchanges a legacy sessionStorage token before the request completes', async () => {
    let finishLogin: ((response: Response) => void) | undefined;
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<Response>((resolve) => {
            finishLogin = resolve;
          }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    const values = new Map([['local-openfinance.web-token', 'legacy-secret']]);
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      removeItem: (key: string) => values.delete(key),
    };
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('location', { search: '', pathname: '/', hash: '' });
    vi.stubGlobal('history', { replaceState: vi.fn() });
    vi.stubGlobal('sessionStorage', storage);

    const pending = bootstrapAuth();
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());

    expect(values.has('local-openfinance.web-token')).toBe(false);
    expect(fetchMock.mock.calls[0]?.[1]?.body).toBe(JSON.stringify({ token: 'legacy-secret' }));
    finishLogin?.(new Response(null, { status: 204 }));
    await expect(pending).resolves.toEqual({ kind: 'authenticated' });
    await expect(logout()).resolves.toEqual({ ok: true });
    expect(values.has('local-openfinance.web-token')).toBe(false);
  });

  it('removes a URL token before waiting for the login response', async () => {
    let finishLogin: ((response: Response) => void) | undefined;
    const fetchMock = vi.fn(
      (_input: Parameters<typeof fetch>[0], _init?: RequestInit) =>
        new Promise<Response>((resolve) => {
          finishLogin = resolve;
        }),
    );
    const replaceState = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('location', {
      search: '?token=first-run-secret&view=all',
      pathname: '/dashboard',
      hash: '#/transactions',
    });
    vi.stubGlobal('history', { replaceState });

    const pending = bootstrapAuth();
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());

    expect(replaceState).toHaveBeenCalledWith({}, '', '/dashboard?view=all#/transactions');
    const loginInit = fetchMock.mock.calls[0]?.[1];
    expect(loginInit?.body).toBe(JSON.stringify({ token: 'first-run-secret' }));
    finishLogin?.(new Response(null, { status: 204 }));
    await expect(pending).resolves.toEqual({ kind: 'authenticated' });
  });

  it('probes, logs in, and logs out without reading sessionStorage', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('Unauthorized', { status: 401 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);
    Object.defineProperty(globalThis, 'sessionStorage', {
      configurable: true,
      get: () => {
        throw new Error('sessionStorage must not be accessed');
      },
    });
    const invalidated = vi.fn();
    const unsubscribe = onAuthInvalidated(invalidated);

    await expect(probeAuth()).resolves.toEqual({ kind: 'anonymous', error: null });
    await expect(login(TOKEN)).resolves.toEqual({ kind: 'authenticated' });
    await expect(logout()).resolves.toEqual({ ok: true });

    const loginInit = fetchMock.mock.calls[1]?.[1];
    expect(loginInit?.credentials).toBe('same-origin');
    expect(loginInit?.cache).toBe('no-store');
    const logoutInit = fetchMock.mock.calls[2]?.[1];
    expect(logoutInit?.credentials).toBe('same-origin');
    expect(logoutInit?.cache).toBe('no-store');
    expect(new Headers(logoutInit?.headers).get('X-Local-OpenFinance-CSRF')).toBe('1');
    expect(invalidated).toHaveBeenCalledWith({ kind: 'anonymous', error: null });
    unsubscribe();
    Reflect.deleteProperty(globalThis, 'sessionStorage');
  });

  it('shares concurrent logout work and publishes anonymous state only after success', async () => {
    let finishLogout: ((response: Response) => void) | undefined;
    const fetchMock = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          finishLogout = resolve;
        }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const invalidated = vi.fn();
    const unsubscribe = onAuthInvalidated(invalidated);

    const first = logout();
    const second = logout();
    expect(second).toBe(first);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    expect(invalidated).not.toHaveBeenCalled();
    finishLogout?.(new Response(null, { status: 204 }));
    await expect(first).resolves.toEqual({ ok: true });

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(invalidated).toHaveBeenCalledOnce();
    expect(invalidated).toHaveBeenCalledWith({ kind: 'anonymous', error: null });
    unsubscribe();
  });

  it('keeps authenticated state when logout has a network or server failure', async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error('network unavailable'))
      .mockResolvedValueOnce(new Response('failure', { status: 503 }));
    vi.stubGlobal('fetch', fetchMock);
    const invalidated = vi.fn();
    const unsubscribe = onAuthInvalidated(invalidated);

    await expect(logout()).resolves.toEqual({ ok: false, error: 'network unavailable' });
    await expect(logout()).resolves.toEqual({ ok: false, error: 'failure' });

    expect(invalidated).not.toHaveBeenCalled();
    unsubscribe();
  });

  it('serializes login and logout so a late login cannot restore a logged-out session', async () => {
    let finishLogin: ((response: Response) => void) | undefined;
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<Response>((resolve) => {
            finishLogin = resolve;
          }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);
    const invalidated = vi.fn();
    const unsubscribe = onAuthInvalidated(invalidated);

    const pendingLogin = login(TOKEN);
    const pendingLogout = logout();
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    finishLogin?.(new Response(null, { status: 204 }));
    await expect(pendingLogin).resolves.toEqual({ kind: 'authenticated' });
    await expect(pendingLogout).resolves.toEqual({ ok: true });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(invalidated).toHaveBeenCalledWith({ kind: 'anonymous', error: null });
    unsubscribe();
  });

  it('hardens apiFetch and invalidates authentication on 401', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 401 }));
    vi.stubGlobal('fetch', fetchMock);
    const invalidated = vi.fn();
    const unsubscribe = onAuthInvalidated(invalidated);

    await apiFetch('/api/example', {
      method: 'DELETE',
      headers: { Authorization: 'Bearer must-not-leak' },
    });

    const init = fetchMock.mock.calls[0]?.[1];
    expect(init?.credentials).toBe('same-origin');
    expect(init?.cache).toBe('no-store');
    const headers = new Headers(init?.headers);
    expect(headers.get('Authorization')).toBeNull();
    expect(headers.get('X-Local-OpenFinance-CSRF')).toBe('1');
    expect(invalidated).toHaveBeenCalledWith({ kind: 'anonymous', error: null });
    unsubscribe();
  });

  it('ignores a delayed 401 from an earlier authentication generation', async () => {
    let finishOldRequest: ((response: Response) => void) | undefined;
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<Response>((resolve) => {
            finishOldRequest = resolve;
          }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);
    const invalidated = vi.fn();
    const unsubscribe = onAuthInvalidated(invalidated);

    const oldRequest = apiFetch('/api/slow');
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    await expect(login(TOKEN)).resolves.toEqual({ kind: 'authenticated' });
    finishOldRequest?.(new Response(null, { status: 401 }));
    await expect(oldRequest).resolves.toMatchObject({ status: 401 });

    expect(invalidated).not.toHaveBeenCalled();
    unsubscribe();
  });
});
