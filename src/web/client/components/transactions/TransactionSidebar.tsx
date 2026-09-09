import type { RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import { MdChevronRight } from 'react-icons/md';
import { resolveColumnBadgeDisplay } from '../../lib/column-badge-display.js';
import { isCreditCardFilterContext } from '../../lib/credit-card-filter-context.js';
import type { buildTransactionFilterSummary } from '../../lib/transaction-filters.js';
import { parseCsvFilterValue } from '../../lib/transaction-filters.js';
import {
  resolveTransactionGroupByLabelKey,
  TRANSACTION_GROUP_BY_FIELDS,
  type TransactionGroupByField,
} from '../../lib/transaction-row-grouping.js';
import type { LabelRecord } from '../labels/LabelEditDialog.js';
import { CollapsibleSidebar } from '../ui/CollapsibleSidebar.js';
import { SidebarSection } from '../ui/SidebarSection.js';
import { TransactionFiltersPanel } from './TransactionFiltersBar.js';
import { MemoTransactionSidebarFilterSummary } from './TransactionSidebarFilterSummary.js';

const TRANSACTION_COLUMN_KEYS = [
  'date',
  'account',
  'merchant',
  'description',
  'category',
  'labels',
  'installments',
  'amount',
  'transfer',
] as const;

type TransactionColumnKey = (typeof TRANSACTION_COLUMN_KEYS)[number] | 'select';

type FilterSummaryPart = ReturnType<typeof buildTransactionFilterSummary>[number];

type TransactionSidebarProps = {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly filters: Record<string, string | string[]>;
  readonly accounts: readonly Record<string, unknown>[];
  readonly bills: readonly Record<string, unknown>[];
  readonly displayDate?: 'credit-purchase' | undefined;
  readonly groupBy: readonly TransactionGroupByField[];
  readonly onGroupByChange: (field: TransactionGroupByField, checked: boolean) => void;
  readonly categoryById: Record<string, Record<string, unknown>>;
  readonly labelById: Record<string, LabelRecord>;
  readonly onChange: (key: string, value: string) => void;
  readonly onFiltersChange: (patch: Record<string, string | undefined>) => void;
  readonly searchInputRef?: RefObject<HTMLInputElement | null>;
  readonly visibleColumns: ReadonlySet<TransactionColumnKey>;
  readonly onToggleColumn: (key: TransactionColumnKey, checked: boolean) => void;
  readonly categoryColumnDisplay: ReturnType<typeof resolveColumnBadgeDisplay>;
  readonly labelsColumnDisplay: ReturnType<typeof resolveColumnBadgeDisplay>;
  readonly onColumnDisplayChange: (
    patch: Partial<{
      category: ReturnType<typeof resolveColumnBadgeDisplay>;
      labels: ReturnType<typeof resolveColumnBadgeDisplay>;
      date: 'credit-purchase' | undefined;
    }>,
  ) => void;
  readonly matchingTotal: number;
  readonly isLoading: boolean;
  readonly detectPending: boolean;
  readonly exportPending: boolean;
  readonly onDetectTransfers: () => void;
  readonly onExportJson: () => void;
  readonly onExportCsv: () => void;
};

export function TransactionSidebar({
  open,
  onOpenChange,
  filters,
  accounts,
  bills,
  displayDate,
  groupBy,
  onGroupByChange,
  categoryById,
  labelById,
  onChange,
  onFiltersChange,
  searchInputRef,
  visibleColumns,
  onToggleColumn,
  categoryColumnDisplay,
  labelsColumnDisplay,
  onColumnDisplayChange,
  matchingTotal,
  isLoading,
  detectPending,
  exportPending,
  onDetectTransfers,
  onExportJson,
  onExportCsv,
}: TransactionSidebarProps) {
  const { t } = useTranslation();
  const selectedAccountIds = parseCsvFilterValue(filters['a']);
  const showCreditCardFilters = isCreditCardFilterContext(accounts, selectedAccountIds);

  return (
    <CollapsibleSidebar
      open={open}
      onOpenChange={onOpenChange}
      title={t('sidebar.transactionsPanel')}
      closeLabel={t('sidebar.closePanel')}
    >
      <div className="space-y-3">
        <TransactionFiltersPanel
          filters={filters}
          accounts={accounts}
          bills={bills}
          showCreditCardFilters={showCreditCardFilters}
          categoryById={categoryById}
          labelById={labelById}
          onChange={onChange}
          onFiltersChange={onFiltersChange}
          searchInputRef={searchInputRef}
        />

        <SidebarSection title={t('filters.groupRows')} defaultOpen={false}>
          <div className="space-y-2">
            {TRANSACTION_GROUP_BY_FIELDS.map((field) => (
              <label key={field} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={groupBy.includes(field)}
                  onChange={(e) => onGroupByChange(field, e.target.checked)}
                />
                {t(resolveTransactionGroupByLabelKey(field))}
              </label>
            ))}
          </div>
        </SidebarSection>

        <SidebarSection title={t('filters.columns')} defaultOpen={false}>
          <div className="space-y-3">
            {TRANSACTION_COLUMN_KEYS.map((key) => (
              <div key={key} className="space-y-1">
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={visibleColumns.has(key)}
                    onChange={(e) => onToggleColumn(key, e.target.checked)}
                  />
                  {t(`columns.${key === 'transfer' ? 'transfer' : key}`)}
                </label>
                {key === 'category' && visibleColumns.has('category') && (
                  <label className="ml-6 flex flex-col gap-1 text-xs">
                    <span className="font-medium text-muted-foreground">
                      {t('display.categoryColumn')}
                    </span>
                    <select
                      className="rounded border border-input bg-background px-2 py-1 text-sm"
                      value={categoryColumnDisplay}
                      onChange={(e) =>
                        onColumnDisplayChange({
                          category: resolveColumnBadgeDisplay(e.target.value),
                        })
                      }
                    >
                      <option value="icon">{t('display.iconOnly')}</option>
                      <option value="short">{t('display.iconNameShort')}</option>
                      <option value="full">{t('display.iconNameFull')}</option>
                    </select>
                  </label>
                )}
                {key === 'date' && visibleColumns.has('date') && showCreditCardFilters && (
                  <label className="ml-6 flex items-center gap-2 text-xs">
                    <input
                      type="checkbox"
                      checked={displayDate === 'credit-purchase'}
                      onChange={(e) =>
                        onColumnDisplayChange({
                          date: e.target.checked ? 'credit-purchase' : undefined,
                        })
                      }
                    />
                    <span>{t('filters.usePurchaseDate')}</span>
                  </label>
                )}
                {key === 'labels' && visibleColumns.has('labels') && (
                  <label className="ml-6 flex flex-col gap-1 text-xs">
                    <span className="font-medium text-muted-foreground">
                      {t('display.labelsColumn')}
                    </span>
                    <select
                      className="rounded border border-input bg-background px-2 py-1 text-sm"
                      value={labelsColumnDisplay}
                      onChange={(e) =>
                        onColumnDisplayChange({
                          labels: resolveColumnBadgeDisplay(e.target.value),
                        })
                      }
                    >
                      <option value="icon">{t('display.iconOnly')}</option>
                      <option value="short">{t('display.iconNameShort')}</option>
                      <option value="full">{t('display.iconNameFull')}</option>
                    </select>
                  </label>
                )}
              </div>
            ))}
          </div>
        </SidebarSection>

        <SidebarSection title={t('sidebar.moreActions')} defaultOpen={false}>
          <div className="flex flex-col gap-2">
            <button
              type="button"
              className="rounded border border-border bg-background px-3 py-1.5 text-left text-sm disabled:opacity-50"
              disabled={matchingTotal === 0 || isLoading || detectPending}
              onClick={onDetectTransfers}
            >
              {detectPending ? t('detectTransfers.scanning') : t('actions.detectTransfers')}
            </button>
            <button
              type="button"
              className="rounded border border-border bg-background px-3 py-1.5 text-left text-sm disabled:opacity-50"
              disabled={matchingTotal === 0 || isLoading || exportPending}
              onClick={onExportJson}
            >
              {t('actions.exportJson')}
            </button>
            <button
              type="button"
              className="rounded border border-border bg-background px-3 py-1.5 text-left text-sm disabled:opacity-50"
              disabled={matchingTotal === 0 || isLoading || exportPending}
              onClick={onExportCsv}
            >
              {t('actions.exportCsv')}
            </button>
          </div>
        </SidebarSection>
      </div>
    </CollapsibleSidebar>
  );
}

export function TransactionSidebarToggle({
  open,
  onOpenChange,
  filterSummaryParts,
  labelById,
  categoryById,
  accounts,
  onClearFilterPart,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly filterSummaryParts: readonly FilterSummaryPart[];
  readonly labelById: Record<string, LabelRecord>;
  readonly categoryById: Record<string, Record<string, unknown>>;
  readonly accounts: readonly Record<string, unknown>[];
  readonly onClearFilterPart: (partId: string) => void;
}) {
  const { t } = useTranslation();

  if (open) {
    return null;
  }

  return (
    <div className="inline-flex max-w-full items-center gap-1 rounded border border-border bg-background px-3 py-1 text-sm">
      <button
        type="button"
        className="inline-flex shrink-0 items-center gap-1 hover:text-foreground"
        onClick={() => onOpenChange(true)}
      >
        <MdChevronRight className="size-4 shrink-0 rotate-180" aria-hidden />
        <span className="font-medium">{t('sidebar.transactionsPanel')}</span>
      </button>
      <MemoTransactionSidebarFilterSummary
        filterSummaryParts={filterSummaryParts}
        labelById={labelById}
        categoryById={categoryById}
        accounts={accounts}
        onClearFilterPart={onClearFilterPart}
      />
    </div>
  );
}
