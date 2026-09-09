import type { TFunction } from 'i18next';
import { resolveCreditCardBillFilterLabel } from './credit-card-filter-context.js';
import { dateTimeLocalToIso, formatDateTimeLocalRange } from './datetime-local.js';
import type { TableUrlState } from './table-url-state.js';

export const DEFAULT_TRANSACTION_DATE_PRESET = 'this-month';
export const TRANSACTION_DATE_ALL = 'all';
export const DEFAULT_TRANSACTION_PAGE_SIZE = 50;
export const TRANSACTION_EXPORT_PAGE_SIZE = 200;

function trimNonEmptyParts(parts: readonly string[]): string[] {
  const trimmed: string[] = [];
  for (const part of parts) {
    const value = part.trim();
    if (value.length > 0) {
      trimmed.push(value);
    }
  }
  return trimmed;
}

export function parseCsvFilterValue(value: string | string[] | undefined): readonly string[] {
  if (Array.isArray(value)) {
    return trimNonEmptyParts(value);
  }
  if (!value) {
    return [];
  }
  return trimNonEmptyParts(String(value).split(','));
}

export function isCustomDateActive(filters: Record<string, string | string[]>): boolean {
  const hasRange = Boolean(filters['start-date']) && Boolean(filters['end-date']);
  return hasRange && (filters['d'] === 'custom' || !filters['d']);
}

export function resolveEffectiveTransactionFilters(
  filters: Record<string, string | string[]>,
): Record<string, string | string[]> {
  let effective: Record<string, string | string[]> = { ...filters };
  if (effective['unclassified'] === '1' && !effective['classification']) {
    const { unclassified: _removed, ...rest } = effective;
    effective = { ...rest, classification: 'unclassified' };
  }

  if (isCustomDateActive(effective)) {
    return effective;
  }
  if (effective['d'] === TRANSACTION_DATE_ALL) {
    return effective;
  }
  if (effective['d']) {
    return effective;
  }
  return { ...effective, d: DEFAULT_TRANSACTION_DATE_PRESET };
}

export function resolveTransactionDateSelectValue(
  filters: Record<string, string | string[]>,
  pendingCustomSelect: boolean,
): string {
  if (isCustomDateActive(filters) || pendingCustomSelect) {
    return 'custom';
  }
  if (filters['d'] === TRANSACTION_DATE_ALL) {
    return TRANSACTION_DATE_ALL;
  }
  return String(filters['d'] ?? DEFAULT_TRANSACTION_DATE_PRESET);
}

function resolveDatePresetLabel(d: string, t: TFunction): string {
  switch (d) {
    case 'today':
      return t('filters.today');
    case 'this-week':
      return t('filters.thisWeek');
    case 'past-week':
      return t('filters.pastWeek');
    case 'this-month':
      return t('filters.thisMonth');
    case 'past-month':
      return t('filters.pastMonth');
    case 'ytd':
      return t('filters.ytd');
    case 'last-12-months':
      return t('filters.last12Months');
    default:
      return d;
  }
}

export type TransactionFilterSummaryContext = {
  readonly accounts: readonly Record<string, unknown>[];
  readonly bills: readonly Record<string, unknown>[];
  readonly categoryById: Readonly<Record<string, Record<string, unknown>>>;
  readonly labelById: Readonly<Record<string, { readonly path: string }>>;
  readonly locale: string;
  readonly t: TFunction;
};

export type TransactionFilterSummaryPart = {
  readonly id: string;
  readonly label: string;
  readonly value?: string;
  readonly labelIds?: readonly string[];
  readonly categoryIds?: readonly string[];
  readonly accountIds?: readonly string[];
};

function filterPart(id: string, label: string, value?: string): TransactionFilterSummaryPart {
  return value ? { id, label, value } : { id, label };
}

export function buildTransactionFilterSummary(
  filters: Record<string, string | string[]>,
  context: TransactionFilterSummaryContext,
  options: {
    readonly displayDate?: 'credit-purchase' | undefined;
  } = {},
): readonly TransactionFilterSummaryPart[] {
  return [
    summarizeAccountFilter(filters, context),
    summarizeBillFilter(filters, context),
    summarizeDateFilter(filters, context),
    summarizeDisplayDateFilter(options.displayDate, context),
    summarizeCategoryFilter(filters, context),
    summarizeTextFilter(filters, context, 'merchant', 'columns.merchant'),
    summarizeTextFilter(filters, context, 'description', 'columns.description'),
    summarizeLabelFilter(filters, context),
    summarizeTextFilter(filters, context, 'q', 'filters.search'),
    summarizeTransfersFilter(filters, context),
    summarizeInstallmentsFilter(filters, context),
    summarizeClassificationFilter(filters, context),
  ].filter((part): part is TransactionFilterSummaryPart => part !== null);
}

