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

Deleted positions are hidden from ordinary list consumers regardless of the selected
status filter. Their child investment movements are also excluded from normal
classification, list, net-worth, and report inputs. The Investments web list can opt in
through `GET /api/investments?deleted=all` or `?deleted=only`. Missing and invalid values
default to `hide`, independently of status. Its rows include top-level `deleted_at` and
`delete_reason` for the Deleted table column.

## Permalink and deletion

Selecting an investment name opens `#/investment/<id>`. The permalink fetches
`GET /api/investments/<id>` and remains readable after deletion. It presents
the persisted fields, parsed fields, and formatted raw JSON.

The detail page can soft-delete one active investment through
`POST /api/investments/<id>/delete` with an optional reason. The endpoint uses
the existing soft-delete record, never hard-deletes the position or its child
movements, and returns 404 for an unknown id. A deleted detail page has a
banner with its deletion time and reason and offers Restore in the same action
area. `POST /api/investments/<id>/restore` confirms without a reason, clears
both deletion metadata fields, and returns the position and its movements to
normal views and reports without changing imported or related local data.

## Filters

The tab keeps search, status, grouping, and visible-column controls in the
shared collapsible Filters & columns panel. The closed-panel trigger summarizes
the active status, selected deleted visibility, search, and grouping settings.

Status filter options:

- `ACTIVE`
- `all`
- `ACTIVE,TOTAL_WITHDRAWAL`

The Advanced sidebar section offers deleted visibility:

- Hide deleted, the default
- Show all
- Deleted only

When a single status filter is active, the status column is hidden from the
effective visible columns.

If the current grouping is status and the next filter is a single status, the
grouping resets to none. The default grouping is account.

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

Column visibility is user-controlled in the tab. The Deleted column uses the shared deletion
marker and is automatically hidden while Hide deleted is selected. Its selected state remains
stored and reappears for Show all and Deleted only. The status column follows the same
effective-only hiding rule for a single-status filter.

At least one effective table column remains visible after a column toggle, grouping change,
single-status filter change, or deleted-filter change. When automatic hiding removes every
selected column, the tab selects Name as the fallback, except name grouping uses Total.

Grouping hides the grouped column where applicable.

## Totals and allocation

Before the table, the tab shows matching position count plus active status,
search, and grouping. Its separate grand total summary shows:

- totals by currency

Portfolio allocation is computed from investment allocation cents within each
currency. Row and group allocation percentages use the filtered portfolio
allocation total for their own currency; nominal cents from different currencies
are never combined. A group with positions in multiple currencies shows one
amount-and-percent pair for each currency.

## Allocation charts

The portfolio allocation disclosure appears before the grouped position list.
It reads the same filtered rows as the table and groups positive allocation
amounts separately by currency. It never adds values across currencies.

Each currency panel drills down from type to subtype to code. A level with one
choice resolves automatically and is omitted. The code pie still renders for a
single code. Selecting a type, subtype, or code slice toggles it and dims its
siblings. A changed filter can remove a selected slice; the chart derives a
valid path from the current data without retaining a stale selection.

Chart colors come from stable bucket ids, so filtering or changing a bucket's
amount does not change its color.

## Related spec

Investment position history details live in
`investment-position-history.md`.
