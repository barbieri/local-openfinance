import { useEntityRef } from '../../hooks/use-entity-ref.js';
import type { TransactionRow } from './transactions-page-types.js';

export function TransactionTableAccountCell({ accountId }: { readonly accountId: string }) {
  const { entity, isLoading } = useEntityRef('accounts', accountId);
  if (isLoading) {
    return <span className="text-muted-foreground">…</span>;
  }
  return <span>{String(entity?.display_name ?? accountId)}</span>;
}

export function TransactionTableInstallmentCell({ row }: { readonly row: TransactionRow }) {
  if (row.installment_number === null || row.total_installments === null) {
    return <>—</>;
  }
  return (
    <span className="tabular-nums">
      {row.installment_number}/{row.total_installments}
    </span>
  );
}
