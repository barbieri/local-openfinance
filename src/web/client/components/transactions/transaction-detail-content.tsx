import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type ReactNode, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { MdContentCopy, MdOpenInNew } from 'react-icons/md';
import { toast } from 'sonner';
import {
  computeForeignExchangeRate,
  isForeignCurrencyTransaction,
} from '../../../../db/transaction-foreign-amount.js';
import { useEntityRef } from '../../hooks/use-entity-ref.js';
import { apiJson } from '../../lib/api.js';
import { withLocaleQuery } from '../../lib/api-locale.js';
import { transactionPermalinkUrl } from '../../lib/app-hash.js';
import { formatCurrencyAmount, formatDualCurrencyAmount } from '../../lib/format.js';
import { formatRelativeOrAbsoluteDate } from '../../lib/format-relative-date.js';
import { useAppNavigation } from '../../lib/navigation.js';
import {
  readPaymentDocumentsFromRawJson,
  readTransactionCardNumber,
} from '../../lib/payment-document.js';
import { CategoryPathBadge } from '../categories/CategoryPathBadge.js';
import type { CategoryPresentation } from '../categories/category-badge-presentation.js';
import { Confidence } from '../format/Confidence.js';
import { FormattedDate, FormattedDateTime } from '../format/dates.js';
import { ForeignCurrencyAmount } from '../format/ForeignCurrencyAmount.js';
import { FormattedCurrency } from '../format/FormattedCurrency.js';
import { ActionIconButton } from '../ui/EditIconButton.js';
import type { TransferPairProposal } from './DetectTransfersDialog.js';
import { PaymentDocumentFields } from './PaymentDocumentFields.js';
import { TransactionClassificationForm } from './TransactionClassificationForm.js';
import type { TransferRelatedLeg } from './TransferLinkTooltip.js';
import type { TransactionDetailRow } from './transaction-detail-types.js';

function formatTransactionRawJson(rawJson: string): string {
  try {
    return JSON.stringify(JSON.parse(rawJson), null, 2);
  } catch {
    return rawJson;
  }
}

function DetailField({
  label,
  children,
}: {
  readonly label: string;
  readonly children: ReactNode;
}) {
  return (
    <div className="flex min-w-0 items-baseline gap-2">
      <span className="shrink-0 text-xs font-medium uppercase text-muted-foreground">{label}</span>
      <span className="min-w-0 flex-1">{children}</span>
    </div>
  );
}

function resolveBillLinkSourceLabel(
  source: string | null | undefined,
  t: ReturnType<typeof useTranslation>['t'],
): string {
  switch (source) {
    case 'transaction_metadata':
      return t('transactionDetail.billLinkMetadata');
    case 'manual':
      return t('transactionDetail.billLinkManual');
    case 'inferred':
      return t('transactionDetail.billLinkInferred');
    default:
      return source ?? '—';
  }
}

