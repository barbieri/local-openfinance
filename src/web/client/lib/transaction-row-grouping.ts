import type { TFunction } from 'i18next';
import type {
  DataTableRowGroup,
  DataTableRowGroupAmountSummary,
  DataTableRowGroupCategoryPresentation,
  DataTableRowGroupLabelPresentation,
} from '../components/data-table/data-table-row-group.js';
import { formatLocalDate } from './format.js';

export const TRANSACTION_GROUP_BY_FIELDS = [
  'date',
  'connection',
  'account',
  'category',
  'label',
  'merchant',
] as const;

export type TransactionGroupByField = (typeof TRANSACTION_GROUP_BY_FIELDS)[number];

export type TransactionGroupingRow = {
  readonly id: string;
  readonly account_id: string;
  readonly local_date: string;
  readonly display_name: string;
  readonly merchant_name: string | null;
  readonly category_id: string | null;
  readonly category_override_id: string | null;
  readonly category_presentation: {
    readonly name: string;
    readonly icon: string;
    readonly color: string;
    readonly path?: string;
  } | null;
  readonly amount_in_account_currency_cents: number;
  readonly account_currency: string;
  readonly annotation: {
    readonly labels: readonly string[];
    readonly labelIds: readonly string[];
    readonly labelPresentations?: readonly {
      readonly id: string;
      readonly name: string;
      readonly icon: string;
      readonly color: string;
      readonly path: string;
    }[];
  } | null;
};

export type TransactionRowGrouping<Row extends TransactionGroupingRow> = {
  readonly rows: readonly Row[];
  readonly groups: readonly DataTableRowGroup[];
};

type TransactionGroupContext = {
  readonly accountById: ReadonlyMap<string, Record<string, unknown>>;
  readonly locale: string;
  readonly t: TFunction;
};

type TransactionGroupKey = {
  readonly key: string;
  readonly label: string;
  readonly categoryPresentation?: DataTableRowGroupCategoryPresentation;
  readonly labelPresentations?: readonly DataTableRowGroupLabelPresentation[];
};

type TransactionGroupBucket<Row extends TransactionGroupingRow> = TransactionGroupKey & {
  readonly rows: Row[];
};

type BucketBuildResult<Row extends TransactionGroupingRow> = {
  readonly rows: readonly Row[];
  readonly group: DataTableRowGroup;
};

const TRANSACTION_GROUP_BY_FIELD_SET = new Set<string>(TRANSACTION_GROUP_BY_FIELDS);

export function resolveTransactionGroupBy(
  stored: readonly string[] | undefined,
): readonly TransactionGroupByField[] {
  if (!stored) {
    return [];
  }
  const resolved: TransactionGroupByField[] = [];
  for (const value of stored) {
    if (TRANSACTION_GROUP_BY_FIELD_SET.has(value)) {
      resolved.push(value as TransactionGroupByField);
    }
  }
  return resolved;
}

export function resolveTransactionGroupByLabelKey(field: TransactionGroupByField): string {
  switch (field) {
    case 'date':
      return 'filters.groupByDate';
    case 'connection':
      return 'filters.groupByConnection';
    case 'account':
      return 'filters.groupByAccount';
    case 'category':
      return 'filters.groupByCategory';
    case 'label':
      return 'filters.groupByLabel';
    case 'merchant':
      return 'filters.groupByMerchant';
  }
}

export function buildTransactionRowGrouping<Row extends TransactionGroupingRow>(input: {
  readonly rows: readonly Row[];
  readonly groupBy: readonly TransactionGroupByField[];
  readonly accounts: readonly Record<string, unknown>[];
  readonly locale: string;
  readonly t: TFunction;
}): TransactionRowGrouping<Row> {
  if (input.groupBy.length === 0 || input.rows.length === 0) {
    return { rows: input.rows, groups: [] };
  }

  const context: TransactionGroupContext = {
    accountById: new Map(input.accounts.map((account) => [String(account['id']), account])),
    locale: input.locale,
    t: input.t,
  };
  const nextRowIndex = { current: 0 };
  return buildGroups(input.rows, input.groupBy, context, 0, '', nextRowIndex);
}

