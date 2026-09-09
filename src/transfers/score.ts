export const DEFAULT_TRANSFER_WINDOW_HOURS = 24;
export const DEFAULT_TRANSFER_FEE_TOLERANCE_CENTS = 500;

export type TransferScoreInput = {
  readonly amountCentsLeft: number;
  readonly amountCentsRight: number;
  readonly occurredAtLeft: string;
  readonly occurredAtRight: string;
};

export type TransferScoreOptions = {
  readonly maxAmountDiffCents: number;
  readonly maxTimeMs: number;
};

export type TransferScoreBreakdown = {
  readonly amount: number;
  readonly time: number;
  readonly confidence: number;
};

export function linearTransferComponentScore(delta: number, maxDelta: number): number {
  if (maxDelta <= 0) {
    return delta <= 0 ? 1 : 0;
  }
  if (delta <= 0) {
    return 1;
  }
  if (delta >= maxDelta) {
    return 0;
  }
  return 1 - delta / maxDelta;
}

export function scoreTransferPairComponents(
  input: TransferScoreInput,
  options: TransferScoreOptions,
): TransferScoreBreakdown {
  const amountDelta = Math.abs(Math.abs(input.amountCentsLeft) - Math.abs(input.amountCentsRight));
  const timeDelta = Math.abs(Date.parse(input.occurredAtLeft) - Date.parse(input.occurredAtRight));
  const amount = linearTransferComponentScore(amountDelta, options.maxAmountDiffCents);
  const time = linearTransferComponentScore(timeDelta, options.maxTimeMs);
  const confidence = (amount + time) / 2;
  return { amount, time, confidence };
}

export function formatTransferConfidencePercent(confidence: number): string {
  return `${Math.round(confidence * 100)}%`;
}
