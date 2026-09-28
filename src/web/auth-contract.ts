export const WEB_AUTH_CSRF_HEADER = 'X-Local-OpenFinance-CSRF';
export const WEB_AUTH_CSRF_VALUE = '1';

const WEB_AUTH_SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export function requiresWebAuthCsrf(method: string): boolean {
  return !WEB_AUTH_SAFE_METHODS.has(method.toUpperCase());
}
