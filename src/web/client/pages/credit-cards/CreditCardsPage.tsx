import { useQuery } from '@tanstack/react-query';
import type { LegacyColumnDef as ColumnDef } from '@tanstack/react-table/legacy';
import { legacyCreateColumnHelper as createColumnHelper } from '@tanstack/react-table/legacy';
import { clsx } from 'clsx';
import { lazy, Suspense, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { MdCheckCircle, MdExpandMore, MdReceiptLong, MdSchedule } from 'react-icons/md';
import { numericColumn } from '../../components/data-table/column-meta.js';
import { DataTable } from '../../components/data-table/DataTable.js';
import { FormattedDate } from '../../components/format/dates.js';
import { FormattedCurrency } from '../../components/format/FormattedCurrency.js';
import { FormattedPercent } from '../../components/format/FormattedPercent.js';
import { ActionIconButton } from '../../components/ui/EditIconButton.js';
import { apiJson } from '../../lib/api.js';
import { useAppNavigation } from '../../lib/navigation.js';

const CreditCardBillsChart = lazy(() =>
  import('../../components/charts/CreditCardBillsChart.js').then((module) => ({
    default: module.CreditCardBillsChart,
  })),
);

type BillRow = {
  readonly id: string;
  readonly account_id: string;
  readonly due_date: string;
  readonly total_amount_cents: number;
  readonly currency?: string;
  readonly payment_status?: string;
  momDeltaCents?: number | null;
  momPercent?: number | null;
};

function isBillPaid(status: string | null | undefined): boolean {
  return String(status ?? '').toUpperCase() === 'PAID';
}

function BillStatusIcon({ status }: { readonly status: string | null | undefined }) {
  const paid = isBillPaid(status);
  if (paid) {
    return <MdCheckCircle className="size-5 text-emerald-600" title="Paid" aria-label="Paid" />;
  }
  return <MdSchedule className="size-5 text-amber-600" title="Unpaid" aria-label="Unpaid" />;
}

function enrichBillsWithMom(bills: readonly Record<string, unknown>[]): BillRow[] {
  const byAccount = new Map<string, Record<string, unknown>[]>();
  for (const bill of bills) {
    const accountId = String(bill.account_id);
    const list = byAccount.get(accountId) ?? [];
    list.push(bill);
    byAccount.set(accountId, list);
  }

  const momByBillId = new Map<string, { delta: number; percent: number | null }>();
  for (const accountBills of byAccount.values()) {
    const sorted = accountBills.toSorted((a, b) =>
      String(a.due_date).localeCompare(String(b.due_date)),
    );
    for (let i = 1; i < sorted.length; i += 1) {
      const prev = Number(sorted[i - 1]?.total_amount_cents ?? 0);
      const curr = Number(sorted[i]?.total_amount_cents ?? 0);
      const delta = curr - prev;
      const percent = prev !== 0 ? delta / Math.abs(prev) : null;
      momByBillId.set(String(sorted[i]?.id), { delta, percent });
    }
  }

  return bills.map((bill) => {
    const mom = momByBillId.get(String(bill.id));
    return {
      id: String(bill.id),
      account_id: String(bill.account_id),
      due_date: String(bill.due_date),
      total_amount_cents: Number(bill.total_amount_cents ?? 0),
      currency: typeof bill.currency === 'string' ? bill.currency : 'BRL',
      payment_status: typeof bill.payment_status === 'string' ? bill.payment_status : undefined,
      momDeltaCents: mom?.delta ?? null,
      momPercent: mom?.percent ?? null,
    };
  });
}

function MomDeltaCell({ bill }: { readonly bill: BillRow }) {
  const delta = bill.momDeltaCents;
  if (delta === null || delta === undefined) {
    return <>—</>;
  }
  const tone = delta > 0 ? 'text-[var(--debit)]' : delta < 0 ? 'text-[var(--credit)]' : '';
  const sign = delta > 0 ? '+' : delta < 0 ? '-' : '';
  return (
    <span className={clsx('tabular-nums', tone)}>
      {sign}
      <FormattedCurrency
        amountCents={Math.abs(delta)}
        currency={String(bill.currency ?? 'BRL')}
        signed={false}
      />
    </span>
  );
}

function MomPercentCell({ bill }: { readonly bill: BillRow }) {
  const pct = bill.momPercent;
  if (pct === null || pct === undefined) {
    return <>—</>;
  }
  const tone = pct > 0 ? 'text-[var(--debit)]' : pct < 0 ? 'text-[var(--credit)]' : '';
  return (
    <span className={tone}>
      {pct > 0 ? '+' : ''}
      <FormattedPercent value={pct} decimals={1} />
    </span>
  );
}

function CreditCardCycleSummary({
  creditData,
}: {
  readonly creditData: Record<string, unknown> | null | undefined;
}) {
  const { t } = useTranslation();
  const closeDate =
    typeof creditData?.balance_close_date === 'string' ? creditData.balance_close_date : null;
  const dueDate =
    typeof creditData?.balance_due_date === 'string' ? creditData.balance_due_date : null;

  if (!closeDate && !dueDate) {
    return null;
  }

  return (
    <span className="block text-xs font-normal text-muted-foreground">
      {closeDate ? (
        <>
          {t('columns.closeDate')}: <FormattedDate value={closeDate} />
        </>
      ) : null}
      {closeDate && dueDate ? ' · ' : null}
      {dueDate ? (
        <>
          {t('columns.dueDate')}: <FormattedDate value={dueDate} />
        </>
      ) : null}
    </span>
  );
}

export function CreditCardsPage() {
  const { t } = useTranslation();
  const { openTransactions } = useAppNavigation();
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());

  const { data: cardsData } = useQuery({
    queryKey: ['credit-cards'],
    queryFn: () => apiJson<{ rows: Record<string, unknown>[] }>('/api/credit-cards'),
  });

  const { data: billsData } = useQuery({
    queryKey: ['credit-card-bills'],
    queryFn: () => apiJson<{ rows: Record<string, unknown>[] }>('/api/credit-card-bills'),
  });

  const billsByAccount = useMemo(() => {
    const enriched = enrichBillsWithMom(billsData?.rows ?? []);
    const map = new Map<string, BillRow[]>();
    for (const bill of enriched) {
      const accountId = String(bill.account_id);
      const list = map.get(accountId) ?? [];
      list.push(bill);
      map.set(accountId, list);
    }
    for (const list of map.values()) {
      list.sort((a, b) => String(b.due_date).localeCompare(String(a.due_date)));
    }
    return map;
  }, [billsData?.rows]);

  const billColumns = useMemo(() => {
    const h = createColumnHelper<BillRow>();
    return [
      h.display({
        id: 'status',
        header: () => t('columns.status'),
        meta: { align: 'center' },
        enableSorting: false,
        cell: ({ row }) => <BillStatusIcon status={String(row.original.payment_status ?? '')} />,
      }),
      h.accessor('due_date', {
        header: () => t('columns.dueDate'),
        cell: ({ getValue }) => <FormattedDate value={String(getValue() ?? '')} />,
      }),
      h.accessor('total_amount_cents', {
        header: () => t('columns.total'),
        ...numericColumn<BillRow>(),
        cell: ({ row }) => (
          <FormattedCurrency
            amountCents={Number(row.original.total_amount_cents ?? 0)}
            currency={String(row.original.currency ?? 'BRL')}
            signed={false}
          />
        ),
      }),
      h.accessor((row) => row.momDeltaCents, {
        id: 'momDelta',
        header: () => t('columns.momChange'),
        ...numericColumn<BillRow>(),
        cell: ({ row }) => <MomDeltaCell bill={row.original} />,
      }),
      h.accessor((row) => row.momPercent, {
        id: 'momPercent',
        header: () => t('columns.momPercent'),
        ...numericColumn<BillRow>(),
        cell: ({ row }) => <MomPercentCell bill={row.original} />,
      }),
      h.display({
        id: 'actions',
        header: () => '',
        meta: { align: 'right' },
        enableSorting: false,
        cell: ({ row }) => {
          const accountId = String(row.original.account_id);
          return (
            <ActionIconButton
              label={t('actions.viewTransactions')}
              onClick={() =>
                openTransactions({
                  a: accountId,
                  'bill-id': String(row.original.id),
                  'display.date': 'credit-purchase',
                  d: 'all',
                })
              }
            >
              <MdReceiptLong className="size-4" />
            </ActionIconButton>
          );
        },
      }),
    ] as ColumnDef<BillRow, unknown>[];
  }, [openTransactions, t]);

  const cardRows = cardsData?.rows ?? [];

  if (cardRows.length === 0) {
    return <p className="text-sm text-muted-foreground">{t('table.empty')}</p>;
  }

  return (
    <div className="space-y-2">
      {cardRows.map((card) => {
        const id = String(card.id);
        const isOpen = expanded.has(id);
        const cardBills = billsByAccount.get(id) ?? [];
        return (
          <div key={id} className="overflow-hidden rounded-md border border-border">
            <div className="flex w-full items-center gap-3 bg-muted/40 px-3 py-2">
              <button
                type="button"
                className="flex min-w-0 flex-1 items-center gap-3 text-left hover:opacity-80"
                onClick={() =>
                  setExpanded((prev) => {
                    const next = new Set(prev);
                    if (next.has(id)) {
                      next.delete(id);
                    } else {
                      next.add(id);
                    }
                    return next;
                  })
                }
              >
                <MdExpandMore
                  className={clsx('size-5 shrink-0 transition-transform', !isOpen && '-rotate-90')}
                />
                <span className="min-w-0 flex-1 font-medium">
                  <span className="block truncate">{String(card.display_name ?? card.name)}</span>
                  <CreditCardCycleSummary
                    creditData={
                      card.credit_data && typeof card.credit_data === 'object'
                        ? (card.credit_data as Record<string, unknown>)
                        : null
                    }
                  />
                </span>
                <span className="tabular-nums text-sm">
                  <FormattedCurrency
                    amountCents={Number(card.balance_cents ?? 0)}
                    currency={String(card.currency ?? 'BRL')}
                  />
                </span>
              </button>
              <ActionIconButton
                label={t('actions.viewTransactions')}
                onClick={() => {
                  const latestBill = cardBills[0];
                  if (latestBill) {
                    openTransactions({
                      a: id,
                      'bill-id': String(latestBill.id),
                      'display.date': 'credit-purchase',
                      d: 'all',
                    });
                    return;
                  }
                  openTransactions({ a: id, d: 'this-month' });
                }}
              >
                <MdReceiptLong className="size-4" />
              </ActionIconButton>
            </div>
            {isOpen && (
              <div className="border-t border-border p-2">
                <Suspense fallback={<p className="text-sm text-muted-foreground">…</p>}>
                  <CreditCardBillsChart bills={cardBills} />
                </Suspense>
                {cardBills.length === 0 ? (
                  <p className="py-4 text-center text-sm text-muted-foreground">
                    {t('table.empty')}
                  </p>
                ) : (
                  <DataTable columns={billColumns} data={cardBills} />
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
