import { lazy, Suspense } from 'react';
import { useTranslation } from 'react-i18next';
import { MdExpandMore, MdMoreVert } from 'react-icons/md';
import { AuthGate } from './components/auth/AuthGate.js';
import { useReferenceData } from './hooks/use-entity-ref.js';
import { invalidateAuth } from './lib/auth.js';
import { i18n, setUiLocale } from './lib/i18n.js';
import { type TabId, useAppNavigation } from './lib/navigation.js';
import { BackgroundJobsProvider } from './providers/BackgroundJobsProvider.js';

const TransactionsPage = lazy(() =>
  import('./pages/TransactionsPage.js').then((module) => ({ default: module.TransactionsPage })),
);
const CreditCardsPage = lazy(() =>
  import('./pages/EntityPages.js').then((module) => ({ default: module.CreditCardsPage })),
);
const InvestmentsPage = lazy(() =>
  import('./pages/EntityPages.js').then((module) => ({ default: module.InvestmentsPage })),
);
const LoansPage = lazy(() =>
  import('./pages/EntityPages.js').then((module) => ({ default: module.LoansPage })),
);
const AccountsPage = lazy(() =>
  import('./pages/ManagementPages.js').then((module) => ({ default: module.AccountsPage })),
);
const ConnectionsPage = lazy(() =>
  import('./pages/ManagementPages.js').then((module) => ({ default: module.ConnectionsPage })),
);
const CategoriesPage = lazy(() =>
  import('./pages/ManagementPages.js').then((module) => ({ default: module.CategoriesPage })),
);
const LabelsPage = lazy(() =>
  import('./pages/ManagementPages.js').then((module) => ({ default: module.LabelsPage })),
);
const ClassifyTriagePage = lazy(() =>
  import('./pages/ClassifyTriagePage.js').then((module) => ({
    default: module.ClassifyTriagePage,
  })),
);
const SyncPage = lazy(() =>
  import('./pages/SyncPage.js').then((module) => ({ default: module.SyncPage })),
);
const TransactionPermalinkPage = lazy(() =>
  import('./pages/TransactionPermalinkPage.js').then((module) => ({
    default: module.TransactionPermalinkPage,
  })),
);
const ReportsPage = lazy(() =>
  import('./pages/ReportsPage.js').then((module) => ({ default: module.ReportsPage })),
);

const TABS = [
  { id: 'transactions', labelKey: 'tabs.transactions' },
  { id: 'reports', labelKey: 'tabs.reports' },
  { id: 'credit-cards', labelKey: 'tabs.creditCards' },
  { id: 'investments', labelKey: 'tabs.investments' },
  { id: 'loans', labelKey: 'tabs.loans' },
  { id: 'accounts', labelKey: 'tabs.accounts' },
  { id: 'connections', labelKey: 'tabs.connections' },
  { id: 'categories', labelKey: 'tabs.categories' },
  { id: 'labels', labelKey: 'tabs.labels' },
  { id: 'triage', labelKey: 'tabs.triage' },
  { id: 'sync', labelKey: 'tabs.sync' },
] as const satisfies ReadonlyArray<{ readonly id: TabId; readonly labelKey: string }>;

export function App() {
  useReferenceData();

  return (
    <AuthGate>
      <BackgroundJobsProvider>
        <AppShell />
      </BackgroundJobsProvider>
    </AuthGate>
  );
}

function AppShell() {
  const { t } = useTranslation();
  const { tab, setTab, route } = useAppNavigation();

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-primary px-4 py-3 text-primary-foreground">
        <div className="hidden flex-wrap items-center gap-3 sm:flex">
          <h1 className="text-lg font-semibold">{t('app.title')}</h1>
          <DesktopTabNav tab={tab} setTab={setTab} onLogout={invalidateAuth} />
        </div>
        <div className="sm:hidden">
          <MobileTabSelect tab={tab} setTab={setTab} onLogout={invalidateAuth} />
        </div>
      </header>
      <main className="p-4">
        <Suspense fallback={<p className="text-sm text-muted-foreground">…</p>}>
          {route.kind === 'transaction' ? (
            <TransactionPermalinkPage />
          ) : tab ? (
            <AppTabContent tab={tab} />
          ) : null}
        </Suspense>
      </main>
    </div>
  );
}

