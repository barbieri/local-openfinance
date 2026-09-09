import { useQuery } from '@tanstack/react-query';
import { apiJson } from '../../lib/api.js';
import type { LabelRecord } from '../labels/LabelEditDialog.js';
import { Dialog } from '../ui/Dialog.js';
import { TransactionEditPanel } from './TransactionEditPanel.js';
import { TransactionEditTitle } from './transaction-detail-content.js';
import type { TransactionDetailRow } from './transaction-detail-types.js';

export type { TransactionDetailRow } from './transaction-detail-types.js';

const EMPTY_SELECTED_TRANSACTION_IDS: readonly string[] = [];

export function TransactionDetailDialog({
  transaction,
  selectedTransactionIds = EMPTY_SELECTED_TRANSACTION_IDS,
  open,
  onClose,
  onSaved,
  onOpenTransaction,
}: {
  readonly transaction: TransactionDetailRow | null;
  readonly selectedTransactionIds?: readonly string[];
  readonly open: boolean;
  readonly onClose: () => void;
  readonly onSaved: () => void | Promise<void>;
  readonly onOpenTransaction?: (transactionId: string) => void | Promise<void>;
}) {
  const { data: annotationLabelsData } = useQuery({
    queryKey: ['annotation-labels'],
    queryFn: () => apiJson<{ byId: Record<string, LabelRecord> }>('/api/annotation-labels'),
    enabled: open,
  });

  const labelById = annotationLabelsData?.byId ?? {};

  if (!transaction) {
    return null;
  }

  return (
    <Dialog
      open={open}
      size="wide"
      title={<TransactionEditTitle transaction={transaction} />}
      onClose={onClose}
    >
      <TransactionEditPanel
        transaction={transaction}
        mode="detail"
        active={open}
        showHeader={false}
        labelById={labelById}
        selectedTransactionIds={selectedTransactionIds}
        onOpenTransaction={onOpenTransaction}
        onDismiss={onClose}
        onSaved={onSaved}
      />
    </Dialog>
  );
}
