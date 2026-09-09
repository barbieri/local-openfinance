# Account Balance Over Time

## Status

Implemented.

## Problem

The Transactions tab has a balance chart, but the current implementation starts
from zero and accumulates the currently filtered transactions. That makes the
line a net-movement chart, not a real account balance over time.

This is misleading when users expect the chart to represent the actual balance
for an account on each day.

## Goals

- Calculate historical BANK account balance from the latest synced account
  balance and synced transactions.
- Keep category, label, and text filters from corrupting balance math.
- Make limitations explicit when the app does not have enough transaction
  history.

## Non-goals

- Accurate CREDIT account liability history.
- Reconstructing balances before the local transaction history begins.
- Fetching historical balances from Banco MCP, because the documented API only
  exposes real-time account balances.

## Current Behavior

`src/db/transaction-charts.ts` loads filtered transaction rows and calls
`buildDailyBalancePoints()`. That function initializes `running = 0` and adds
each filtered row amount.

This means the chart answers:

> What is the cumulative net movement inside the current filter?

It does not answer:

> What was my account balance on each day?

## Proposed Calculation

Use latest `accounts.balance_cents` as the anchor for each selected BANK account.
The anchor timestamp is the account's last `accounts.synced_at`, not the latest
transaction timestamp.

The selected date range is the **display range**, not the full calculation
boundary. The chart should only return daily points inside the selected range,
but the query must also load later transactions needed to walk backward from the
latest synced balance.

Implementation (as built):

1. Resolve account scope and display date range from transaction filters.
2. **SQL** — per account, `SUM(amount_in_account_currency_cents)` from display
   start through `synced_at` (initial net after display start).
3. **SQL** — per account and local calendar day in the display range,
   `SUM` credit, debit, and net (daily movement only).
4. **JS** — for each account, start at `anchor − initial_net`, then forward-walk
   display days adding each day's net; merge accounts when currencies match.

Daily local dates use timezone-aware ISO bounds (`date_bounds` CTE + existing
`resolveTransactionLocalDateStartIso` / `EndIso` helpers).

For a chart display range (conceptual backward form):

1. Resolve the account scope from transaction filters.
2. Restrict true-balance calculation to BANK accounts.
3. Load latest `accounts.balance_cents` and `accounts.synced_at` for each
   account.
4. Load all visible transactions for those accounts after the display range
   start through the latest synced position.
5. Walk backward from latest balance and emit points only for dates inside the
   display range:

```text
balance_at_day = latest_balance - sum(transactions_after_day)
```

Daily points are end-of-day balances. Transactions on the day are included in
that day's balance.

Example:

- Latest synced balance on `2026-06-22`: `1000000` cents.
- User displays `2026-06-01..2026-06-10`.
- To calculate the `2026-06-10` point, load and subtract transactions from
  `2026-06-11` through the latest synced position.
- To calculate the `2026-06-01` point, load and subtract transactions from
  `2026-06-02` through the latest synced position.

If the implementation loaded only transactions inside `2026-06-01..2026-06-10`,
the resulting line would be a filtered movement total, not a true balance.

## Filter Semantics

True balance must respect only filters that define account scope and date scope:

- account
- date range, as the output/display range only
- visible account alias rules

True balance must ignore filters that exclude arbitrary transactions:

- search query
- merchant
- description
- category
- labels
- classification
- transfers only/hide
- installments only/hide

Those filters are valid for category, label, and net-movement charts, but not
for true balance. Otherwise the balance line changes when the user hides a
transaction category, which is mathematically incorrect.

## API Shape

Keep `chart=balance`, but change it to return true anchored balance. Do not
expose a separate net-movement chart in the first implementation.

This is a behavior change, so update labels, tests, and release notes when
implemented.

Suggested response shape:

```json
{
  "chart": "balance",
  "currency": "BRL",
  "total": 42,
  "dailyBalance": [
    {
      "date": "2026-06-01",
      "credit": 10000,
      "debit": 5000,
      "balance": 123456,
      "isEstimated": true
    }
  ],
  "warnings": [
    {
      "code": "limited_history",
      "message": "Balances before 2026-03-01 depend on incomplete local transaction history."
    }
  ]
}
```

## Data Requirements

No new Banco MCP endpoint is required.

The existing `accounts.balance_cents` is the anchor. The existing
`transactions.amount_in_account_currency_cents` should be used for account
currency math. Continue using `VISIBLE_ACCOUNT_TRANSACTIONS_WHERE` so merged
alias accounts do not double-count transactions.

## Multi-account Behavior

When multiple BANK accounts are selected:

- Calculate each account's daily balance independently.
- Sum balances by date in a common currency only when currencies match.
- If currencies differ, either return separate series or block aggregate balance
  with a warning.

When no explicit account filter exists:

- Include visible BANK accounts.
- Exclude CREDIT accounts from true balance.
- If no BANK accounts are in scope, return an empty chart with a clear warning.

## Web UI

Transactions tab:

- Use "Balance" only for the true anchored balance chart.
- Show a small warning when balance is estimated from latest synced balance and
  local transaction history.
- If arbitrary transaction filters are active, show that balance ignores those
  filters and only follows account/date scope.

## Tests

- Unit-test backward balance reconstruction for one account.
- Unit-test that same-day transactions are included in ending balance.
- Unit-test multi-account same-currency aggregation.
- Unit-test different-currency handling.
- Unit-test that category/search filters do not alter true balance.
