const TRANSACTION_ROUTE_PATTERN = /^#\/transaction\/[A-Za-z0-9_%+.-]+$/u;
const TRANSACTION_FILTER_ROUTE_PATTERN = /^#\/transactions\/s=[A-Za-z0-9+$-]+$/u;

export function isSupportedReportHref(
  value: string | undefined,
  publicBaseUrl?: string | undefined,
): boolean {
  if (!value) return false;
  if (isSupportedRoute(value)) return true;
  if (!publicBaseUrl) return false;
  try {
    const href = new URL(value);
    const base = new URL(publicBaseUrl);
    return (
      href.origin === base.origin &&
      normalizePath(href.pathname) === normalizePath(base.pathname) &&
      isSupportedRoute(href.hash)
    );
  } catch {
    return false;
  }
}

function isSupportedRoute(value: string): boolean {
  return TRANSACTION_ROUTE_PATTERN.test(value) || TRANSACTION_FILTER_ROUTE_PATTERN.test(value);
}

function normalizePath(value: string): string {
  return value.replace(/\/+$/u, '') || '/';
}
