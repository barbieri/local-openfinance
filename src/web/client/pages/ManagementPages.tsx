import { useQuery } from '@tanstack/react-query';
import { legacyCreateColumnHelper as createColumnHelper } from '@tanstack/react-table/legacy';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { MdReceiptLong } from 'react-icons/md';
import { AccountEditDialog } from '../components/accounts/AccountEditDialog.js';
import { LinkAccountsDialog } from '../components/accounts/LinkAccountsDialog.js';
import { CategoryTreeView } from '../components/categories/CategoryTreeView.js';
import { ConnectionEditDialog } from '../components/connections/ConnectionEditDialog.js';
import { actionsColumn, numericColumn } from '../components/data-table/column-meta.js';
import { DataTable } from '../components/data-table/DataTable.js';
import { ConnectionCell } from '../components/entities/ConnectionCell.js';
import { FormattedCurrency } from '../components/format/FormattedCurrency.js';
import { GrandTotalSummary } from '../components/format/GrandTotalSummary.js';
import { LastSyncCell } from '../components/format/LastSyncCell.js';
import { FormattedSyncTime } from '../components/format/sync-time.js';
import type { LabelRecord } from '../components/labels/LabelEditDialog.js';
import { LabelTreeView } from '../components/labels/LabelTreeView.js';
import { ActionIconButton, EditIconButton } from '../components/ui/EditIconButton.js';
import { apiJson } from '../lib/api.js';
import { withLocaleQuery } from '../lib/api-locale.js';
import { sumAmountsByCurrency } from '../lib/currency-totals.js';
import { useAppNavigation } from '../lib/navigation.js';
import { matchesSearch } from '../lib/normalize.js';

function formatAccountDetails(row: Record<string, unknown>): string {
  if (typeof row.account_details === 'string' && row.account_details.length > 0) {
    return row.account_details;
  }
  return '—';
}

export function ConnectionsPage() {
  const { t } = useTranslation();
  const [editRow, setEditRow] = useState<Record<string, unknown> | null>(null);
  const { data } = useQuery({
    queryKey: ['connections'],
    queryFn: () => apiJson<{ rows: Record<string, unknown>[] }>('/api/connections'),
  });
  const columns = useMemo(() => {
    const h = createColumnHelper<Record<string, unknown>>();
    return [
      h.accessor('display_name', { header: () => t('columns.displayName'), enableSorting: true }),
      h.accessor('connector_name', { header: () => t('columns.connector'), enableSorting: true }),
      h.accessor('status', { header: () => t('columns.status'), enableSorting: true }),
      h.accessor('synced_at', {
        header: () => t('columns.lastSync'),
        enableSorting: true,
        cell: ({ getValue }) => <FormattedSyncTime value={String(getValue() ?? '')} />,
      }),
      h.display({
        id: 'actions',
        header: () => '',
        ...actionsColumn<Record<string, unknown>>(),
        cell: ({ row }) => (
          <EditIconButton label={t('actions.edit')} onClick={() => setEditRow(row.original)} />
        ),
      }),
    ];
  }, [t]);
  return (
    <>
      <DataTable columns={columns} data={data?.rows ?? []} emptyMessage={t('table.empty')} />
      <ConnectionEditDialog connection={editRow} onClose={() => setEditRow(null)} />
    </>
  );
}

