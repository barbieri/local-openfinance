import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { apiJson } from '../../lib/api.js';
import { Confidence } from '../format/Confidence.js';
import { FormattedCurrency } from '../format/FormattedCurrency.js';
import { Dialog } from '../ui/Dialog.js';

export type TransferLeg = {
  readonly id: string;
  readonly accountId: string;
  readonly occurredAt: string;
  readonly amountCents: number;
  readonly merchantName: string | null;
  readonly description: string | null;
};

export type TransferPairProposal = {
  readonly source: TransferLeg;
  readonly destination: TransferLeg;
  readonly kind: string;
  readonly confidence: number;
  readonly amountConfidence: number;
  readonly timeConfidence: number;
};

export type DetectTransfersSummary = {
  readonly groupsCreated: number;
  readonly membersLinked: number;
  readonly candidatesScanned: number;
  readonly proposed: number;
  readonly skipped: number;
};

type DetectTransfersDialogProps = {
  readonly open: boolean;
  readonly proposals: readonly TransferPairProposal[];
  readonly summary: DetectTransfersSummary | null;
  readonly accountNames: Readonly<Record<string, string>>;
  readonly onClose: () => void;
  readonly onLinked: () => void;
};

function pairKey(proposal: TransferPairProposal): string {
  return `${proposal.source.id}:${proposal.destination.id}`;
}

export function DetectTransfersDialog({
  open,
  proposals: initialProposals,
  summary,
  accountNames,
  onClose,
  onLinked,
}: DetectTransfersDialogProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [state, setState] = useState({
    proposals: initialProposals,
    prevOpen: open,
    prevInitialProposals: initialProposals,
  });

  if (open && (open !== state.prevOpen || initialProposals !== state.prevInitialProposals)) {
    setState({
      proposals: initialProposals,
      prevOpen: open,
      prevInitialProposals: initialProposals,
    });
  } else if (!open && state.prevOpen) {
    setState((prev) => ({ ...prev, prevOpen: false }));
  }

  const { proposals } = state;

  const linkMutation = useMutation({
    mutationFn: (pairs: readonly TransferPairProposal[]) =>
      apiJson<{ linked: number }>('/api/transfers/confirm', {
        method: 'POST',
        body: JSON.stringify({ pairs }),
      }),
    onSuccess: (result, pairs) => {
      toast.success(t('detectTransfers.linked', { count: result.linked }));
      const linkedKeys = new Set(pairs.map(pairKey));
      setState((prev) => ({
        ...prev,
        proposals: prev.proposals.filter((proposal) => !linkedKeys.has(pairKey(proposal))),
      }));
      void queryClient.invalidateQueries({ queryKey: ['transactions'] });
      onLinked();
    },
    onError: (error: Error) => {
      toast.error(t('toast.error'), { description: error.message, duration: Infinity });
    },
  });

  return (
    <Dialog
      open={open}
      title={t('detectTransfers.title')}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="rounded border px-3 py-1 text-sm" onClick={onClose}>
            {t('dialog.cancel')}
          </button>
          <button
            type="button"
            className="rounded bg-primary px-3 py-1 text-sm text-primary-foreground disabled:opacity-50"
            disabled={proposals.length === 0 || linkMutation.isPending}
            onClick={() => linkMutation.mutate(proposals)}
          >
            {t('detectTransfers.linkAll', { count: proposals.length })}
          </button>
        </>
      }
    >
      {summary && (
        <p className="mb-3 text-sm text-muted-foreground">
          {t('detectTransfers.summary', {
            scanned: summary.candidatesScanned,
            proposed: summary.proposed,
          })}
        </p>
      )}
      {proposals.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('detectTransfers.none')}</p>
      ) : (
        <ul className="space-y-3">
          {proposals.map((proposal) => (
            <li key={pairKey(proposal)} className="rounded border border-border p-3">
              <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <span className="rounded bg-muted px-1.5 py-0.5 font-medium uppercase">
                  {proposal.kind.replace(/_/g, ' ')}
                </span>
                <span>
                  <Trans
                    i18nKey="detectTransfers.confidence"
                    components={{
                      confidence: <Confidence value={proposal.confidence} />,
                    }}
                  />
                </span>
                <span className="text-muted-foreground">
                  <Trans
                    i18nKey="detectTransfers.confidenceBreakdown"
                    components={{
                      amount: <Confidence value={proposal.amountConfidence} />,
                      time: <Confidence value={proposal.timeConfidence} />,
                    }}
                  />
                </span>
              </div>
              <TransferLegLine
                label={t('detectTransfers.outLeg')}
                leg={proposal.source}
                accountName={accountNames[proposal.source.accountId]}
              />
              <TransferLegLine
                label={t('detectTransfers.inLeg')}
                leg={proposal.destination}
                accountName={accountNames[proposal.destination.accountId]}
              />
              <div className="mt-2 flex gap-2">
                <button
                  type="button"
                  className="rounded bg-primary px-2 py-1 text-xs text-primary-foreground disabled:opacity-50"
                  disabled={linkMutation.isPending}
                  onClick={() => linkMutation.mutate([proposal])}
                >
                  {t('detectTransfers.link')}
                </button>
                <button
                  type="button"
                  className="rounded border px-2 py-1 text-xs"
                  disabled={linkMutation.isPending}
                  onClick={() =>
                    setState((prev) => ({
                      ...prev,
                      proposals: prev.proposals.filter(
                        (item) => pairKey(item) !== pairKey(proposal),
                      ),
                    }))
                  }
                >
                  {t('detectTransfers.skip')}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Dialog>
  );
}

function TransferLegLine({
  label,
  leg,
  accountName,
}: {
  readonly label: string;
  readonly leg: TransferLeg;
  readonly accountName: string | undefined;
}) {
  const description = leg.merchantName ?? leg.description ?? '—';
  return (
    <div className="text-sm">
      <span className="font-medium text-muted-foreground">{label}: </span>
      <span>{accountName ?? leg.accountId}</span>
      <span className="text-muted-foreground"> · </span>
      <FormattedCurrency amountCents={leg.amountCents} currency="BRL" />
      <span className="text-muted-foreground">
        {' '}
        · {leg.occurredAt.slice(0, 16).replace('T', ' ')}
      </span>
      <div className="truncate text-xs text-muted-foreground">{description}</div>
    </div>
  );
}
