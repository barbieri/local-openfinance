import {
  requiresWebAuthCsrf,
  WEB_AUTH_CSRF_HEADER,
  WEB_AUTH_CSRF_VALUE,
} from '../../auth-contract.js';

type FetchInput = Parameters<typeof fetch>[0];

export function webRequest(input: FetchInput, init?: RequestInit): Promise<Response> {
  const headers = new Headers(
    init?.headers ?? (input instanceof Request ? input.headers : undefined),
  );
  headers.delete('Authorization');
  const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
  if (requiresWebAuthCsrf(method)) {
    headers.set(WEB_AUTH_CSRF_HEADER, WEB_AUTH_CSRF_VALUE);
  }
  if (init?.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  return fetch(input, {
    ...init,
    cache: 'no-store',
    credentials: 'same-origin',
    headers,
  });
}