export function AccountsPage() {
  const { t } = useTranslation();
  const { openTransactions } = useAppNavigation();
  const [editRow, setEditRow] = useState<Record<string, unknown> | null>(null);
  const [linkDialogOpen, setLinkDialogOpen] = useState(false);
  const [connectionFilter, setConnectionFilter] = useState('');
  const [search, setSearch] = useState('');

  const { data: connections } = useQuery({
    queryKey: ['connections'],
    queryFn: () => apiJson<{ rows: Record<string, unknown>[] }>('/api/connections'),
  });
  const { data } = useQuery({
    queryKey: ['accounts'],
    queryFn: () => apiJson<{ rows: Record<string, unknown>[] }>('/api/accounts'),
  });

  const rows = useMemo(() => {
    let list = data?.rows ?? [];
    if (connectionFilter) {
      list = list.filter((row) => row.connection_item_id === connectionFilter);
    }
    if (search.trim()) {
      list = list.filter(
        (row) =>
          matchesSearch(String(row.display_name ?? ''), search) ||
          matchesSearch(String(row.name ?? ''), search) ||
          matchesSearch(formatAccountDetails(row), search),
      );
    }
    return list;
  }, [data?.rows, connectionFilter, search]);

  const balanceTotalsByCurrency = useMemo(
    () =>
      sumAmountsByCurrency(
        rows,
        (row) => Number(row.balance_cents ?? 0),
        (row) => String(row.currency ?? 'BRL'),
      ),
    [rows],
  );

  const columns = useMemo(() => {
    const h = createColumnHelper<Record<string, unknown>>();
    return [
      h.accessor('display_name', {
        header: () => t('columns.displayName'),
        enableSorting: true,
        cell: ({ row }) => {
          const merged = row.original.merged_account_ids;
          const mergedCount = Array.isArray(merged) ? merged.length : 0;
          return (
            <span>
              {String(row.original.display_name ?? '')}
              {mergedCount > 0 && (
                <span className="ml-1 text-xs text-muted-foreground">
                  {t('linkAccounts.mergedBadge', { count: mergedCount })}
                </span>
              )}
            </span>
          );
        },
      }),
      h.display({
        id: 'connection',
        header: () => t('columns.connection'),
        enableSorting: false,
        cell: ({ row }) => (
          <ConnectionCell connectionId={String(row.original.connection_item_id ?? '')} />
        ),
      }),
      h.accessor('type', { header: () => t('columns.type'), enableSorting: true }),
      h.accessor('subtype', { header: () => t('columns.subtype'), enableSorting: true }),
      h.accessor('balance_cents', {
        header: () => t('columns.balance'),
        ...numericColumn<Record<string, unknown>>(),
        cell: ({ row }) => (
          <FormattedCurrency
            amountCents={Number(row.original.balance_cents ?? 0)}
            currency={String(row.original.currency ?? 'BRL')}
          />
        ),
      }),
      h.display({
        id: 'details',
        header: () => t('columns.details'),
        enableSorting: false,
        cell: ({ row }) => formatAccountDetails(row.original),
      }),
      h.display({
        id: 'lastSync',
        header: () => t('columns.lastSync'),
        enableSorting: false,
        cell: ({ row }) => <LastSyncCell row={row.original} />,
      }),
      h.display({
        id: 'actions',
        header: () => '',
        ...actionsColumn<Record<string, unknown>>(),
        cell: ({ row }) => (
          <div className="flex justify-end gap-1">
            <ActionIconButton
              label={t('actions.viewTransactions')}
              onClick={() => openTransactions({ a: String(row.original.id), d: 'this-month' })}
            >
              <MdReceiptLong className="size-4" />
            </ActionIconButton>
            <EditIconButton label={t('actions.edit')} onClick={() => setEditRow(row.original)} />
          </div>
        ),
      }),
    ];
  }, [openTransactions, t]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className="rounded border border-input bg-background px-3 py-1 text-sm hover:bg-muted"
          onClick={() => setLinkDialogOpen(true)}
        >
          {t('actions.linkAccounts')}
        </button>
        <select
          className="rounded border border-input bg-background px-2 py-1 text-sm"
          aria-label={t('filters.allConnections')}
          value={connectionFilter}
          onChange={(e) => setConnectionFilter(e.target.value)}
        >
          <option value="">{t('filters.allConnections')}</option>
          {(connections?.rows ?? []).map((c) => (
            <option key={String(c.item_id)} value={String(c.item_id)}>
              {String(c.display_name ?? c.connector_name)}
            </option>
          ))}
        </select>
        <input
          type="search"
          className="min-w-[12rem] rounded border border-input bg-background px-2 py-1 text-sm"
          placeholder={t('filters.searchAccounts')}
          aria-label={t('filters.searchAccounts')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>
      <GrandTotalSummary
        label={t('table.grandTotal')}
        countLabel={t('accounts.accountCount', { count: rows.length })}
        totalsByCurrency={balanceTotalsByCurrency}
        signed
      />
      <DataTable columns={columns} data={rows} emptyMessage={t('table.empty')} />
      <AccountEditDialog account={editRow} onClose={() => setEditRow(null)} />
      <LinkAccountsDialog open={linkDialogOpen} onClose={() => setLinkDialogOpen(false)} />
    </div>
  );
}

export function CategoriesPage() {
  const { t, i18n } = useTranslation();
  const { data, isLoading } = useQuery({
    queryKey: ['categories', i18n.language],
    queryFn: () =>
      apiJson<{ byId: Record<string, Record<string, unknown>> }>(
        withLocaleQuery('/api/categories', i18n.language),
      ),
  });
  if (isLoading) {
    return <p>…</p>;
  }
  if (!data?.byId || Object.keys(data.byId).length === 0) {
    return <p>{t('table.empty')}</p>;
  }
  return <CategoryTreeView byId={data.byId} />;
}

export function LabelsPage() {
  const { t } = useTranslation();
  const { data, isLoading } = useQuery({
    queryKey: ['annotation-labels'],
    queryFn: () => apiJson<{ byId: Record<string, LabelRecord> }>('/api/annotation-labels'),
  });
  if (isLoading) {
    return <p>…</p>;
  }
  if (!data?.byId || Object.keys(data.byId).length === 0) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">{t('labels.empty')}</p>
        <LabelTreeView byId={{}} />
      </div>
    );
  }
  return <LabelTreeView byId={data.byId} />;
}
