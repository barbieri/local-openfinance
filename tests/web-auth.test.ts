import { afterEach, describe, expect, it } from 'vitest';
import { clearAuthToken, getAuthToken, setAuthToken } from '../src/web/client/lib/auth.js';

class MemoryStorage {
  readonly store = new Map<string, string>();

  getItem(key: string): string | null {
    return this.store.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.store.set(key, value);
  }

  removeItem(key: string): void {
    this.store.delete(key);
  }
}

describe('web auth token storage', () => {
  afterEach(() => {
    clearAuthToken();
    Reflect.deleteProperty(globalThis, 'sessionStorage');
  });

  it('persists the token in sessionStorage and clears it on logout', () => {
    const storage = new MemoryStorage();
    Object.defineProperty(globalThis, 'sessionStorage', {
      configurable: true,
      value: storage,
    });

    setAuthToken('secret-token');
    expect(getAuthToken()).toBe('secret-token');
    expect(storage.getItem('local-openfinance.web-token')).toBe('secret-token');

    clearAuthToken();
    expect(getAuthToken()).toBeNull();
    expect(storage.getItem('local-openfinance.web-token')).toBeNull();
  });
});