function CreditCardBillSection({
  transaction,
  active,
  onBillLinkSaved,
}: {
  readonly transaction: TransactionDetailRow;
  readonly active: boolean;
  readonly onBillLinkSaved: () => void | Promise<void>;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const creditCard = transaction.credit_card;

  const { data: billsData } = useQuery({
    queryKey: ['credit-card-bills'],
    queryFn: () => apiJson<{ rows: Record<string, unknown>[] }>('/api/credit-card-bills'),
    enabled: active && creditCard != null,
  });

  const accountBills = useMemo(
    () =>
      (billsData?.rows ?? [])
        .filter((bill) => String(bill['account_id']) === transaction.account_id)
        .toSorted((a, b) => String(b['due_date'] ?? '').localeCompare(String(a['due_date'] ?? ''))),
    [billsData?.rows, transaction.account_id],
  );

  const billLinkMutation = useMutation({
    mutationFn: (billId: string) =>
      apiJson<{ transaction: TransactionDetailRow }>(
        `/api/transactions/${transaction.id}/bill-link`,
        {
          method: 'POST',
          body: JSON.stringify({ billId }),
        },
      ),
    onSuccess: async (result) => {
      toast.success(t('transactionDetail.billLinkSaved'));
      queryClient.setQueryData(['transaction', transaction.id], result.transaction);
      await queryClient.invalidateQueries({ queryKey: ['transactions'] });
      await onBillLinkSaved();
    },
    onError: (error: Error) => {
      toast.error(t('toast.error'), { description: error.message, duration: Infinity });
    },
  });

  if (!creditCard) {
    return null;
  }

  const billDueDate = creditCard.bill_due_date?.slice(0, 10) ?? null;

  return (
    <section className="space-y-2 rounded-md border border-border p-3">
      <h3 className="font-medium">{t('transactionDetail.creditCardBill')}</h3>
      <div className="flex flex-wrap items-end gap-x-4 gap-y-2">
        {billDueDate ? (
          <DetailField label={t('columns.dueDate')}>
            <FormattedDate value={billDueDate} />
          </DetailField>
        ) : null}
        {creditCard.bill_link_source ? (
          <DetailField label={t('transactionDetail.billLinkSource')}>
            {resolveBillLinkSourceLabel(creditCard.bill_link_source, t)}
          </DetailField>
        ) : null}
        {creditCard.can_change_bill_link && accountBills.length > 0 ? (
          <label className="flex min-w-[12rem] flex-col gap-1 text-sm">
            <span className="text-xs font-medium uppercase text-muted-foreground">
              {t('transactionDetail.changeBill')}
            </span>
            <select
              className="rounded border border-input bg-background px-2 py-1 text-sm"
              value={creditCard.bill_id ?? ''}
              disabled={billLinkMutation.isPending}
              onChange={(e) => {
                const billId = e.target.value;
                if (billId && billId !== creditCard.bill_id) {
                  billLinkMutation.mutate(billId);
                }
              }}
            >
              <option value="">{t('filters.allBills')}</option>
              {accountBills.map((bill) => {
                const dueDate = String(bill['due_date'] ?? '').slice(0, 10);
                return (
                  <option key={String(bill['id'])} value={String(bill['id'])}>
                    {dueDate || String(bill['id'])}
                  </option>
                );
              })}
            </select>
          </label>
        ) : null}
      </div>
    </section>
  );
}

type InstallmentPlanFirstTransaction = {
  readonly id: string;
  readonly local_date: string;
  readonly occurred_at: string;
  readonly amount_cents: number;
  readonly amount_in_account_currency_cents: number;
  readonly currency: string;
  readonly account_currency: string;
  readonly description: string | null;
  readonly display_description: string | null;
  readonly category_presentation: CategoryPresentation | null;
};

function InstallmentPlanTotalAmount({
  totalAmountCents,
  currency,
}: {
  readonly totalAmountCents: number;
  readonly currency: string;
}) {
  const { t } = useTranslation();

  return (
    <>
      {t('transactionDetail.installmentTotal')}{' '}
      <FormattedCurrency amountCents={totalAmountCents} currency={currency} signed={false} />
    </>
  );
}

function InstallmentFirstInstallmentHeader({
  firstInstallment,
  onOpenTransaction,
}: {
  readonly firstInstallment: InstallmentPlanFirstTransaction;
  readonly onOpenTransaction?: (transactionId: string) => void | Promise<void>;
}) {
  const { t } = useTranslation();

  return (
    <>
      {t('transactionDetail.firstInstallmentDate')}{' '}
      <FormattedDate value={firstInstallment.local_date} />
      {onOpenTransaction ? (
        <>
          {' · '}
          <button
            type="button"
            className="text-xs text-foreground underline-offset-2 hover:underline"
            onClick={() => void onOpenTransaction(firstInstallment.id)}
          >
            {t('transactionDetail.viewFirstInstallment')}
          </button>
        </>
      ) : null}
    </>
  );
}

function InstallmentFirstInstallmentDetails({
  firstInstallment,
}: {
  readonly firstInstallment: InstallmentPlanFirstTransaction;
}) {
  const { t } = useTranslation();

  return (
    <details className="rounded bg-muted/40 p-2">
      <summary className="cursor-pointer text-sm font-medium">
        {t('transactionDetail.firstInstallmentDetails')}
      </summary>
      <div className="mt-2 space-y-1 text-sm">
        <DetailField label={t('columns.date')}>
          <FormattedDate value={firstInstallment.local_date} />
        </DetailField>
        <DetailField label={t('columns.amount')}>
          <ForeignCurrencyAmount
            amountCents={firstInstallment.amount_cents}
            currency={firstInstallment.currency}
            accountCurrency={firstInstallment.account_currency}
            amountInAccountCurrencyCents={firstInstallment.amount_in_account_currency_cents}
          />
        </DetailField>
        <DetailField label={t('columns.category')}>
          {firstInstallment.category_presentation ? (
            <CategoryPathBadge presentation={firstInstallment.category_presentation} />
          ) : (
            '—'
          )}
        </DetailField>
        <DetailField label={t('columns.description')}>
          {firstInstallment.display_description ?? firstInstallment.description ?? '—'}
        </DetailField>
      </div>
    </details>
  );
}

function InstallmentPlanDateLine({
  purchaseDate,
  firstInstallment,
  onOpenTransaction,
  isPending,
  isError,
}: {
  readonly purchaseDate?: string | null;
  readonly firstInstallment: InstallmentPlanFirstTransaction | null | undefined;
  readonly onOpenTransaction?: (transactionId: string) => void | Promise<void>;
  readonly isPending: boolean;
  readonly isError: boolean;
}) {
  const { t } = useTranslation();
  const purchaseDateLabel = purchaseDate?.slice(0, 10) ?? null;

  if (purchaseDateLabel) {
    return (
      <>
        {t('columns.purchaseDate')}: <FormattedDate value={purchaseDateLabel} />
        {firstInstallment && onOpenTransaction ? (
          <>
            {' · '}
            <button
              type="button"
              className="text-xs text-foreground underline-offset-2 hover:underline"
              onClick={() => void onOpenTransaction(firstInstallment.id)}
            >
              {t('transactionDetail.viewFirstInstallment')}
            </button>
          </>
        ) : null}
      </>
    );
  }

  if (isPending) {
    return <>…</>;
  }

  if (isError || !firstInstallment) {
    return null;
  }

  return (
    <InstallmentFirstInstallmentHeader
      firstInstallment={firstInstallment}
      onOpenTransaction={onOpenTransaction}
    />
  );
}

function InstallmentPlanSummary({
  transactionId,
  installmentNumber,
  totalInstallments,
  amountInAccountCurrencyCents,
  accountCurrency,
  purchaseDate,
  purchaseTotalCents,
  onOpenTransaction,
  enabled = true,
  locale,
}: {
  readonly transactionId: string;
  readonly installmentNumber: number;
  readonly totalInstallments: number;
  readonly amountInAccountCurrencyCents: number;
  readonly accountCurrency: string;
  readonly purchaseDate?: string | null;
  readonly purchaseTotalCents?: number | null;
  readonly onOpenTransaction?: (transactionId: string) => void | Promise<void>;
  readonly enabled?: boolean;
  readonly locale: string;
}) {
  const { t } = useTranslation();
  const { data, isPending, isError } = useQuery({
    queryKey: ['installment-plan', transactionId, locale],
    queryFn: () =>
      apiJson<{
        plan: {
          readonly firstInstallment: InstallmentPlanFirstTransaction | null;
        } | null;
      }>(withLocaleQuery(`/api/transactions/${transactionId}/installment-plan`, locale)),
    enabled: enabled !== false && installmentNumber > 1 && totalInstallments > 1,
  });

  const firstInstallment = data?.plan?.firstInstallment;
  const totalAmountCents = purchaseTotalCents ?? amountInAccountCurrencyCents * totalInstallments;

  return (
    <section className="space-y-2 rounded-md border border-border p-3">
      <h3 className="font-medium">
        {t('transactionDetail.installmentPlan', {
          current: installmentNumber,
          total: totalInstallments,
        })}
      </h3>
      <p className="text-sm text-muted-foreground">
        <InstallmentPlanTotalAmount
          totalAmountCents={totalAmountCents}
          currency={accountCurrency}
        />
        {' · '}
        <InstallmentPlanDateLine
          purchaseDate={purchaseDate}
          firstInstallment={firstInstallment}
          onOpenTransaction={onOpenTransaction}
          isPending={isPending}
          isError={isError}
        />
      </p>
      {!isPending && firstInstallment ? (
        <InstallmentFirstInstallmentDetails firstInstallment={firstInstallment} />
      ) : null}
    </section>
  );
}

function ForeignCurrencyDetails({ transaction }: { readonly transaction: TransactionDetailRow }) {
  const { t, i18n } = useTranslation();
  const hasForeignAmount = isForeignCurrencyTransaction(
    transaction.currency,
    transaction.account_currency,
  );

  const exchangeRateLabel = useMemo(() => {
    if (!hasForeignAmount) {
      return null;
    }
    const accountAmountCents = transaction.amount_in_account_currency_cents;
    const exchangeRate = computeForeignExchangeRate(transaction.amount_cents, accountAmountCents);
    if (exchangeRate === null) {
      return null;
    }
    const formattedRate = Intl.NumberFormat(i18n.language, {
      minimumFractionDigits: 4,
      maximumFractionDigits: 4,
    }).format(exchangeRate);
    return `1 ${transaction.currency} = ${formattedRate} ${transaction.account_currency}`;
  }, [
    hasForeignAmount,
    i18n.language,
    transaction.account_currency,
    transaction.amount_cents,
    transaction.amount_in_account_currency_cents,
    transaction.currency,
  ]);

  if (!hasForeignAmount) {
    return null;
  }

  const accountAmountCents = transaction.amount_in_account_currency_cents;

  return (
    <p className="rounded-md border border-border p-3 text-sm">
      <span className="mr-2 font-medium">{t('transactionDetail.foreignCurrency')}</span>
      <FormattedCurrency amountCents={transaction.amount_cents} currency={transaction.currency} />
      <span className="mx-2 text-muted-foreground">→</span>
      <FormattedCurrency amountCents={accountAmountCents} currency={transaction.account_currency} />
      {exchangeRateLabel ? (
        <span className="ml-2 text-muted-foreground">· {exchangeRateLabel}</span>
      ) : null}
    </p>
  );
}

function LinkedTransferSummary({ related }: { readonly related: TransferRelatedLeg | null }) {
  const { t, i18n } = useTranslation();
  if (!related) {
    return null;
  }

  const amountLabel = isForeignCurrencyTransaction(related.currency, related.account_currency)
    ? formatDualCurrencyAmount(
        related.amount_cents,
        related.currency,
        related.account_currency,
        related.amount_in_account_currency_cents,
        i18n.language,
      )
    : formatCurrencyAmount(
        related.amount_in_account_currency_cents,
        related.account_currency,
        i18n.language,
      );
  const dateLabel = formatRelativeOrAbsoluteDate(related.occurred_at, i18n.language);

  return (
    <div className="space-y-1 rounded bg-muted/40 p-2">
      <div className="font-medium">{related.account_display_name}</div>
      <div className="text-muted-foreground">
        {dateLabel} · {amountLabel}
      </div>
      <div>{related.merchant_name ?? related.display_name}</div>
      {related.description && <div className="text-muted-foreground">{related.description}</div>}
      {related.category_presentation && (
        <CategoryPathBadge presentation={related.category_presentation} />
      )}
      <div className="text-xs text-muted-foreground">
        {t('transfers.role')}: {related.role.replace(/_/g, ' ')}
      </div>
    </div>
  );
}

export type TransactionEditTitleMeta = {
  readonly confidence: number | null;
  readonly usedClassifier: boolean;
};

function TransactionPermalinkControls({ transactionId }: { readonly transactionId: string }) {
  const { t } = useTranslation();
  const { transactionId: routeTransactionId, openTransactionPermalink } = useAppNavigation();
  const onPermalink = routeTransactionId === transactionId;

  return (
    <span className="inline-flex items-center gap-0.5">
      <ActionIconButton
        label={t('transactionPermalink.copyLink')}
        onClick={() => {
          void navigator.clipboard.writeText(transactionPermalinkUrl(transactionId)).then(
            () => {
              toast.success(t('transactionPermalink.linkCopied'));
            },
            () => {
              toast.error(t('toast.error'));
            },
          );
        }}
      >
        <MdContentCopy className="size-4" />
      </ActionIconButton>
      {onPermalink ? null : (
        <ActionIconButton
          label={t('transactionPermalink.open')}
          onClick={() => openTransactionPermalink(transactionId)}
        >
          <MdOpenInNew className="size-4" />
        </ActionIconButton>
      )}
    </span>
  );
}

export function TransactionEditTitle({
  transaction,
  meta,
}: {
  readonly transaction: TransactionDetailRow;
  readonly meta?: TransactionEditTitleMeta;
}) {
  const { t } = useTranslation();
  const { entity: account, isLoading: accountLoading } = useEntityRef(
    'accounts',
    transaction.account_id,
  );
  const cardNumber = useMemo(
    () => readTransactionCardNumber(transaction.raw_json, account),
    [account, transaction.raw_json],
  );
  const installmentNumber =
    transaction.installment_number ?? transaction.credit_card?.installment_number ?? null;
  const totalInstallments =
    transaction.total_installments ?? transaction.credit_card?.total_installments ?? null;
  const purchaseDate = transaction.credit_card?.purchase_date?.slice(0, 10) ?? null;
  const showInstallmentTitle =
    installmentNumber !== null && totalInstallments !== null && totalInstallments > 1;

  return (
    <span className="flex flex-col gap-1">
      <span className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <FormattedDateTime value={transaction.display_occurred_at ?? transaction.occurred_at} />
        {showInstallmentTitle ? (
          <span className="text-muted-foreground tabular-nums">
            ({installmentNumber}/{totalInstallments}
            {purchaseDate ? (
              <>
                {' @ '}
                <FormattedDate value={purchaseDate} />
              </>
            ) : null}
            )
          </span>
        ) : null}
        <ForeignCurrencyAmount
          amountCents={transaction.amount_cents}
          currency={transaction.currency}
          accountCurrency={transaction.account_currency}
          amountInAccountCurrencyCents={transaction.amount_in_account_currency_cents}
        />
        <span>
          {accountLoading
            ? '…'
            : String(account?.display_name ?? account?.name ?? transaction.account_id)}
          {cardNumber ? <span className="ml-2 text-muted-foreground">{cardNumber}</span> : null}
        </span>
        <TransactionPermalinkControls transactionId={transaction.id} />
      </span>
      {meta ? (
        <span className="flex flex-wrap gap-x-3 gap-y-1 text-xs font-normal text-muted-foreground">
          {meta.confidence !== null && (
            <span>
              {t('triage.confidence')}: <Confidence value={meta.confidence} />
            </span>
          )}
          {meta.usedClassifier && <span>{t('triage.usedClassifier')}</span>}
        </span>
      ) : null}
    </span>
  );
}

export type TransactionDetailContentProps = {
  readonly transaction: TransactionDetailRow;
  readonly active: boolean;
  readonly locale: string;
  readonly assistReasoning: string | null;
  readonly categoryOverrideId: string;
  readonly onCategoryOverrideIdChange: (value: string) => void;
  readonly annotationCategoryId: string;
  readonly onAnnotationCategoryIdChange: (value: string) => void;
  readonly annotationSubCategoryId: string;
  readonly onAnnotationSubCategoryIdChange: (value: string) => void;
  readonly selectedLabelIds: readonly string[];
  readonly onSelectedLabelIdsChange: (value: readonly string[]) => void;
  readonly notes: string;
  readonly onNotesChange: (value: string) => void;
  readonly onBillLinkSaved: () => void | Promise<void>;
  readonly onOpenTransaction?: (transactionId: string) => void | Promise<void>;
  readonly onUnlinkTransfer: (groupId: string) => void;
  readonly unlinkPending: boolean;
};

function PendingTransferSection({
  transactionId,
  linked,
}: {
  readonly transactionId: string;
  readonly linked: boolean;
}) {
  const { t } = useTranslation();
  const { data } = useQuery({
    queryKey: ['transfer-suggestion', transactionId],
    queryFn: () =>
      apiJson<{ suggestion: TransferPairProposal | null }>(
        `/api/transfers/suggestions/${transactionId}`,
      ),
  });
  const queryClient = useQueryClient();
  const confirmTransfer = useMutation({
    mutationFn: (pair: TransferPairProposal) =>
      apiJson('/api/transfers/confirm', {
        method: 'POST',
        body: JSON.stringify({ pairs: [pair] }),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['transactions'] });
      void queryClient.invalidateQueries({ queryKey: ['transfer-suggestion', transactionId] });
    },
  });
  const suggestion = data?.suggestion;
  if (!suggestion || linked) return null;
  return (
    <section className="space-y-2 rounded-md border border-primary/40 bg-primary/5 p-3">
      <h3 className="font-medium">{t('transactionDetail.pendingTransfer')}</h3>
      <p className="text-sm text-muted-foreground">
        {t('transactionDetail.pendingTransferDescription')}
      </p>
      <button
        type="button"
        className="rounded bg-primary px-2 py-1 text-xs text-primary-foreground disabled:opacity-50"
        disabled={confirmTransfer.isPending}
        onClick={() => confirmTransfer.mutate(suggestion)}
      >
        {t('transactionDetail.confirmTransfer')}
      </button>
    </section>
  );
}

