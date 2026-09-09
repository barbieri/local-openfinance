const TOKEN_STORAGE_KEY = 'local-openfinance.web-token';

let token: string | null = null;
const invalidationListeners = new Set<() => void>();

export function onAuthInvalidated(listener: () => void): () => void {
  invalidationListeners.add(listener);
  return () => {
    invalidationListeners.delete(listener);
  };
}

export function invalidateAuth(): void {
  clearAuthToken();
  for (const listener of invalidationListeners) {
    listener();
  }
}

export function bootstrapAuthFromUrl(): boolean {
  const browser = getBrowser();
  if (!browser) {
    return getAuthToken() !== null;
  }
  const params = new URLSearchParams(browser.location.search);
  const urlToken = params.get('token');
  if (urlToken) {
    setAuthToken(urlToken);
    params.delete('token');
    const next = `${browser.location.pathname}${params.toString() ? `?${params}` : ''}${browser.location.hash}`;
    browser.history.replaceState({}, '', next);
    return true;
  }

  return getAuthToken() !== null;
}

export function setAuthToken(value: string): void {
  token = value.trim();
  writeStoredToken(token);
}

export function clearAuthToken(): void {
  token = null;
  writeStoredToken(null);
}

export function getAuthToken(): string | null {
  if (token) {
    return token;
  }
  const stored = readStoredToken();
  if (stored) {
    token = stored;
  }
  return token;
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
  const candidate = globalThis as unknown as Partial<BrowserGlobals>;
  if (!candidate.location || !candidate.history) {
    return null;
  }
  return candidate as BrowserGlobals;
}

function readStoredToken(): string | null {
  try {
    return globalThis.sessionStorage?.getItem(TOKEN_STORAGE_KEY) ?? null;
  } catch {
    return null;
  }
}

function writeStoredToken(value: string | null): void {
  try {
    if (!globalThis.sessionStorage) {
      return;
    }
    if (value) {
      globalThis.sessionStorage.setItem(TOKEN_STORAGE_KEY, value);
      return;
    }
    globalThis.sessionStorage.removeItem(TOKEN_STORAGE_KEY);
  } catch {
    return;
  }
}
