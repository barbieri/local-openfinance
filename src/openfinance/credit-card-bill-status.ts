import { resolveLocalTimeZone, toLocalDateKey } from '../utils/local-date.js';

const ZERO_TOTAL_PAST_DUE_STATUSES = new Set(['PAST_DUE_UNCONFIRMED', 'PAST_DUE_UNPAID']);

export function resolveImportedCreditCardBillPaymentStatus(input: {
  readonly paymentStatus: string | null;
  readonly totalAmountCents: number | null;
  readonly dueDate: string | null;
  readonly referenceDate?: Date | undefined;
  readonly timeZone?: string | undefined;
}): string | null {
  const paymentStatus = input.paymentStatus;
  if (!paymentStatus) {
    return paymentStatus;
  }

  const normalizedStatus = paymentStatus.toUpperCase();
  if (!ZERO_TOTAL_PAST_DUE_STATUSES.has(normalizedStatus)) {
    return paymentStatus;
  }

  if (input.totalAmountCents === null || input.totalAmountCents > 0) {
    return paymentStatus;
  }

  if (!input.dueDate) {
    return paymentStatus;
  }

  const timeZone = input.timeZone ?? resolveLocalTimeZone();
  const referenceDate = input.referenceDate ?? new Date();
  if (!isDueDateInPast(input.dueDate, referenceDate, timeZone)) {
    return paymentStatus;
  }

  return 'PAID';
}

function isDueDateInPast(dueDate: string, referenceDate: Date, timeZone: string): boolean {
  const dueDateKey = toLocalDateKey(dueDate, timeZone);
  const referenceDateKey = toLocalDateKey(referenceDate.toISOString(), timeZone);
  return dueDateKey < referenceDateKey;
}