export function TransactionDetailContent({
  transaction,
  active,
  locale,
  assistReasoning,
  categoryOverrideId,
  onCategoryOverrideIdChange,
  annotationCategoryId,
  onAnnotationCategoryIdChange,
  annotationSubCategoryId,
  onAnnotationSubCategoryIdChange,
  selectedLabelIds,
  onSelectedLabelIdsChange,
  notes,
  onNotesChange,
  onBillLinkSaved,
  onOpenTransaction,
  onUnlinkTransfer,
  unlinkPending,
}: TransactionDetailContentProps) {
  const { t } = useTranslation();
  const paymentDocuments = useMemo(
    () => readPaymentDocumentsFromRawJson(transaction.raw_json),
    [transaction.raw_json],
  );

  return (
    <div className="min-w-0 space-y-4 text-sm">
      <section className="min-w-0 space-y-1">
        <DetailField label={t('columns.merchant')}>
          {transaction.merchant_detail?.business_name ??
            transaction.merchant_name ??
            transaction.display_name}
        </DetailField>
        {transaction.merchant_detail?.business_name &&
        transaction.merchant_name &&
        transaction.merchant_detail.business_name !== transaction.merchant_name ? (
          <DetailField label={t('columns.description')}>{transaction.merchant_name}</DetailField>
        ) : null}
        <DetailField label={t('columns.description')}>
          {transaction.display_description ?? transaction.description ?? '—'}
        </DetailField>
        {transaction.credit_card?.payee_mcc != null || transaction.credit_card?.payee_mcc_name ? (
          <DetailField label={t('columns.mcc')}>
            {transaction.credit_card.payee_mcc_name ?? '—'}
            {transaction.credit_card.payee_mcc != null ? (
              <span className="text-muted-foreground"> ({transaction.credit_card.payee_mcc})</span>
            ) : null}
          </DetailField>
        ) : null}
        {transaction.credit_card?.purchase_date ? (
          <DetailField label={t('columns.purchaseDate')}>
            <FormattedDate value={transaction.credit_card.purchase_date.slice(0, 10)} />
          </DetailField>
        ) : null}
        {paymentDocuments.receiverName &&
        !paymentDocuments.receiver &&
        paymentDocuments.receiverName !== transaction.merchant_name ? (
          <DetailField label={t('transactionDetail.receiverName')}>
            {paymentDocuments.receiverName}
          </DetailField>
        ) : null}
        <PaymentDocumentFields
          payer={paymentDocuments.payer}
          receiver={paymentDocuments.receiver}
        />
      </section>

      {assistReasoning ? (
        <p className="rounded bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
          {assistReasoning}
        </p>
      ) : null}

      <ForeignCurrencyDetails transaction={transaction} />

      <CreditCardBillSection
        transaction={transaction}
        active={active}
        onBillLinkSaved={onBillLinkSaved}
      />

      {transaction.installment_number !== null &&
        transaction.total_installments !== null &&
        transaction.total_installments > 1 &&
        transaction.installment_number > 1 && (
          <InstallmentPlanSummary
            transactionId={transaction.id}
            installmentNumber={transaction.installment_number}
            totalInstallments={transaction.total_installments}
            amountInAccountCurrencyCents={transaction.amount_in_account_currency_cents}
            accountCurrency={transaction.account_currency}
            purchaseDate={transaction.credit_card?.purchase_date}
            purchaseTotalCents={transaction.credit_card?.purchase_total_cents}
            onOpenTransaction={onOpenTransaction}
            enabled={active}
            locale={locale}
          />
        )}

      <TransactionClassificationForm
        transaction={transaction}
        categoryOverrideId={categoryOverrideId}
        onCategoryOverrideIdChange={onCategoryOverrideIdChange}
        annotationCategoryId={annotationCategoryId}
        onAnnotationCategoryIdChange={onAnnotationCategoryIdChange}
        annotationSubCategoryId={annotationSubCategoryId}
        onAnnotationSubCategoryIdChange={onAnnotationSubCategoryIdChange}
        selectedLabelIds={selectedLabelIds}
        onSelectedLabelIdsChange={onSelectedLabelIdsChange}
        notes={notes}
        onNotesChange={onNotesChange}
        enabled={active}
      />

      <PendingTransferSection
        transactionId={transaction.id}
        linked={Boolean(transaction.transfer_group)}
      />

      {transaction.transfer_group?.related && (
        <section className="space-y-2 rounded-md border border-border p-3">
          <div className="flex items-center justify-between gap-2">
            <h3 className="font-medium">{t('transactionDetail.linkedTransfer')}</h3>
            <button
              type="button"
              className="rounded border border-border px-2 py-0.5 text-xs hover:bg-accent"
              disabled={unlinkPending}
              onClick={() => onUnlinkTransfer(transaction.transfer_group?.id ?? '')}
            >
              {t('transactionDetail.unlink')}
            </button>
          </div>
          <LinkedTransferSummary related={transaction.transfer_group.related} />
        </section>
      )}

      <details className="rounded-md border border-border p-3">
        <summary className="cursor-pointer font-medium">{t('classify.rawJson')}</summary>
        <pre className="mt-2 max-h-64 overflow-auto rounded bg-muted p-2 text-xs">
          {formatTransactionRawJson(transaction.raw_json)}
        </pre>
      </details>
    </div>
  );
}