function buildGroups<Row extends TransactionGroupingRow>(
  rows: readonly Row[],
  groupBy: readonly TransactionGroupByField[],
  context: TransactionGroupContext,
  depth: number,
  parentKey: string,
  nextRowIndex: { current: number },
): TransactionRowGrouping<Row> {
  const field = groupBy[depth];
  if (!field) {
    return buildTerminalGroup(rows, depth, parentKey, nextRowIndex);
  }

  const buckets = bucketRows(rows, field, context);
  const flattenedRows: Row[] = [];
  const groups: DataTableRowGroup[] = [];
  for (const bucket of buckets.values()) {
    const result =
      depth + 1 < groupBy.length
        ? buildNestedBucketGroup(bucket, field, groupBy, context, depth, parentKey, nextRowIndex)
        : buildLeafBucketGroup(bucket, field, depth, parentKey, nextRowIndex);
    flattenedRows.push(...result.rows);
    groups.push(result.group);
  }

  return { rows: flattenedRows, groups };
}

function buildTerminalGroup<Row extends TransactionGroupingRow>(
  rows: readonly Row[],
  depth: number,
  parentKey: string,
  nextRowIndex: { current: number },
): TransactionRowGrouping<Row> {
  const rowIndexes = takeNextRowIndexes(rows, nextRowIndex);
  return {
    rows,
    groups: [
      {
        id: parentKey,
        field: 'unknown',
        label: '',
        count: rows.length,
        depth,
        allRowIndexes: rowIndexes,
        rowIndexes,
        amountSummary: buildAmountSummary(rows),
      },
    ],
  };
}

function bucketRows<Row extends TransactionGroupingRow>(
  rows: readonly Row[],
  field: TransactionGroupByField,
  context: TransactionGroupContext,
): Map<string, TransactionGroupBucket<Row>> {
  const buckets = new Map<string, TransactionGroupBucket<Row>>();
  for (const row of rows) {
    const groupKey = resolveTransactionGroupKey(row, field, context);
    const bucket = buckets.get(groupKey.key);
    if (bucket) {
      bucket.rows.push(row);
    } else {
      buckets.set(groupKey.key, { ...groupKey, rows: [row] });
    }
  }
  return buckets;
}

function buildNestedBucketGroup<Row extends TransactionGroupingRow>(
  bucket: TransactionGroupBucket<Row>,
  field: TransactionGroupByField,
  groupBy: readonly TransactionGroupByField[],
  context: TransactionGroupContext,
  depth: number,
  parentKey: string,
  nextRowIndex: { current: number },
): BucketBuildResult<Row> {
  const id = buildGroupId(parentKey, field, bucket.key);
  const child = buildGroups(bucket.rows, groupBy, context, depth + 1, id, nextRowIndex);
  return {
    rows: child.rows,
    group: withOptionalGroupPresentations(
      {
        id,
        field,
        label: bucket.label,
        count: bucket.rows.length,
        depth,
        allRowIndexes: child.groups.flatMap((group) => group.allRowIndexes),
        children: child.groups,
        amountSummary: buildAmountSummary(bucket.rows),
      },
      bucket,
    ),
  };
}

function buildLeafBucketGroup<Row extends TransactionGroupingRow>(
  bucket: TransactionGroupBucket<Row>,
  field: TransactionGroupByField,
  depth: number,
  parentKey: string,
  nextRowIndex: { current: number },
): BucketBuildResult<Row> {
  const rowIndexes = takeNextRowIndexes(bucket.rows, nextRowIndex);
  return {
    rows: bucket.rows,
    group: withOptionalGroupPresentations(
      {
        id: buildGroupId(parentKey, field, bucket.key),
        field,
        label: bucket.label,
        count: bucket.rows.length,
        depth,
        allRowIndexes: rowIndexes,
        rowIndexes,
        amountSummary: buildAmountSummary(bucket.rows),
      },
      bucket,
    ),
  };
}

function takeNextRowIndexes(
  rows: readonly TransactionGroupingRow[],
  nextRowIndex: { current: number },
): number[] {
  const rowIndexes: number[] = [];
  for (const _row of rows) {
    rowIndexes.push(nextRowIndex.current);
    nextRowIndex.current += 1;
  }
  return rowIndexes;
}

function buildGroupId(parentKey: string, field: TransactionGroupByField, key: string): string {
  return `${parentKey}/${field}:${encodeURIComponent(key)}`;
}

function withOptionalGroupPresentations(
  group: DataTableRowGroup,
  source: Pick<TransactionGroupKey, 'categoryPresentation' | 'labelPresentations'>,
): DataTableRowGroup {
  return {
    ...group,
    ...(source.categoryPresentation ? { categoryPresentation: source.categoryPresentation } : {}),
    ...(source.labelPresentations ? { labelPresentations: source.labelPresentations } : {}),
  };
}