export function clearTransactionFilterPart(partId: string): Record<string, string | undefined> {
  switch (partId) {
    case 'account':
      return { a: undefined };
    case 'date-custom':
      return {
        d: DEFAULT_TRANSACTION_DATE_PRESET,
        'start-date': undefined,
        'end-date': undefined,
      };
    case 'date':
      return { d: undefined };
    case 'category-id':
      return { 'category-id': undefined };
    case 'label-id':
      return { 'label-id': undefined };
    case 'merchant':
      return { merchant: undefined };
    case 'description':
      return { description: undefined };
    case 'q':
      return { q: undefined };
    case 'transfers':
      return { transfers: undefined };
    case 'installments':
      return { installments: undefined };
    case 'classification':
      return { classification: undefined };
    case 'bill-id':
      return { 'bill-id': undefined };
    default:
      return { [partId]: undefined };
  }
}

function summarizeAccountFilter(
  filters: Record<string, string | string[]>,
  context: TransactionFilterSummaryContext,
): TransactionFilterSummaryPart | null {
  const ids = parseCsvFilterValue(filters['a']);
  if (ids.length === 0) {
    return null;
  }
  return {
    id: 'account',
    label: context.t('columns.account'),
    accountIds: ids,
  };
}

function summarizeBillFilter(
  filters: Record<string, string | string[]>,
  context: TransactionFilterSummaryContext,
): TransactionFilterSummaryPart | null {
  const billId = String(filters['bill-id'] ?? '').trim();
  if (!billId) {
    return null;
  }
  const label =
    resolveCreditCardBillFilterLabel({
      accounts: context.accounts,
      bills: context.bills,
      billId,
    }) ?? billId;
  return filterPart('bill-id', context.t('filters.creditCardBill'), label);
}

function summarizeDisplayDateFilter(
  displayDate: 'credit-purchase' | undefined,
  context: TransactionFilterSummaryContext,
): TransactionFilterSummaryPart | null {
  if (displayDate !== 'credit-purchase') {
    return null;
  }
  return filterPart(
    'display-date',
    context.t('columns.date'),
    context.t('filters.usePurchaseDate'),
  );
}

function summarizeDateFilter(
  filters: Record<string, string | string[]>,
  context: TransactionFilterSummaryContext,
): TransactionFilterSummaryPart | null {
  if (isCustomDateActive(filters)) {
    return filterPart(
      'date-custom',
      context.t('filters.customRange'),
      formatDateTimeLocalRange(
        String(filters['start-date']),
        String(filters['end-date']),
        context.locale,
      ),
    );
  }

  const effective = resolveEffectiveTransactionFilters(filters);
  if (!effective['d'] || effective['d'] === TRANSACTION_DATE_ALL) {
    return null;
  }

  return filterPart(
    'date',
    context.t('columns.date'),
    resolveDatePresetLabel(String(effective['d']), context.t),
  );
}

function summarizeCategoryFilter(
  filters: Record<string, string | string[]>,
  context: TransactionFilterSummaryContext,
): TransactionFilterSummaryPart | null {
  const ids = parseCsvFilterValue(filters['category-id']).filter((id) => !id.startsWith('only:'));
  if (ids.length === 0) {
    return null;
  }
  return {
    id: 'category-id',
    label: context.t('columns.category'),
    categoryIds: ids,
  };
}

function summarizeLabelFilter(
  filters: Record<string, string | string[]>,
  context: TransactionFilterSummaryContext,
): TransactionFilterSummaryPart | null {
  const ids = parseCsvFilterValue(filters['label-id']);
  if (ids.length === 0) {
    return null;
  }
  return {
    id: 'label-id',
    label: context.t('columns.labels'),
    labelIds: ids,
  };
}

function summarizeTextFilter(
  filters: Record<string, string | string[]>,
  context: TransactionFilterSummaryContext,
  key: string,
  labelKey: string,
  formatValue?: (value: string) => string,
): TransactionFilterSummaryPart | null {
  const value = String(filters[key] ?? '').trim();
  if (!value) {
    return null;
  }
  const formatted = formatValue ? formatValue(value) : value;
  return filterPart(key, context.t(labelKey), formatted);
}

function summarizeTransfersFilter(
  filters: Record<string, string | string[]>,
  context: TransactionFilterSummaryContext,
): TransactionFilterSummaryPart | null {
  const transfers = String(filters['transfers'] ?? '');
  if (transfers === 'hide') {
    return filterPart(
      'transfers',
      context.t('filters.transfers'),
      context.t('filters.transfersHide'),
    );
  }
  if (transfers === 'only') {
    return filterPart(
      'transfers',
      context.t('filters.transfers'),
      context.t('filters.transfersOnly'),
    );
  }
  return null;
}

