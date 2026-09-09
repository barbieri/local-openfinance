import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { FilterMultiSelectItem } from '../../lib/filter-multi-select-items.js';
import { FilterMultiSelectField } from '../filters/FilterMultiSelectField.js';

type CreditCardBillFilterFieldProps = {
  readonly fieldClass: string;
  readonly filters: Record<string, string | string[]>;
  readonly accounts: readonly Record<string, unknown>[];
  readonly bills: readonly Record<string, unknown>[];
  readonly selectedAccountIds: readonly string[];
  readonly onFiltersChange: (patch: Record<string, string | undefined>) => void;
};

export function CreditCardBillFilterField({
  fieldClass,
  filters,
  accounts,
  bills,
  selectedAccountIds,
  onFiltersChange,
}: CreditCardBillFilterFieldProps) {
  const { t } = useTranslation();

  const accountNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const account of accounts) {
      map.set(
        String(account['id']),
        String(account['display_name'] ?? account['name'] ?? account['id']),
      );
    }
    return map;
  }, [accounts]);

  const billItems = useMemo<readonly FilterMultiSelectItem[]>(() => {
    const selected = selectedAccountIds.length > 0 ? new Set(selectedAccountIds) : null;
    const scoped = selected
      ? bills.filter((bill) => selected.has(String(bill['account_id'])))
      : bills;
    return scoped
      .toSorted((a, b) => String(b['due_date'] ?? '').localeCompare(String(a['due_date'] ?? '')))
      .map((bill) => {
        const accountName =
          accountNameById.get(String(bill['account_id'])) ?? String(bill['account_id']);
        const dueDate = String(bill['due_date'] ?? '').slice(0, 10);
        return {
          id: String(bill['id']),
          parentId: null,
          path: dueDate ? `${accountName} · ${dueDate}` : accountName,
          name: dueDate ? `${accountName} · ${dueDate}` : accountName,
          icon: 'MdCreditCard',
          color: '#2563eb',
        };
      });
  }, [accountNameById, bills, selectedAccountIds]);

  return (
    <div className={fieldClass}>
      <FilterMultiSelectField
        label={t('filters.creditCardBill')}
        dialogTitle={t('filters.creditCardBill')}
        emptyLabel={t('filters.allBills')}
        searchPlaceholder={t('filters.searchBills')}
        value={filters['bill-id'] ? [String(filters['bill-id'])] : []}
        items={billItems}
        singleSelection
        onChange={(value) => onFiltersChange({ 'bill-id': value[0] })}
      />
    </div>
  );
}
