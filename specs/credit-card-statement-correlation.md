# Credit Card Statement Correlation

## Status

Implemented (metadata links, inferred fallback, web bill filter, purchase-date display).

## Problem

Credit card transactions are currently listed as ordinary `transactions` rows for
`CREDIT` accounts. The app can list credit card bills from
`credit_card_bills`, but it does not persist a relationship between a
transaction and the bill/statement it belongs to.

Using only the account plus bill due date is not reliable. A card may be due on
the 28th while the statement closes on the 22nd, so transactions between the
23rd and 28th belong to the following bill, not the bill paid on the 28th.

## Goals

- Correlate each credit card transaction with the most likely bill/statement.
- Prefer `transaction.raw_json.creditCardMetadata.billId` when Banco MCP exposes
  it.
- Fall back to deterministic local statement-cycle inference when Banco MCP does
  not expose purchase-to-bill membership.
- Show statement/bill membership in the web UI and allow filtering by statement.
- Keep existing transaction classification and installment behavior unchanged.

## Non-goals

- Changing upstream Banco MCP categories.
- Reclassifying credit card installment plans.
- Inferring payment transactions from bank-account debit rows.
- Adding a one-off command for local data repair.

## Banco MCP API Surface

Documented endpoints:

- `POST /credit-card-bills/list`: bill summaries by credit account.
- `POST /credit-card-bills/detail`: bill detail by bill id.
- `POST /transactions/list`: transactions by account and date range; optional `detail`
  (`rich` for bill/merchant metadata, `raw` for full upstream payload, omit for compact).
- `POST /accounts/list`: CREDIT rows may include `creditData.balanceCloseDate` and
  `balanceDueDate` for statement close vs payment due.

Pluggy's transaction documentation says credit-card transactions may include
`creditCardMetadata.billId` and related Open Finance metadata such as
`payeeMCC`, `totalAmount`, `purchaseDate`, `feeType`,
`feeTypeAdditionalInfo`, `otherCreditsType`, and
`otherCreditsAdditionalInfo`. With `detail: "rich"`, Banco MCP exposes these
when the institution provides them (coverage varies by bank).

Observed in Banco MCP live responses on 2026-06-22 across Itaú and Sicoob
credit cards (before `detail: "rich"` and `balanceCloseDate` were available):

- Bill list rows expose summary fields such as `id`, `dueDate`,
  `totalAmount`, `minimumPaymentAmount`, `payment_status`, `payments_count`,
  and `finance_charges_count`.
- Bill detail rows have top-level `bill_id` and `bill`; nested `bill` contains
  bill summary fields plus `payments` and `financeCharges`.
- `payments` are bill payment records with keys such as `id`, `paymentDate`,
  `amount`, `valueType`, and `paymentMode`.
- `financeCharges` are fee/charge records with keys such as `id`, `type`, and
  `amount`.
- Bill details did not expose purchase transaction ids, statement line items, a
  closing date, or any stable purchase-to-bill membership field.
- Credit-card transaction rows exposed fields such as `id`, `date`, `amount`,
  `description`, `categoryId`, `status`, `type`, and bank-specific metadata
  like `creditCardMetadata` or `paymentData`, but no bill id or statement id.
- For current Itaú rows, `creditCardMetadata` contained only
  `installmentNumber` and `totalInstallments`; fields such as `billId`,
  `payeeMCC`, `totalAmount`, `purchaseDate`, `feeType`, and
  `otherCreditsType` were absent. Current Sicoob credit-card rows did not expose
  `creditCardMetadata`.

As of 2026-06-23, Banco MCP added `creditData.balanceCloseDate` on account list
and `transactions/list?detail=rich` for `billId`, merchant, and related fields.
Sync stores account close/due dates and requests `detail: "rich"`; field
coverage still varies by institution.

Therefore the implementation should support source-provided membership from
`creditCardMetadata.billId` when present, but must not depend on it when a
given institution omits rich metadata.

## Proposed Data Model

Add a bill membership table rather than a nullable column on `transactions`.
This keeps inferred and manual links auditable.

