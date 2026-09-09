# Web Investments Tab

## Scope

The Investments tab displays synced investment positions as a portfolio table.

Implementation:

- `src/web/client/pages/investments/InvestmentsPage.tsx`
- `src/web/client/pages/investments/investments-page-helpers.ts`
- `src/web/client/pages/investments/build-investment-table-columns.tsx`

## Data

The tab fetches:

- `GET /api/investments`

When a status filter is selected, it is sent as:

- `?status=...`

Parsed investment fields are persisted during sync and used by list/API layers.
See `sync-openfinance.md`.

## Filters

The tab has a client-side search field.

Status filter options:

- `ACTIVE`
- `all`
- `ACTIVE,TOTAL_WITHDRAWAL`

When a single status filter is active, the status column is hidden from the
effective visible columns.

If the current grouping is status and the next filter is a single status, the
grouping resets to none.

## Grouping

Supported grouping:

- none
- connection
- account
- type
- subtype
- status, only when the status filter is not a single status
- name

Grouped rows show:

- group label
- total amount
- allocation percent

## Columns

Column visibility is user-controlled in the tab.

At least one column remains visible.

Grouping hides the grouped column where applicable.

## Totals and allocation

The tab shows a grand total summary with:

- position count
- totals by currency

Portfolio allocation is computed from investment allocation cents. Group
allocation percent is computed against the filtered portfolio allocation total.

## Related spec

Investment position history details live in
`investment-position-history.md`.
