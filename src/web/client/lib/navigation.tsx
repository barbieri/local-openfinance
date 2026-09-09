import {
  createContext,
  type ReactNode,
  use,
  useCallback,
  useMemo,
  useState,
  useSyncExternalStore,
} from 'react';
import {
  getAppHashServerSnapshot,
  getAppHashSnapshot,
  parseAppHash,
  pushTransactionHash,
  type ReportsSection,
  replaceAppHash,
  replaceLocationHash,
  replaceReportsHash,
  subscribeAppHash,
} from './app-hash.js';
import type { TabId } from './tab-id.js';

export type { TabId } from './tab-id.js';

type AppRoute =
  | { readonly kind: 'tab'; readonly tab: TabId }
  | { readonly kind: 'transaction'; readonly transactionId: string };

function routeFromParsed(parsed: ReturnType<typeof parseAppHash>): AppRoute {
  if (parsed.route === 'transaction') {
    return { kind: 'transaction', transactionId: parsed.transactionId };
  }
  return { kind: 'tab', tab: parsed.tab };
}

type AppNavigationContextValue = {
  readonly route: AppRoute;
  readonly tab: TabId | null;
  readonly transactionId: string | null;
  readonly setTab: (tab: TabId) => void;
  readonly openTransactionPermalink: (transactionId: string) => void;
  readonly closeTransactionPermalink: () => void;
  readonly reportsSection: ReportsSection | null;
  readonly reportsReportId: string | null;
  readonly reportsRunId: string | null;
  readonly setReportsSection: (
    reportId: string | null,
    section: ReportsSection,
    runId?: string | null,
  ) => void;
  readonly transactionFilters: Record<string, string | string[]>;
  readonly openTransactions: (filters: Record<string, string | string[]>) => void;
  readonly clearTransactionFilters: () => void;
};

const AppNavigationContext = createContext<AppNavigationContextValue | null>(null);

const DEFAULT_TRANSACTIONS_HASH = '#/transactions';

export function AppNavigationProvider({ children }: { readonly children: ReactNode }) {
  const hash = useSyncExternalStore(subscribeAppHash, getAppHashSnapshot, getAppHashServerSnapshot);
  const parsed = parseAppHash(hash);
  const route = routeFromParsed(parsed);
  const [permalinkReturnHash, setPermalinkReturnHash] = useState<string | null>(null);
  const [transactionFilters, setTransactionFilters] = useState<Record<string, string | string[]>>(
    {},
  );

  const setTab = useCallback((next: TabId) => {
    const current = parseAppHash();
    const tableStateEncoded =
      current.route === 'tab' && current.tab === 'transactions' ? current.tableStateEncoded : null;
    setPermalinkReturnHash(null);
    replaceAppHash(next, next === 'transactions' ? tableStateEncoded : null);
  }, []);

  const openTransactionPermalink = useCallback((transactionId: string) => {
    setPermalinkReturnHash(getAppHashSnapshot() || DEFAULT_TRANSACTIONS_HASH);
    pushTransactionHash(transactionId);
  }, []);

  const closeTransactionPermalink = useCallback(() => {
    const nextHash = permalinkReturnHash ?? DEFAULT_TRANSACTIONS_HASH;
    setPermalinkReturnHash(null);
    replaceLocationHash(nextHash);
  }, [permalinkReturnHash]);

  const openTransactions = useCallback((filters: Record<string, string | string[]>) => {
    setTransactionFilters(filters);
    setPermalinkReturnHash(null);
    replaceAppHash('transactions');
  }, []);

  const clearTransactionFilters = useCallback(() => {
    setTransactionFilters({});
  }, []);

  const setReportsSection = useCallback(
    (reportId: string | null, section: ReportsSection, runId?: string | null) => {
      setPermalinkReturnHash(null);
      replaceReportsHash(reportId, section, runId);
    },
    [],
  );

  const tab = route.kind === 'tab' ? route.tab : null;
  const transactionId = route.kind === 'transaction' ? route.transactionId : null;
  const reportsSection =
    parsed.route === 'tab' && parsed.tab === 'reports'
      ? (parsed.reportsSection ?? 'catalog')
      : null;
  const reportsReportId = parsed.route === 'tab' ? parsed.reportsReportId : null;
  const reportsRunId = parsed.route === 'tab' ? parsed.reportsRunId : null;

  const value = useMemo(
    () => ({
      route,
      tab,
      transactionId,
      setTab,
      openTransactionPermalink,
      closeTransactionPermalink,
      reportsSection,
      reportsReportId,
      reportsRunId,
      setReportsSection,
      transactionFilters,
      openTransactions,
      clearTransactionFilters,
    }),
    [
      route,
      tab,
      transactionId,
      setTab,
      openTransactionPermalink,
      closeTransactionPermalink,
      reportsSection,
      reportsReportId,
      reportsRunId,
      setReportsSection,
      transactionFilters,
      openTransactions,
      clearTransactionFilters,
    ],
  );

  return <AppNavigationContext.Provider value={value}>{children}</AppNavigationContext.Provider>;
}

export function useAppNavigation(): AppNavigationContextValue {
  const ctx = use(AppNavigationContext);
  if (!ctx) {
    throw new Error('useAppNavigation must be used within AppNavigationProvider');
  }
  return ctx;
}
