import type { TabId } from './tab-id.js';

export type { TabId };

const TAB_IDS: readonly TabId[] = [
  'transactions',
  'reports',
  'credit-cards',
  'investments',
  'loans',
  'connections',
  'accounts',
  'categories',
  'labels',
  'triage',
  'sync',
];

const TAB_ID_SET = new Set<string>(TAB_IDS);

type BrowserGlobal = typeof globalThis & {
  location: { hash: string; origin: string; pathname: string };
  history: {
    replaceState: (data: unknown, unused: string, url?: string | null) => void;
    pushState: (data: unknown, unused: string, url?: string | null) => void;
  };
  addEventListener: (type: string, listener: () => void) => void;
  removeEventListener: (type: string, listener: () => void) => void;
};

const hashListeners = new Set<() => void>();
let nativeHashListening = false;

function notifyAppHashListeners(): void {
  for (const listener of hashListeners) {
    listener();
  }
}

function ensureNativeHashListeners(browser: BrowserGlobal): void {
  if (nativeHashListening) {
    return;
  }
  nativeHashListening = true;
  browser.addEventListener('hashchange', notifyAppHashListeners);
  browser.addEventListener('popstate', notifyAppHashListeners);
}

export function subscribeAppHash(onStoreChange: () => void): () => void {
  hashListeners.add(onStoreChange);
  const browser = asBrowserGlobal(globalThis);
  if (browser) {
    ensureNativeHashListeners(browser);
  }
  return () => {
    hashListeners.delete(onStoreChange);
  };
}

export function getAppHashSnapshot(): string {
  return readBrowserHash();
}

export function getAppHashServerSnapshot(): string {
  return '';
}

function asBrowserGlobal(value: typeof globalThis): BrowserGlobal | null {
  if (typeof value === 'object' && value !== null && 'location' in value && 'history' in value) {
    return value as BrowserGlobal;
  }
  return null;
}

function readBrowserHash(): string {
  return asBrowserGlobal(globalThis)?.location.hash ?? '';
}

export function isTabId(value: string): value is TabId {
  return TAB_ID_SET.has(value);
}

export type ReportsSection = 'catalog' | 'current' | 'run' | 'chat' | 'memory';

export type ParsedTabHash = {
  readonly route: 'tab';
  readonly tab: TabId;
  readonly tableStateEncoded: string | null;
  readonly reportsSection: ReportsSection | null;
  readonly reportsReportId: string | null;
  readonly reportsRunId: string | null;
};

export type ParsedTransactionHash = {
  readonly route: 'transaction';
  readonly transactionId: string;
};

export type ParsedAppHash = ParsedTabHash | ParsedTransactionHash;

const TRANSACTION_ROUTE = 'transaction';

export function parseAppHash(hash?: string): ParsedAppHash {
  const rawHash = hash ?? readBrowserHash();
  const raw = rawHash.startsWith('#') ? rawHash.slice(1) : rawHash;
  if (!raw) {
    return emptyTabHash('transactions');
  }

  if (raw.startsWith('s=')) {
    return { ...emptyTabHash('transactions'), tableStateEncoded: raw.slice(2) };
  }

  let path = raw;
  if (path.startsWith('/')) {
    path = path.slice(1);
  }

  const slashIndex = path.indexOf('/');
  const firstSegment = slashIndex >= 0 ? path.slice(0, slashIndex) : path;
  const rest = slashIndex >= 0 ? path.slice(slashIndex + 1) : '';

  if (firstSegment === TRANSACTION_ROUTE) {
    const transactionId = safeDecodeURIComponent(rest.split('/')[0]?.trim() ?? '');
    if (transactionId.length > 0) {
      return { route: 'transaction', transactionId };
    }
    return emptyTabHash('transactions');
  }

  const tab = isTabId(firstSegment) ? firstSegment : 'transactions';
  if (tab === 'reports') {
    return parseReportsHash(rest);
  }
  const tableStateEncoded = rest.startsWith('s=') ? rest.slice(2) : null;

  return { ...emptyTabHash(tab), tableStateEncoded };
}

function emptyTabHash(tab: TabId): ParsedTabHash {
  return {
    route: 'tab',
    tab,
    tableStateEncoded: null,
    reportsSection: null,
    reportsReportId: null,
    reportsRunId: null,
  };
}

