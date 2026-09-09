import { type RefObject, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { MdChevronLeft } from 'react-icons/md';
import { formatDateTimeLocalRange } from '../../lib/datetime-local.js';
import {
  buildAccountFilterItems,
  buildCategoryFilterItems,
  buildLabelFilterItems,
} from '../../lib/filter-multi-select-items.js';
import {
  resolveBrowserTimeZone,
  resolveTransactionDateNavigationSpec,
  resolveTransactionDateNavigationTooltipKey,
  shiftTransactionDateFiltersBack,
} from '../../lib/transaction-date-navigation.js';
import {
  DEFAULT_TRANSACTION_DATE_PRESET,
  isCustomDateActive,
  parseCsvFilterValue,
  resolveTransactionDateSelectValue,
  TRANSACTION_DATE_ALL,
} from '../../lib/transaction-filters.js';
import { FilterMultiSelectField } from '../filters/FilterMultiSelectField.js';
import type { LabelRecord } from '../labels/LabelEditDialog.js';
import { ActionIconButton } from '../ui/EditIconButton.js';
import { SidebarSection } from '../ui/SidebarSection.js';
import { CreditCardBillFilterField } from './CreditCardBillFilterField.js';
import { CustomDateRangeDialog } from './CustomDateRangeDialog.js';

type TransactionFiltersPanelProps = {
  readonly filters: Record<string, string | string[]>;
  readonly accounts: readonly Record<string, unknown>[];
  readonly bills: readonly Record<string, unknown>[];
  readonly showCreditCardFilters: boolean;
  readonly categoryById: Record<string, Record<string, unknown>>;
  readonly labelById: Record<string, LabelRecord>;
  readonly onChange: (key: string, value: string) => void;
  readonly onFiltersChange: (patch: Record<string, string | undefined>) => void;
  readonly searchInputRef?: RefObject<HTMLInputElement | null>;
};

export function TransactionFiltersPanel({
  filters,
  accounts,
  bills,
  showCreditCardFilters,
  categoryById,
  labelById,
  onChange,
  onFiltersChange,
  searchInputRef,
}: TransactionFiltersPanelProps) {
  const { t, i18n } = useTranslation();
  const [rangeDialogOpen, setRangeDialogOpen] = useState(false);
  const [pendingCustomSelect, setPendingCustomSelect] = useState(false);

  const customActive = isCustomDateActive(filters);
  const dateShortcut = resolveTransactionDateSelectValue(filters, pendingCustomSelect);
  const timeZone = useMemo(() => resolveBrowserTimeZone(), []);
  const dateNavigationSpec = useMemo(
    () => resolveTransactionDateNavigationSpec(filters, timeZone),
    [filters, timeZone],
  );
  const dateNavTooltipKey = dateNavigationSpec
    ? resolveTransactionDateNavigationTooltipKey(dateNavigationSpec)
    : null;

  const selectedAccountIds = parseCsvFilterValue(filters['a']);
  const selectedLabelIds = parseCsvFilterValue(filters['label-id']);
  const selectedCategoryIds = parseCsvFilterValue(filters['category-id']).filter(
    (id) => !id.startsWith('only:'),
  );
  const accountFilterItems = useMemo(() => buildAccountFilterItems(accounts), [accounts]);
  const labelFilterItems = useMemo(() => buildLabelFilterItems(labelById), [labelById]);
  const categoryFilterItems = useMemo(() => buildCategoryFilterItems(categoryById), [categoryById]);

  const openRangeDialog = (): void => {
    setRangeDialogOpen(true);
  };

  const closeRangeDialog = (): void => {
    setRangeDialogOpen(false);
    setPendingCustomSelect(false);
  };

  const applyCustomRange = (start: string, end: string): void => {
    onFiltersChange({
      d: 'custom',
      'start-date': start,
      'end-date': end,
    });
    closeRangeDialog();
  };

  const fieldClass = 'flex flex-col gap-1 text-xs';

  return (
    <>
      <SidebarSection title={t('filters.sectionScope')} defaultOpen>
        <div className="space-y-2">
          <FilterMultiSelectField
            label={t('columns.account')}
            dialogTitle={t('columns.account')}
            emptyLabel={t('filters.allAccounts')}
            searchPlaceholder={t('filters.searchAccounts')}
            value={selectedAccountIds}
            items={accountFilterItems}
            onChange={(value) =>
              onFiltersChange({
                a: value.length > 0 ? value.join(',') : undefined,
              })
            }
          />
          {showCreditCardFilters ? (
            <CreditCardBillFilterField
              fieldClass={fieldClass}
              filters={filters}
              accounts={accounts}
              bills={bills}
              selectedAccountIds={selectedAccountIds}
              onFiltersChange={onFiltersChange}
            />
          ) : null}
          <div className={fieldClass}>
            <span className="font-medium text-muted-foreground">{t('columns.date')}</span>
            <div className="flex flex-wrap items-center gap-1">
              {dateNavigationSpec && dateNavTooltipKey && (
                <ActionIconButton
                  label={t(dateNavTooltipKey)}
                  onClick={() => {
                    const patch = shiftTransactionDateFiltersBack(filters, timeZone);
                    if (patch) {
                      onFiltersChange(patch);
                    }
                  }}
                >
                  <MdChevronLeft className="size-4" />
                </ActionIconButton>
              )}
              <select
                className="min-w-0 flex-1 rounded border border-input bg-background px-2 py-1 text-sm"
                aria-label={t('columns.date')}
                value={dateShortcut}
                onChange={(e) => {
                  const value = e.target.value;
                  if (value === 'custom') {
                    setPendingCustomSelect(true);
                    openRangeDialog();
                    return;
                  }
                  setPendingCustomSelect(false);
                  if (value === TRANSACTION_DATE_ALL) {
                    onFiltersChange({
                      d: TRANSACTION_DATE_ALL,
                      'start-date': undefined,
                      'end-date': undefined,
                    });
                    return;
                  }
                  onFiltersChange({
                    d: value || DEFAULT_TRANSACTION_DATE_PRESET,
                    'start-date': undefined,
                    'end-date': undefined,
                  });
                }}
              >
                <option value={TRANSACTION_DATE_ALL}>{t('filters.allDates')}</option>
                <option value="today">{t('filters.today')}</option>
                <option value="this-week">{t('filters.thisWeek')}</option>
                <option value="past-week">{t('filters.pastWeek')}</option>
                <option value={DEFAULT_TRANSACTION_DATE_PRESET}>{t('filters.thisMonth')}</option>
                <option value="past-month">{t('filters.pastMonth')}</option>
                <option value="ytd">{t('filters.ytd')}</option>
                <option value="last-12-months">{t('filters.last12Months')}</option>
                <option value="custom">{t('filters.customRange')}</option>
              </select>
            </div>
            {customActive && (
              <button
                type="button"
                className="mt-1 max-w-full truncate rounded border border-input bg-background px-2 py-1 text-left text-sm hover:bg-accent"
                title={t('dateRange.edit')}
                onClick={openRangeDialog}
              >
                {formatDateTimeLocalRange(
                  String(filters['start-date']),
                  String(filters['end-date']),
                  i18n.language,
                )}
              </button>
            )}
          </div>
        </div>
      </SidebarSection>

      <SidebarSection title={t('filters.sectionSearch')} defaultOpen>
        <div className="space-y-2">
          <label className={fieldClass}>
            <span className="font-medium text-muted-foreground">{t('columns.merchant')}</span>
            <input
              className="rounded border border-input bg-background px-2 py-1 text-sm"
              placeholder={t('filters.merchantPlaceholder')}
              value={String(filters['merchant'] ?? '')}
              onChange={(e) => onChange('merchant', e.target.value)}
            />
          </label>
          <label className={fieldClass}>
            <span className="font-medium text-muted-foreground">{t('columns.description')}</span>
            <input
              className="rounded border border-input bg-background px-2 py-1 text-sm"
              placeholder={t('filters.descriptionPlaceholder')}
              value={String(filters['description'] ?? '')}
              onChange={(e) => onChange('description', e.target.value)}
            />
          </label>
          <label className={fieldClass}>
            <span className="font-medium text-muted-foreground">{t('filters.search')}</span>
            <input
              ref={searchInputRef}
              className="rounded border border-input bg-background px-2 py-1 text-sm"
              placeholder={t('filters.search')}
              value={String(filters['q'] ?? '')}
              onChange={(e) => onChange('q', e.target.value)}
            />
          </label>
        </div>
      </SidebarSection>

      <SidebarSection title={t('filters.sectionClassification')} defaultOpen>
        <div className="space-y-2">
          <FilterMultiSelectField
            label={t('columns.category')}
            dialogTitle={t('columns.category')}
            emptyLabel={t('filters.allCategories')}
            searchPlaceholder={t('filters.searchCategories')}
            value={selectedCategoryIds}
            items={categoryFilterItems}
            cascadeChildrenOnSelect
            onChange={(value) =>
              onFiltersChange({
                'category-id': value.length > 0 ? value.join(',') : undefined,
              })
            }
          />
          <FilterMultiSelectField
            label={t('columns.labels')}
            dialogTitle={t('columns.labels')}
            emptyLabel={t('filters.allLabels')}
            searchPlaceholder={t('filters.searchLabels')}
            value={selectedLabelIds}
            items={labelFilterItems}
            cascadeChildrenOnSelect
            onChange={(value) =>
              onFiltersChange({ 'label-id': value.length > 0 ? value.join(',') : undefined })
            }
          />
          <label className={fieldClass}>
            <span className="font-medium text-muted-foreground">{t('filters.classification')}</span>
            <select
              className="rounded border border-input bg-background px-2 py-1 text-sm"
              value={String(filters['classification'] ?? '')}
              onChange={(e) => onChange('classification', e.target.value)}
            >
              <option value="">{t('filters.classificationAll')}</option>
              <option value="classified">{t('filters.classificationClassifiedOnly')}</option>
              <option value="unclassified">{t('filters.classificationUnclassifiedOnly')}</option>
            </select>
          </label>
        </div>
      </SidebarSection>

      <SidebarSection title={t('filters.sectionAdvanced')}>
        <div className="space-y-2">
          <label className={fieldClass}>
            <span className="font-medium text-muted-foreground">{t('filters.transfers')}</span>
            <select
              className="rounded border border-input bg-background px-2 py-1 text-sm"
              value={String(filters['transfers'] ?? '')}
              onChange={(e) => onChange('transfers', e.target.value)}
            >
              <option value="">{t('filters.transfersAll')}</option>
              <option value="hide">{t('filters.transfersHide')}</option>
              <option value="only">{t('filters.transfersOnly')}</option>
            </select>
          </label>
          <label className={fieldClass}>
            <span className="font-medium text-muted-foreground">{t('filters.installments')}</span>
            <select
              className="rounded border border-input bg-background px-2 py-1 text-sm"
              value={String(filters['installments'] ?? '')}
              onChange={(e) => onChange('installments', e.target.value)}
            >
              <option value="">{t('filters.installmentsAll')}</option>
              <option value="hide">{t('filters.installmentsHide')}</option>
              <option value="only">{t('filters.installmentsOnly')}</option>
            </select>
          </label>
        </div>
      </SidebarSection>

      {rangeDialogOpen && (
        <CustomDateRangeDialog
          open
          initialStart={String(filters['start-date'] ?? '')}
          initialEnd={String(filters['end-date'] ?? '')}
          onClose={closeRangeDialog}
          onApply={applyCustomRange}
        />
      )}
    </>
  );
}