function resolveTransactionGroupKey(
  row: TransactionGroupingRow,
  field: TransactionGroupByField,
  context: TransactionGroupContext,
): TransactionGroupKey {
  switch (field) {
    case 'date':
      return withFieldLabel(
        context.t('columns.date'),
        row.local_date,
        formatLocalDate(row.local_date, context.locale),
      );
    case 'connection':
      return resolveConnectionGroupKey(row, context);
    case 'account':
      return resolveAccountGroupKey(row, context);
    case 'category':
      return withFieldLabel(
        context.t('columns.category'),
        row.category_override_id ?? row.category_id ?? '__uncategorized',
        row.category_presentation?.path ??
          row.category_presentation?.name ??
          context.t('filters.uncategorized'),
        row.category_presentation ?? undefined,
      );
    case 'label':
      return resolveLabelGroupKey(row, context);
    case 'merchant':
      return withFieldLabel(
        context.t('columns.merchant'),
        normalizeGroupKey(row.merchant_name) ?? '__no_merchant',
        row.merchant_name?.trim() || context.t('filters.noMerchant'),
      );
  }
}

function resolveConnectionGroupKey(
  row: TransactionGroupingRow,
  context: TransactionGroupContext,
): TransactionGroupKey {
  const account = context.accountById.get(row.account_id);
  const connectionId = String(account?.['connection_item_id'] ?? '__unknown_connection');
  return withFieldLabel(
    context.t('columns.connection'),
    connectionId,
    String(account?.['connection_display_name'] ?? connectionId),
  );
}

function resolveAccountGroupKey(
  row: TransactionGroupingRow,
  context: TransactionGroupContext,
): TransactionGroupKey {
  const account = context.accountById.get(row.account_id);
  return withFieldLabel(
    context.t('columns.account'),
    row.account_id,
    String(account?.['display_name'] ?? account?.['name'] ?? row.display_name ?? row.account_id),
  );
}

function resolveLabelGroupKey(
  row: TransactionGroupingRow,
  context: TransactionGroupContext,
): TransactionGroupKey {
  const presentations = row.annotation?.labelPresentations ?? [];
  if (presentations.length > 0) {
    const key = presentations.map((label) => label.id).join('\0');
    const label = presentations.map((item) => item.path || item.name).join(', ');
    return withFieldLabel(context.t('columns.labels'), key, label, undefined, presentations);
  }

  const labelIds = row.annotation?.labelIds ?? [];
  if (labelIds.length > 0) {
    const label = row.annotation?.labels.join(', ') || labelIds.join(', ');
    return withFieldLabel(context.t('columns.labels'), labelIds.join('\0'), label);
  }

  return withFieldLabel(context.t('columns.labels'), '__unlabeled', context.t('filters.unlabeled'));
}

function buildAmountSummary(
  rows: readonly TransactionGroupingRow[],
): DataTableRowGroupAmountSummary {
  let positiveCents = 0;
  let negativeCents = 0;
  const currencies = new Set<string>();
  for (const row of rows) {
    const amount = row.amount_in_account_currency_cents;
    currencies.add(row.account_currency);
    if (amount > 0) {
      positiveCents += amount;
    } else if (amount < 0) {
      negativeCents += amount;
    }
  }
  const [currency] = currencies;
  return {
    positiveCents,
    negativeCents,
    balanceCents: positiveCents + negativeCents,
    currency: currencies.size === 1 ? (currency ?? null) : null,
    mixedCurrencies: currencies.size > 1,
  };
}

function withFieldLabel(
  fieldLabel: string,
  key: string,
  valueLabel: string,
  categoryPresentation?: DataTableRowGroupCategoryPresentation,
  labelPresentations?: readonly DataTableRowGroupLabelPresentation[],
): TransactionGroupKey {
  return {
    key,
    label: `${fieldLabel}: ${valueLabel}`,
    ...(categoryPresentation ? { categoryPresentation } : {}),
    ...(labelPresentations ? { labelPresentations } : {}),
  };
}

function normalizeGroupKey(value: string | null | undefined): string | null {
  const normalized = value?.trim().toLocaleLowerCase();
  return normalized && normalized.length > 0 ? normalized : null;
}
