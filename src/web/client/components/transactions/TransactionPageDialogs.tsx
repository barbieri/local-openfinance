import { ClassifyWizard } from '../classify-wizard/ClassifyWizard.js';
import type { DetectTransfersSummary, TransferPairProposal } from './DetectTransfersDialog.js';
import { DetectTransfersDialog } from './DetectTransfersDialog.js';
import { TransactionDetailDialog } from './TransactionDetailDialog.js';
import type { TransactionRow } from './transactions-page-types.js';

export function TransactionPageDialogs({
  detailTransaction,
  detailEditIds,
  onCloseDetail,
  onDetailSaved,
  onOpenTransaction,
  currentClassify,
  onCloseClassify,
  onClassifySaved,
  detectOpen,
  detectProposals,
  detectSummary,
  accountNames,
  onCloseDetect,
  onDetectLinked,
}: {
  readonly detailTransaction: TransactionRow | null;
  readonly detailEditIds: readonly string[];
  readonly onCloseDetail: () => void;
  readonly onDetailSaved: () => Promise<void>;
  readonly onOpenTransaction: (transactionId: string) => Promise<void>;
  readonly currentClassify: TransactionRow | undefined;
  readonly onCloseClassify: () => void;
  readonly onClassifySaved: () => void;
  readonly detectOpen: boolean;
  readonly detectProposals: readonly TransferPairProposal[];
  readonly detectSummary: DetectTransfersSummary | null;
  readonly accountNames: Record<string, string>;
  readonly onCloseDetect: () => void;
  readonly onDetectLinked: () => void;
}) {
  return (
    <>
      <TransactionDetailDialog
        transaction={detailTransaction}
        selectedTransactionIds={detailEditIds}
        open={detailTransaction !== null}
        onClose={onCloseDetail}
        onSaved={onDetailSaved}
        onOpenTransaction={onOpenTransaction}
      />

      {currentClassify && (
        <ClassifyWizard
          entry={currentClassify}
          onClose={onCloseClassify}
          onSaved={onClassifySaved}
        />
      )}

      <DetectTransfersDialog
        open={detectOpen}
        proposals={detectProposals}
        summary={detectSummary}
        accountNames={accountNames}
        onClose={onCloseDetect}
        onLinked={onDetectLinked}
      />
    </>
  );
}