function parseReportsHash(rest: string): ParsedTabHash {
  const [first = '', second = '', third = ''] = rest.split('/').filter((part) => part.length > 0);
  if (first.length === 0) {
    return { ...emptyTabHash('reports'), reportsSection: 'catalog' };
  }
  if (first === 'memory') {
    return { ...emptyTabHash('reports'), reportsSection: 'memory' };
  }
  if (first === 'chat') {
    return {
      ...emptyTabHash('reports'),
      reportsSection: 'chat',
      reportsRunId: second.length > 0 ? safeDecodeURIComponent(second) : null,
    };
  }
  if (first === 'run' && second.length > 0) {
    return {
      ...emptyTabHash('reports'),
      reportsSection: 'run',
      reportsRunId: safeDecodeURIComponent(second),
    };
  }
  const reportId = safeDecodeURIComponent(first);
  if (second === 'memory') {
    return {
      ...emptyTabHash('reports'),
      reportsSection: 'memory',
      reportsReportId: reportId,
    };
  }
  if (second === 'chat') {
    return {
      ...emptyTabHash('reports'),
      reportsSection: 'chat',
      reportsReportId: reportId,
      reportsRunId: third.length > 0 ? safeDecodeURIComponent(third) : null,
    };
  }
  if (second === 'run' && third.length > 0) {
    return {
      ...emptyTabHash('reports'),
      reportsSection: 'run',
      reportsReportId: reportId,
      reportsRunId: safeDecodeURIComponent(third),
    };
  }
  return {
    ...emptyTabHash('reports'),
    reportsSection: 'current',
    reportsReportId: reportId,
  };
}

function safeDecodeURIComponent(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function buildAppHash(tab: TabId, tableStateEncoded?: string | null): string {
  if (tableStateEncoded && tab === 'transactions') {
    return `#/${tab}/s=${tableStateEncoded}`;
  }
  return `#/${tab}`;
}

export function buildReportsHash(
  reportId?: string | null,
  section: ReportsSection = reportId ? 'current' : 'catalog',
  runId?: string | null,
): string {
  if (!reportId || section === 'catalog') {
    return '#/reports';
  }
  const reportPath = `#/reports/${encodeURIComponent(reportId)}`;
  if (section === 'current') {
    return reportPath;
  }
  if (section === 'memory') {
    return `${reportPath}/memory`;
  }
  if (section === 'chat') {
    return runId ? `${reportPath}/chat/${encodeURIComponent(runId)}` : `${reportPath}/chat`;
  }
  if (section === 'run' && runId) {
    return `${reportPath}/run/${encodeURIComponent(runId)}`;
  }
  return reportPath;
}

export function buildTransactionHash(transactionId: string): string {
  return `#/${TRANSACTION_ROUTE}/${encodeURIComponent(transactionId)}`;
}

export function transactionPermalinkUrl(transactionId: string): string {
  const browser = asBrowserGlobal(globalThis);
  const origin = browser?.location.origin ?? '';
  const pathname = browser?.location.pathname ?? '/';
  return `${origin}${pathname}${buildTransactionHash(transactionId)}`;
}

export function replaceAppHash(tab: TabId, tableStateEncoded?: string | null): void {
  const next = tab === 'reports' ? buildReportsHash() : buildAppHash(tab, tableStateEncoded);
  writeLocationHash(next, 'replace');
}

export function replaceReportsHash(
  reportId: string | null,
  section: ReportsSection,
  runId?: string | null,
): void {
  writeLocationHash(buildReportsHash(reportId, section, runId), 'replace');
}

export function pushTransactionHash(transactionId: string): void {
  writeLocationHash(buildTransactionHash(transactionId), 'push');
}

export function replaceLocationHash(hash: string): void {
  writeLocationHash(hash, 'replace');
}

function writeLocationHash(hash: string, mode: 'replace' | 'push'): void {
  const browser = asBrowserGlobal(globalThis);
  if (!browser) {
    return;
  }
  if (browser.location.hash === hash) {
    return;
  }
  if (mode === 'push') {
    browser.history.pushState({}, '', hash);
  } else {
    browser.history.replaceState({}, '', hash);
  }
  notifyAppHashListeners();
}
