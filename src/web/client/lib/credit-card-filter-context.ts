export function isCreditCardAccount(row: Record<string, unknown>): boolean {
  return String(row['type'] ?? '').toUpperCase() === 'CREDIT';
}

export function isCreditCardFilterContext(
  accounts: readonly Record<string, unknown>[],
  selectedAccountIds: readonly string[],
): boolean {
  if (selectedAccountIds.length > 0) {
    const selected = new Set(selectedAccountIds);
    return accounts.some(
      (account) => selected.has(String(account['id'])) && isCreditCardAccount(account),
    );
  }
  return accounts.some((account) => isCreditCardAccount(account));
}

export function resolveCreditCardBillFilterLabel(input: {
  readonly accounts: readonly Record<string, unknown>[];
  readonly bills: readonly Record<string, unknown>[];
  readonly billId: string;
}): string | null {
  const bill = input.bills.find((row) => String(row['id']) === input.billId);
  if (!bill) {
    return null;
  }
  const accountId = String(bill['account_id'] ?? '');
  const account = input.accounts.find((row) => String(row['id']) === accountId);
  const accountName = String(account?.['display_name'] ?? account?.['name'] ?? accountId);
  const dueDate = String(bill['due_date'] ?? '').slice(0, 10);
  return dueDate ? `${accountName} · ${dueDate}` : accountName;
}