function summarizeInstallmentsFilter(
  filters: Record<string, string | string[]>,
  context: TransactionFilterSummaryContext,
): TransactionFilterSummaryPart | null {
  const installments = String(filters['installments'] ?? '');
  if (installments === 'hide') {
    return filterPart(
      'installments',
      context.t('filters.installments'),
      context.t('filters.installmentsHide'),
    );
  }
  if (installments === 'only') {
    return filterPart(
      'installments',
      context.t('filters.installments'),
      context.t('filters.installmentsOnly'),
    );
  }
  return null;
}

function summarizeClassificationFilter(
  filters: Record<string, string | string[]>,
  context: TransactionFilterSummaryContext,
): TransactionFilterSummaryPart | null {
  const classification = String(filters['classification'] ?? '');
  if (classification === 'classified') {
    return filterPart(
      'classification',
      context.t('filters.classification'),
      context.t('filters.classificationClassifiedOnly'),
    );
  }
  if (classification === 'unclassified') {
    return filterPart(
      'classification',
      context.t('filters.classification'),
      context.t('filters.classificationUnclassifiedOnly'),
    );
  }
  return null;
}

export function hasNonBalanceScopeFilters(filters: Record<string, string | string[]>): boolean {
  const scopeKeys = new Set(['a', 'd', 'start-date', 'end-date']);
  return Object.entries(filters).some(([key, value]) => {
    if (scopeKeys.has(key)) {
      return false;
    }
    if (Array.isArray(value)) {
      return value.length > 0;
    }
    return value != null && String(value).trim().length > 0;
  });
}

export function buildTransactionListQuery(state: TableUrlState): string {
  const params = new URLSearchParams();
  appendTransactionDateParams(params, resolveEffectiveTransactionFilters(state.f));
  appendTransactionFilterParams(params, state.f);
  if (state.display?.date === 'credit-purchase') {
    params.set('display-date', 'credit-purchase');
  }
  appendTransactionPaginationParams(params, state);
  appendTransactionSortParams(params, state.o);
  return params.toString();
}

export function buildTransactionChartQuery(state: TableUrlState): string {
  const params = new URLSearchParams();
  appendTransactionDateParams(params, resolveEffectiveTransactionFilters(state.f));
  appendTransactionFilterParams(params, state.f);
  if (state.display?.date === 'credit-purchase') {
    params.set('display-date', 'credit-purchase');
  }
  return params.toString();
}

export function buildTransactionScopedQuery(state: TableUrlState): string {
  const params = new URLSearchParams(buildTransactionChartQuery(state));
  appendTransactionSortParams(params, state.o);
  return params.toString();
}

function appendTransactionDateParams(
  params: URLSearchParams,
  effective: Record<string, string | string[]>,
): void {
  if (
    effective['d'] === 'custom' ||
    (effective['start-date'] && effective['end-date'] && effective['d'] !== TRANSACTION_DATE_ALL)
  ) {
    if (effective['start-date']) {
      params.set('start-date', dateTimeLocalToIso(String(effective['start-date'])));
    }
    if (effective['end-date']) {
      params.set('end-date', dateTimeLocalToIso(String(effective['end-date'])));
    }
    return;
  }
  if (effective['d'] && effective['d'] !== TRANSACTION_DATE_ALL) {
    params.set('date', String(effective['d']));
  }
}

function appendTransactionFilterParams(
  params: URLSearchParams,
  filters: Record<string, string | string[]>,
): void {
  const entries: readonly (readonly [string, string])[] = [
    ['q', 'q'],
    ['a', 'account'],
    ['category-id', 'category-id'],
    ['label-id', 'label-id'],
    ['merchant', 'merchant'],
    ['description', 'description'],
    ['transfers', 'transfers'],
    ['installments', 'installments'],
    ['classification', 'classification'],
    ['bill-id', 'bill-id'],
  ];
  for (const [filterKey, paramKey] of entries) {
    const value = filters[filterKey];
    if (value) {
      params.set(paramKey, String(value));
    }
  }
}

function appendTransactionPaginationParams(params: URLSearchParams, state: TableUrlState): void {
  params.set('page', String(state.p ?? 1));
  params.set('page-size', String(state.ps ?? DEFAULT_TRANSACTION_PAGE_SIZE));
}

function appendTransactionSortParams(params: URLSearchParams, sortSpecs: TableUrlState['o']): void {
  const sortSpec = sortSpecs?.[0];
  if (!sortSpec?.id) {
    return;
  }
  params.set('sort', `${sortSpec.id}:${sortSpec.desc ? 'desc' : 'asc'}`);
}
