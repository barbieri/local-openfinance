# Investment Movement History

## Status

Planned.

## Problem

The web app currently shows investment positions from the `investments` table.
That table is upserted on each sync, so it represents only the latest known
position.

Banco MCP exposes investment movement history through
`/investments/transactions/list`. The sync engine already stores those rows in
`investment_transactions`, but the web app does not expose them clearly.

Historical position snapshots would be misleading if syncs are missed. A chart
with one point per sync day can look like a daily valuation series even though
it only reflects days when the local app happened to sync.

## Goals

- Keep the current Investments tab focused on latest positions.
- Expose `/investments/transactions/list` data from the local
  `investment_transactions` table in the web app.
- Show investment movements as an activity timeline and optional movement
  totals, not as portfolio market value history.
- Make the distinction between current position and historical movements clear.
- Reuse existing synced data; do not add a snapshot table for this feature.

## Non-goals

- Daily portfolio value charts.
- Position snapshots per sync.
- Backfilling market value history.
- Fetching external market prices.
- Reconstructing valuation from movements.

## Banco MCP API Surface

Documented endpoints:

- `POST /investments/list`: current portfolio positions by connection.
- `POST /investments/transactions/list`: movement history for an investment.

`/investments/list` remains the source of truth for current position value.
`/investments/transactions/list` is the source of truth for historical
investment activity such as purchases, sales, taxes, fees, and other movement
types when Banco MCP provides them.

## Existing Data Model

Use the existing `investment_transactions` table:

```sql
CREATE TABLE investment_transactions (
  id TEXT PRIMARY KEY,
  investment_id TEXT NOT NULL REFERENCES investments(id),
  occurred_at TEXT NOT NULL,
  type TEXT,
  amount_cents INTEGER,
  quantity REAL,
  currency TEXT NOT NULL DEFAULT 'BRL',
  raw_json TEXT NOT NULL,
  synced_at TEXT NOT NULL
);
```

No new snapshot table should be added for this feature.

If implementation needs better query performance, add focused indexes for the
actual UI/API filters, for example:

```sql
CREATE INDEX idx_investment_transactions_occurred
  ON investment_transactions(occurred_at);
```

## Sync Behavior

Keep the current sync behavior:

1. Sync latest investments from `/investments/list` into `investments`.
2. Sync movement rows from `/investments/transactions/list` into
   `investment_transactions`.
3. Preserve upstream `raw_json`.

Do not append position snapshots from `/investments/list`.

## Web API

Add endpoints that expose local movement history:

- `GET /api/investments/transactions`
- `GET /api/investments/:id/transactions`

Query parameters:

- `startDate`
- `endDate`
- `connectionId`
- `investmentId`
- `type`
- `status`
- `limit`
- `offset`

Response shape:

```json
{
  "total": 42,
  "limit": 50,
  "offset": 0,
  "rows": [
    {
      "id": "investment-transaction-id",
      "investment_id": "investment-id",
      "investment_name": "CDB Example",
      "connection_display_name": "Bank Example",
      "occurred_at": "2026-06-22",
      "type": "BUY",
      "amount_cents": 123456,
      "quantity": 10,
      "currency": "BRL",
      "synced_at": "2026-06-22T10:30:00.000Z"
    }
  ]
}
```

The JSON should expose parsed/bare fields useful for UI filtering and sorting.
Raw upstream JSON may be added behind a detail disclosure if needed, but should
not be required for the default table.

## Web UI

Investments tab:

- Keep the current table as the latest-position view.
- Add a collapsed-by-default **Movement history** panel below the latest-position
  table, backed by `investment_transactions`.
- Allow filtering by date range, connection, investment, and movement type.
- Sort by `occurred_at` descending by default.
- Show amount, quantity, type, investment name, connection, and sync time.
- Use empty/loading/error states matching the rest of the app.

Investment detail:

- Show movement history for the selected investment.
- Keep movement history visually separate from current position fields.

Optional charts:

- Movement amount by month.
- Movement amount by type.
- Contribution versus withdrawal totals.

These charts must be labeled as movement/activity charts, not portfolio value
charts.

## Movement Type Presentation

Give first-class labels/colors to the common movement families below. Unknown
types should still render as their raw upstream `type` value with a neutral
style, so the UI remains usable when Banco MCP returns a new type.

Focus on `BUY` and `SELL` investment transaction types, so those two should
be implemented first and covered directly in tests. The remaining families
are forward-compatible presentation defaults for future Banco MCP values.

| Type family | Match | Label | Color intent |
|-------------|-------|-------|--------------|
| Buy/contribution | `BUY`, `APPLICATION`, `DEPOSIT`, `CONTRIBUTION` | Buy | green |
| Sell/withdrawal | `SELL`, `REDEMPTION`, `WITHDRAWAL` | Sell | blue |
| Income | `DIVIDEND`, `INTEREST`, `INCOME`, `YIELD` | Income | emerald |
| Tax | contains `TAX`, `IR`, `IOF` | Tax | red |
| Fee | contains `FEE`, `CHARGE`, `COST` | Fee | orange |
| Transfer | contains `TRANSFER` | Transfer | purple |
| Other | anything else | upstream type | neutral |

## Tests

- API test for listing investment transactions with pagination.
- API test for filtering by investment id.
- API test for date-range filtering.
- API test for movement type filtering.
- UI helper tests for movement type presentation fallback.
- UI helper tests for empty movement history.
- UI helper tests for movement totals if charts are implemented.