```sql
CREATE TABLE credit_card_bill_transactions (
  bill_id TEXT NOT NULL REFERENCES credit_card_bills(id) ON DELETE CASCADE,
  transaction_id TEXT NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
  source TEXT NOT NULL, -- transaction_metadata | inferred | manual
  confidence INTEGER NOT NULL DEFAULT 100,
  reason TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (bill_id, transaction_id)
);

CREATE INDEX idx_credit_card_bill_transactions_transaction
  ON credit_card_bill_transactions(transaction_id);
```

Add a SQLite table for per-credit-account statement-cycle overrides. These
overrides are user-managed state, not config, because the Credit Cards tab must
allow adding and editing them.

```sql
CREATE TABLE credit_card_statement_cycles (
  account_id TEXT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  due_day INTEGER NOT NULL CHECK (due_day BETWEEN 1 AND 31),
  closing_day INTEGER NOT NULL CHECK (closing_day BETWEEN 1 AND 31),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

For inferred links, use `source = 'inferred'`, with confidence based on whether
the account has an explicit closing-day override and whether surrounding bills
exist.

When `transactions.raw_json.creditCardMetadata.billId` is present and matches a
known local bill for the same account, use `source = 'transaction_metadata'`
and `confidence = 100`.

## Statement Cycle Overrides

Statement-cycle overrides live in SQLite, keyed by credit-card `account_id`.
The web UI is the primary editing surface.

Validation rules:

- `account_id`: must reference an existing `accounts.id` where `type = 'CREDIT'`.
- `due_day`: integer `1..31`.
- `closing_day`: integer `1..31`.
- One override per credit-card account.

No config schema change is needed for these overrides.

## Inference Algorithm

For a bill with due date `D` and configured closing day `C`:

1. Compute `statementEndDate` as day `C` in the same calendar month as `D`.
2. If `statementEndDate > D`, use the previous month for `statementEndDate`.
3. Compute `statementStartDate` as the day after the previous bill's
   `statementEndDate` when the previous bill exists.
4. If the previous bill is missing, compute a synthetic start date as one month
   before `statementEndDate`, plus one day.
5. Link credit account transactions where local transaction date is between
   `statementStartDate` and `statementEndDate`, inclusive.

Example:

- Due date: `2026-06-28`
- Closing day: `22`
- Statement end: `2026-06-22`
- Previous statement end: `2026-05-22`
- Statement window: `2026-05-23..2026-06-22`

When no explicit cycle exists, derive a weak default from consecutive due dates:

- Sort bills by `due_date`.
- Use midpoint-free windows based only on due-date ordering.
- Mark inferred links as lower confidence and show the result as inferred.

## Sync Behavior

During sync:

1. Sync credit card bills as today.
2. Link transactions whose `raw_json.creditCardMetadata.billId` matches a known
   bill for the same account.
3. Recompute inferred links for affected account/date windows after new
   transactions or bills are synced.
4. Do not overwrite `source = 'manual'` links.
5. Do not replace `source = 'transaction_metadata'` links with inferred links.

`/credit-card-bills/detail` is not required for purchase correlation. It may
still be useful later for richer bill payment and finance-charge displays, but
that is separate from transaction-to-statement membership.

## Web UI

Transactions tab:

- Add a statement filter for credit card accounts.
- Show a statement/bill badge for credit card rows.
- In transaction detail, show linked bill due date, statement window, source,
  and confidence.

Credit Cards tab:

- Add/edit statement-cycle overrides for each credit card account.
- Validate `due_day` and `closing_day` as `1..31` before saving.
- Show configured due day and closing day on the card details or bill section.
- From each bill row, link to the Transactions tab filtered to that statement.
- Show statement window when it can be resolved.

## CLI

No new durable CLI command is required for the first implementation.

Existing list commands may later add optional display fields for statement
membership, but avoid adding one-off repair commands.

## Tests

- Unit-test statement window calculation across month boundaries.
- Unit-test 28th due day / 22nd closing day behavior.
- Unit-test leap-year and short-month handling.
- Unit-test that manual links are not overwritten.
- Web API tests for creating and updating statement-cycle overrides.
- Web API tests for statement filtering.
