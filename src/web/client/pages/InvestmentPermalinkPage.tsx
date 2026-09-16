import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { FormattedDate, FormattedDateTime } from '../components/format/dates.js';
import { FormattedCurrency } from '../components/format/FormattedCurrency.js';
import { FormattedNumber } from '../components/format/numbers.js';
import { SoftDeleteDialog } from '../components/ui/SoftDeleteDialog.js';
import { apiJson } from '../lib/api.js';
import { useAppNavigation } from '../lib/navigation.js';

type InvestmentDetail = {
  readonly db: Record<string, string | number | null>;
  readonly parsed: Record<string, string | number | null>;
  readonly raw_json: unknown;
};

type DialogAction = 'delete' | 'restore';

export function InvestmentPermalinkPage() {
  const { t } = useTranslation();
  const { investmentId, closeInvestmentPermalink } = useAppNavigation();
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['investment-detail', investmentId],
    queryFn: () => apiJson<{ investment: InvestmentDetail }>(`/api/investments/${investmentId}`),
    enabled: investmentId !== null,
  });
  const investment = data?.investment ?? null;

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <button
        type="button"
        className="rounded border px-3 py-1.5 text-sm"
        onClick={closeInvestmentPermalink}
      >
        {t('investmentPermalink.back')}
      </button>

      {investmentId === null || isLoading ? <LoadingMessage /> : null}
      {isError ? <ErrorMessage message={error} /> : null}
      {!isLoading && !isError && !investment ? <NotFoundMessage /> : null}
      {investment && investmentId ? (
        <InvestmentArticle investment={investment} investmentId={investmentId} />
      ) : null}
    </div>
  );
}

function LoadingMessage() {
  const { t } = useTranslation();
  return <p className="text-sm text-muted-foreground">{t('triage.loading')}</p>;
}

function ErrorMessage({ message }: { readonly message: unknown }) {
  const { t } = useTranslation();
  return (
    <p className="text-sm text-destructive">
      {message instanceof Error ? message.message : t('investmentPermalink.notFound')}
    </p>
  );
}

function NotFoundMessage() {
  const { t } = useTranslation();
  return <p className="text-sm text-destructive">{t('investmentPermalink.notFound')}</p>;
}

function InvestmentArticle({
  investment,
  investmentId,
}: {
  readonly investment: InvestmentDetail;
  readonly investmentId: string;
}) {
  const [dialogAction, setDialogAction] = useState<DialogAction | null>(null);
  const deletedAt = asString(investment.db.deleted_at);
  const deleteMutation = useInvestmentDelete(investmentId, () => setDialogAction(null));
  const restoreMutation = useInvestmentRestore(investmentId, () => setDialogAction(null));

  return (
    <article className="space-y-4 rounded-lg border border-border bg-background p-4 shadow-sm">
      <DeletedInvestmentBanner
        deletedAt={deletedAt}
        reason={asString(investment.db.delete_reason)}
      />
      <InvestmentHeading investment={investment} investmentId={investmentId} />
      <InvestmentDetails investment={investment} />
      <RawInvestmentJson rawJson={investment.raw_json} />
      <InvestmentVisibilityAction
        deleted={deletedAt !== null}
        onDelete={() => setDialogAction('delete')}
        onRestore={() => setDialogAction('restore')}
      />
      <InvestmentDeletionDialog
        action={dialogAction}
        deletePending={deleteMutation.isPending}
        restorePending={restoreMutation.isPending}
        onClose={() => setDialogAction(null)}
        onDelete={(reason) => deleteMutation.mutate(reason)}
        onRestore={() => restoreMutation.mutate()}
      />
    </article>
  );
}

function useInvestmentDelete(investmentId: string, onSuccess: () => void) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (deleteReason: string) =>
      apiJson(`/api/investments/${investmentId}/delete`, {
        method: 'POST',
        body: JSON.stringify({ deleteReason }),
      }),
    onSuccess: async () => {
      toast.success(t('investmentPermalink.deleted'));
      onSuccess();
      await queryClient.invalidateQueries({ queryKey: ['investment-detail', investmentId] });
      await queryClient.invalidateQueries({ queryKey: ['investments'] });
    },
    onError: (error: Error) => {
      toast.error(t('toast.error'), { description: error.message, duration: Infinity });
    },
  });
}

function useInvestmentRestore(investmentId: string, onSuccess: () => void) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () =>
      apiJson<{ investmentId: string; restored: boolean }>(
        `/api/investments/${investmentId}/restore`,
        { method: 'POST' },
      ),
    onSuccess: async () => {
      toast.success(t('investmentPermalink.restored'));
      onSuccess();
      await queryClient.invalidateQueries({ queryKey: ['investment-detail', investmentId] });
      await queryClient.invalidateQueries({ queryKey: ['investments'] });
    },
    onError: (error: Error) => {
      toast.error(t('toast.error'), { description: error.message, duration: Infinity });
    },
  });
}

