# Web Loans Tab

## Scope

The Loans tab displays synced loan positions.

Implementation:

- `src/web/client/pages/LoansPage.tsx`

## Data

The tab fetches:

- `GET /api/loans`

Parsed loan fields are persisted during sync and used by list/API layers. See
`sync-openfinance.md`.

## Summary

The tab shows a grand total summary with:

- loan count
- balance totals by currency

## Columns

Loan table columns:

- name
- contract amount
- balance
- allocation
- due date

Allocation is computed from `balance_cents` across the loaded rows.
