export const TRANSACTION_COLUMN_KEYS = [
  'select',
  'date',
  'account',
  'merchant',
  'description',
  'category',
  'labels',
  'installments',
  'amount',
  'transfer',
] as const;

export type TransactionColumnKey = (typeof TRANSACTION_COLUMN_KEYS)[number];