function DeletedInvestmentBanner({
  deletedAt,
  reason,
}: {
  readonly deletedAt: string | null;
  readonly reason: string | null;
}) {
  const { t } = useTranslation();
  if (!deletedAt) {
    return null;
  }
  return (
    <section className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm">
      <h2 className="font-semibold">{t('investmentPermalink.deletedBanner')}</h2>
      <p>
        {t('softDelete.deletedAt')} <FormattedDateTime value={deletedAt} />
      </p>
      {reason ? <p>{t('softDelete.deletedReason', { reason })}</p> : null}
    </section>
  );
}

function InvestmentHeading({
  investment,
  investmentId,
}: {
  readonly investment: InvestmentDetail;
  readonly investmentId: string;
}) {
  return (
    <header className="border-b border-border pb-3">
      <h1 className="text-xl font-semibold">
        {asString(investment.parsed.display_name) ?? asString(investment.db.name) ?? investmentId}
      </h1>
      <p className="text-sm text-muted-foreground">
        {asString(investment.parsed.connection_display_name) ?? '—'}
      </p>
    </header>
  );
}

function RawInvestmentJson({ rawJson }: { readonly rawJson: unknown }) {
  const { t } = useTranslation();
  return (
    <details className="rounded border border-border p-3">
      <summary className="cursor-pointer font-medium">{t('classify.rawJson')}</summary>
      <pre className="mt-3 max-h-96 overflow-auto rounded bg-muted p-3 text-xs">
        {JSON.stringify(rawJson, null, 2)}
      </pre>
    </details>
  );
}

function InvestmentVisibilityAction({
  deleted,
  onDelete,
  onRestore,
}: {
  readonly deleted: boolean;
  readonly onDelete: () => void;
  readonly onRestore: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex justify-end">
      <button
        type="button"
        className={
          deleted
            ? 'rounded bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground'
            : 'rounded bg-destructive px-3 py-1.5 text-sm font-medium text-destructive-foreground'
        }
        onClick={deleted ? onRestore : onDelete}
      >
        {deleted ? t('softDelete.restore') : t('softDelete.delete')}
      </button>
    </div>
  );
}

function InvestmentDeletionDialog({
  action,
  deletePending,
  restorePending,
  onClose,
  onDelete,
  onRestore,
}: {
  readonly action: DialogAction | null;
  readonly deletePending: boolean;
  readonly restorePending: boolean;
  readonly onClose: () => void;
  readonly onDelete: (reason: string) => void;
  readonly onRestore: () => void;
}) {
  const { t } = useTranslation();

  if (action === null) {
    return null;
  }
  if (action === 'delete') {
    return (
      <SoftDeleteDialog
        open
        title={t('investmentPermalink.deleteTitle')}
        description={t('investmentPermalink.deleteDescription')}
        pending={deletePending}
        onClose={onClose}
        onConfirm={onDelete}
      />
    );
  }
  return (
    <SoftDeleteDialog
      open
      mode="restore"
      title={t('investmentPermalink.restoreTitle')}
      description={t('investmentPermalink.restoreDescription')}
      pending={restorePending}
      onClose={onClose}
      onConfirm={onRestore}
    />
  );
}

function InvestmentDetails({ investment }: { readonly investment: InvestmentDetail }) {
  const { t } = useTranslation();
  const currency = asString(investment.db.currency) ?? 'BRL';
  const fields = [...Object.entries(investment.db), ...Object.entries(investment.parsed)].filter(
    ([key]) => key !== 'deleted_at' && key !== 'delete_reason',
  );

  return (
    <section>
      <h2 className="mb-2 text-sm font-semibold">{t('investmentPermalink.details')}</h2>
      <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
        {fields.map(([key, value]) => (
          <div key={key} className="min-w-0">
            <dt className="text-xs font-medium text-muted-foreground">{formatFieldName(key)}</dt>
            <dd className="break-words text-sm">{formatValue(key, value, currency)}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function formatValue(key: string, value: string | number | null, currency: string) {
  if (value === null) {
    return '—';
  }
  if (key.endsWith('_cents') && typeof value === 'number') {
    return <FormattedCurrency amountCents={value} currency={currency} signed={false} />;
  }
  if (key.endsWith('_date') && typeof value === 'string') {
    return <FormattedDate value={value} />;
  }
  if (typeof value === 'number') {
    return <FormattedNumber value={value} />;
  }
  return value || '—';
}

function formatFieldName(key: string): string {
  return key.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function asString(value: string | number | null | undefined): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}