function AppTabContent({ tab }: { readonly tab: TabId }) {
  switch (tab) {
    case 'transactions':
      return <TransactionsPage />;
    case 'reports':
      return <ReportsPage />;
    case 'credit-cards':
      return <CreditCardsPage />;
    case 'investments':
      return <InvestmentsPage />;
    case 'loans':
      return <LoansPage />;
    case 'connections':
      return <ConnectionsPage />;
    case 'accounts':
      return <AccountsPage />;
    case 'categories':
      return <CategoriesPage />;
    case 'labels':
      return <LabelsPage />;
    case 'triage':
      return <ClassifyTriagePage />;
    case 'sync':
      return <SyncPage />;
    default:
      return null;
  }
}

function DesktopTabNav({
  tab,
  setTab,
  onLogout,
}: {
  readonly tab: TabId | null;
  readonly setTab: (tab: TabId) => void;
  readonly onLogout: () => void;
}) {
  const { t } = useTranslation();

  return (
    <nav className="flex flex-wrap items-center gap-1">
      {TABS.map((item) => (
        <button
          key={item.id}
          type="button"
          className={`rounded px-2 py-1 text-sm ${tab === item.id ? 'bg-white/20 font-semibold' : 'hover:bg-white/10'}`}
          onClick={() => setTab(item.id)}
        >
          {t(item.labelKey)}
        </button>
      ))}
      <AppMenu onLogout={onLogout} />
    </nav>
  );
}

function MobileTabSelect({
  tab,
  setTab,
  onLogout,
}: {
  readonly tab: TabId | null;
  readonly setTab: (tab: TabId) => void;
  readonly onLogout: () => void;
}) {
  const { t } = useTranslation();

  return (
    <div className="flex min-w-0 items-center gap-2">
      <div className="relative min-w-0 flex-1">
        <select
          aria-label={t('app.selectTab')}
          className="w-full min-w-0 appearance-none rounded bg-white/15 py-2 pl-3 pr-9 text-sm font-semibold text-primary-foreground outline-none focus:ring-2 focus:ring-white/30"
          value={tab ?? ''}
          onChange={(event) => setTab(event.target.value as TabId)}
        >
          {tab === null ? (
            <option value="" hidden>
              {t('transactionPermalink.title')}
            </option>
          ) : null}
          {TABS.map((item) => (
            <option key={item.id} value={item.id}>
              {t(item.labelKey)}
            </option>
          ))}
        </select>
        <MdExpandMore
          className="pointer-events-none absolute top-1/2 right-2 size-5 -translate-y-1/2"
          aria-hidden
        />
      </div>
      <AppMenu onLogout={onLogout} />
    </div>
  );
}

function AppMenu({ onLogout }: { readonly onLogout: () => void }) {
  const { t } = useTranslation();

  return (
    <details className="relative">
      <summary
        className="list-none rounded p-1 hover:bg-white/10 [&::-webkit-details-marker]:hidden"
        aria-label={t('app.moreActions')}
        title={t('app.moreActions')}
      >
        <MdMoreVert className="size-5" aria-hidden />
      </summary>
      <div className="absolute top-full right-0 z-20 mt-2 min-w-48 rounded-md border border-border bg-background p-2 text-foreground shadow-lg">
        <label className="flex items-center justify-between gap-3 px-2 py-1 text-sm">
          <span>{t('app.language')}</span>
          <select
            className="rounded border border-border bg-background px-2 py-1 text-sm"
            value={i18n.language}
            aria-label={t('app.language')}
            onChange={(event) => setUiLocale(event.target.value === 'pt-BR' ? 'pt-BR' : 'en-US')}
          >
            <option value="en-US">{t('app.languageEnglish')}</option>
            <option value="pt-BR">{t('app.languagePortuguese')}</option>
          </select>
        </label>
        <button
          type="button"
          className="mt-1 flex w-full items-center rounded px-2 py-1.5 text-left text-sm hover:bg-accent"
          onClick={onLogout}
        >
          {t('auth.logout')}
        </button>
      </div>
    </details>
  );
}
