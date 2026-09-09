# Web Credit Cards Tab

## Scope

The Credit Cards tab shows synced credit accounts and their bills.

Implementation:

- `src/web/client/pages/credit-cards/CreditCardsPage.tsx`
- `src/web/client/components/charts/CreditCardBillsChart.tsx`

## Data

The tab fetches:

- `GET /api/credit-cards`
- `GET /api/credit-card-bills`

Credit-card rows include grouped `credit_data` parsed from
`raw_json.creditData`.

Credit accounts may expose:

- brand
- level
- limits
- statement close date
- payment due date

## Card presentation

Cards are rendered as expandable account sections.

The account header shows credit-card account details and cycle information when
available:

- close date
- due date

## Bill presentation

Bills are grouped under each credit-card account and sorted by newest due date.

Bill columns include:

- payment status icon
- due date
- total
- month-over-month change
- month-over-month percent
- actions

Payment status icons:

- `PAID` shows a paid icon.
- Other statuses show a scheduled/unpaid icon.

Month-over-month values are computed per account by comparing each bill total to
the previous bill total.

## View transactions

Each bill exposes a View transactions action.

It opens the Transactions tab with:

- account id in `a`
- `bill-id`
- `display.date=credit-purchase`
- `d=all`

This keeps the bill scope exact and avoids applying an inferred date range.

## Related behavior

Credit-card bill sync and transaction-bill membership are specified in
`sync-openfinance.md` and `credit-card-statement-correlation.md`.
