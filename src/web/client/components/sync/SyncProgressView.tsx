import { useTranslation } from 'react-i18next';
import { MdCheckCircle, MdCloudSync, MdHourglassEmpty, MdSync } from 'react-icons/md';
import { JobErrorBanner } from '../ui/JobErrorBanner.js';
import type { SyncItemCounts, SyncUiEvent } from './sync-progress-events.js';

type SyncProgressViewProps = {
  readonly running: boolean;
  readonly live: SyncUiEvent | null;
  readonly trails: readonly { readonly label: string; readonly counts: SyncItemCounts }[];
  readonly error: string | null;
  readonly done: boolean;
};

const PHASE_LABELS: Record<string, string> = {
  connections: 'Connections',
  'force-sync': 'Force sync',
  'force-upsert': 'Full re-upsert',
  categories: 'Categories',
  accounts: 'Accounts',
  account: 'Account',
  investments: 'Investments',
  loans: 'Loans',
  transactions: 'Transactions',
  'credit-card-bills': 'Credit card bills',
  'investment-transactions': 'Investment transactions',
};

export function SyncProgressView({ running, live, trails, error, done }: SyncProgressViewProps) {
  const { t } = useTranslation();

  return (
    <div className="space-y-3 rounded-lg border border-border bg-muted/30 p-4 font-mono text-sm">
      {running && (
        <div className="flex items-center gap-2 text-cyan-700 dark:text-cyan-400">
          <MdSync className="size-5 animate-spin" />
          <span>{t('sync.running')}</span>
        </div>
      )}

      {live?.type === 'phase' && (
        <LiveLine
          icon={<MdCloudSync className="size-4 text-cyan-600" />}
          text={formatPhaseLine(live)}
        />
      )}

      {live?.type === 'step' && (
        <LiveLine
          icon={<MdHourglassEmpty className="size-4 text-amber-600" />}
          text={formatStepLine(live)}
        />
      )}

      {trails.map((trail) => (
        <div
          key={trail.label}
          className="flex items-start gap-2 text-emerald-700 dark:text-emerald-400"
        >
          <MdCheckCircle className="mt-0.5 size-4 shrink-0" />
          <span>
            <span className="font-semibold">{trail.label}</span>
            <span className="text-muted-foreground"> · {formatCounts(trail.counts)}</span>
          </span>
        </div>
      ))}

      {done && (
        <div className="flex items-center gap-2 font-semibold text-emerald-700 dark:text-emerald-400">
          <MdCheckCircle className="size-5" />
          {t('sync.done')}
        </div>
      )}

      {error && <JobErrorBanner error={error} titleKey="sync.errorTitle" />}
    </div>
  );
}

function LiveLine({ icon, text }: { readonly icon: React.ReactNode; readonly text: string }) {
  return (
    <div className="flex items-center gap-2 rounded bg-background/80 px-2 py-1 text-foreground">
      {icon}
      <span className="truncate">{text}</span>
    </div>
  );
}

function formatPhaseLine(event: Extract<SyncUiEvent, { type: 'phase' }>): string {
  const label = PHASE_LABELS[event.phase] ?? event.phase;
  return event.detail ? `${label} · ${event.detail}` : label;
}

function formatStepLine(event: Extract<SyncUiEvent, { type: 'step' }>): string {
  const parts: string[] = [];
  if (event.total !== undefined && event.total > 0) {
    const pct = Math.min(100, Math.round((event.current / event.total) * 100));
    parts.push(`${event.current}/${event.total} (${pct}%)`);
  } else {
    parts.push(String(event.current));
  }
  if (event.detail) {
    parts.push(event.detail);
  }
  return parts.join(' · ');
}

function formatCounts(counts: SyncItemCounts): string {
  const parts: string[] = [];
  if (counts.connections !== undefined) {
    parts.push(`${counts.connections} connections`);
  }
  if (counts.accounts !== undefined) {
    parts.push(`${counts.accounts} accounts`);
  }
  if (counts.transactions !== undefined) {
    parts.push(`${counts.transactions} transactions`);
  }
  if (counts.categories !== undefined) {
    parts.push(`${counts.categories} categories`);
  }
  if (counts.investments !== undefined) {
    parts.push(`${counts.investments} investments`);
  }
  if (counts.loans !== undefined) {
    parts.push(`${counts.loans} loans`);
  }
  if (counts.creditCardBills !== undefined) {
    parts.push(`${counts.creditCardBills} credit card bills`);
  }
  if (counts.investmentTransactions !== undefined) {
    parts.push(`${counts.investmentTransactions} investment transactions`);
  }
  return parts.length > 0 ? parts.join(', ') : '0 items';
}
