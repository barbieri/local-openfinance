import { webRequest } from './request.js';

const LEGACY_TOKEN_STORAGE_KEY = 'local-openfinance.web-token';

export type AuthResult =
  | { readonly kind: 'anonymous'; readonly error: string | null }
  | { readonly kind: 'authenticated' };

export type AuthState =
  | { readonly kind: 'checking' }
  | { readonly kind: 'submitting' }
  | AuthResult;

export type LogoutResult = { readonly ok: true } | { readonly ok: false; readonly error: string };

const authGenerationBrand = Symbol('auth-generation');
export type AuthGeneration = { readonly [authGenerationBrand]: true };

const invalidationListeners = new Set<(state: AuthResult) => void>();
let bootstrapPromise: Promise<AuthResult> | null = null;
let authMutationQueue: Promise<void> = Promise.resolve();
let logoutPromise: Promise<LogoutResult> | null = null;
let authGeneration = createAuthGeneration();

export function onAuthInvalidated(listener: (state: AuthResult) => void): () => void {
  invalidationListeners.add(listener);
  return () => {
    invalidationListeners.delete(listener);
  };
}

export function invalidateAuth(error: string | null = null): void {
  bootstrapPromise = null;
  advanceAuthGeneration();
  const state: AuthResult = { kind: 'anonymous', error };
  for (const listener of invalidationListeners) {
    listener(state);
  }
}

export function currentAuthGeneration(): AuthGeneration {
  return authGeneration;
}

export function invalidateAuthForGeneration(generation: AuthGeneration): void {
  if (generation === authGeneration) {
    invalidateAuth();
  }
}

export function bootstrapAuth(): Promise<AuthResult> {
  if (bootstrapPromise) {
    return bootstrapPromise;
  }
  const urlToken = takeTokenFromUrl();
  const legacyToken = takeLegacyStoredToken();
  const token = urlToken ?? legacyToken;
  bootstrapPromise = token ? login(token) : probeAuth();
  return bootstrapPromise;
}

export async function probeAuth(): Promise<AuthResult> {
  try {
    const response = await webRequest('/api/auth/session');
    return response.ok
      ? { kind: 'authenticated' }
      : { kind: 'anonymous', error: response.status === 401 ? null : await readError(response) };
  } catch (error) {
    return { kind: 'anonymous', error: formatError(error) };
  }
}

export function login(token: string): Promise<AuthResult> {
  return serializeAuthMutation(() => performLogin(token));
}

async function performLogin(token: string): Promise<AuthResult> {
  const normalizedToken = token.trim();
  if (!normalizedToken) {
    return { kind: 'anonymous', error: 'Token is required' };
  }
  try {
    const response = await webRequest('/api/auth/login', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ token: normalizedToken }),
    });
    const state: AuthResult = response.ok
      ? { kind: 'authenticated' }
      : { kind: 'anonymous', error: await readError(response) };
    if (state.kind === 'authenticated') {
      advanceAuthGeneration();
    }
    bootstrapPromise = Promise.resolve(state);
    return state;
  } catch (error) {
    const state: AuthResult = { kind: 'anonymous', error: formatError(error) };
    bootstrapPromise = Promise.resolve(state);
    return state;
  }
}

export function logout(): Promise<LogoutResult> {
  if (logoutPromise) {
    return logoutPromise;
  }
  const pending = serializeAuthMutation(performLogout);
  logoutPromise = pending;
  void pending.then(() => {
    if (logoutPromise === pending) {
      logoutPromise = null;
    }
  });
  return pending;
}

async function performLogout(): Promise<LogoutResult> {
  try {
    const response = await webRequest('/api/auth/logout', { method: 'POST' });
    if (response.status === 204 || response.status === 401) {
      invalidateAuth();
      return { ok: true };
    }
    return { ok: false, error: await readError(response) };
  } catch (error) {
    return { ok: false, error: formatError(error) };
  }
}

function serializeAuthMutation<T>(operation: () => Promise<T>): Promise<T> {
  const pending = authMutationQueue.then(operation, operation);
  authMutationQueue = pending.then(
    () => undefined,
    () => undefined,
  );
  return pending;
}

function createAuthGeneration(): AuthGeneration {
  return Object.freeze({ [authGenerationBrand]: true });
}

function advanceAuthGeneration(): void {
  authGeneration = createAuthGeneration();
}

function takeTokenFromUrl(): string | null {
  const browser = getBrowser();
  if (!browser) {
    return null;
  }
  const params = new URLSearchParams(browser.location.search);
  const token = params.get('token');
  if (!token) {
    return null;
  }
  params.delete('token');
  const query = params.toString();
  const next = `${browser.location.pathname}${query ? `?${query}` : ''}${browser.location.hash}`;
  browser.history.replaceState({}, '', next);
  return token;
}

function takeLegacyStoredToken(): string | null {
  try {
    const token = globalThis.sessionStorage?.getItem(LEGACY_TOKEN_STORAGE_KEY) ?? null;
    globalThis.sessionStorage?.removeItem(LEGACY_TOKEN_STORAGE_KEY);
    return token?.trim() || null;
  } catch {
    return null;
  }
}

async function readError(response: Response): Promise<string> {
  const text = await response.text();
  return text.trim() || response.statusText || `Request failed with status ${response.status}`;
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : 'Authentication request failed';
}

type BrowserGlobals = {
  readonly location: {
    readonly search: string;
    readonly pathname: string;
    readonly hash: string;
  };
  readonly history: {
    replaceState(data: object, unused: string, url: string): void;
  };
};

function getBrowser(): BrowserGlobals | null {
  const candidate: unknown = globalThis;
  if (!isBrowserGlobals(candidate)) {
    return null;
  }
  return candidate;
}

function isBrowserGlobals(value: unknown): value is typeof globalThis & BrowserGlobals {
  return (
    typeof value === 'object' &&
    value !== null &&
    'location' in value &&
    'history' in value &&
    typeof value.location === 'object' &&
    value.location !== null &&
    typeof value.history === 'object' &&
    value.history !== null &&
    'replaceState' in value.history &&
    typeof value.history.replaceState === 'function'
  );
}
