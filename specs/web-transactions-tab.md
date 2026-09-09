# Web Transactions Tab

## Scope

The Transactions tab is the main transaction browsing, filtering, charting,
classification, and transfer-linking workspace.

Implementation is centered on:

- `src/web/client/pages/TransactionsPage.tsx`
- `src/web/client/pages/TransactionsPageView.tsx`
- `src/web/client/pages/use-transactions-page-controller.ts`
- `src/web/client/components/transactions/`
- `src/web/server/transaction-routes.ts`
- `src/web/server/transaction-request.ts`
- `src/web/server/transactions-list.ts`
- `src/web/server/transaction-charts.ts`

## Sidebar

Filters, grouping controls, column visibility, and secondary actions live in a
collapsible right overlay sidebar.

Behavior:

- Collapsed by default.
- Uses a backdrop and Escape to close.
- Does not reflow the table or charts.

Sidebar sections:

- Scope
- Search
- Categories and labels
- Advanced
- Group rows
- Columns
- More actions

Each section is independently collapsible.

## Grouping

Grouping is client-side over the current server-paginated rows.

It is persisted in URL table state key `g`.

Collapsed filter summary renders grouping as removable chips.

Supported nested grouping dimensions:

- date
- connection
- account
- category
- label-set
- merchant

Grouped columns are automatically hidden from the visible table while preserving
stored column preferences.

Group headers expose:

- select all
- positive account-currency total
- negative account-currency total
- net account-currency total
- category chips when grouping by category
- label chips when grouping by labels

## Selection and keyboard

Selection toolbar supports:

- select all visible rows
- select none
- select visible unclassified rows
- Edit selected

`Edit selected` opens the detail dialog for the current selection in rendered
table order.

Click a row to open the detail dialog, except checkbox and transfer icon cells.

Row checkboxes support Gmail-style shift-click range selection in current table
sort order.

Keyboard shortcuts on the table:

- `/` opens filters and focuses combined search.
- `e` edits selected rows.
- `s` toggles visible all/none.
- `u` selects visible unclassified rows.
- `x` toggles the current row selection.
- Up/Down moves the current row.
- Enter edits the current row.
- `?` or `h` opens the shortcut sheet.

## Detail and edit UI

Transaction edit UI is shared by the Transactions detail dialog and the
Classify triage tab.

Shared components:

- `TransactionEditPanel`
- `TransactionDetailContent`

Detail content includes:

- merchant, MCC, and payment document fields
- foreign currency details
- credit-card bill
- installments
- classification form
- assist reasoning
- transfer unlink
- collapsed raw JSON

Detail mode does not auto-call assist on open.

Use the Assist button to:

- load a cached suggestion when available
- recompute with Recreate after a cached hit

Triage mode pre-fills from the queue proposal and differs only in save/dismiss
flow.

## Installments

Installment rows after the first show a plan summary.

The summary uses:

- explicit purchase total from `creditCardMetadata.totalAmount`, when present
- otherwise `amount * totalInstallments`
- purchase date from metadata, when present
- otherwise first-installment date

Installment rows include:

- view link
- expandable first-installment details

Routes:

- `GET /api/transactions/:id`
- `GET /api/transactions/:id/installment-plan`

The hash `#/transaction/<id>` (singular) opens a dedicated detail page that
reuses the edit panel. It is not listed in the header tabs. The detail dialog
and classify triage title include copy-link and open-permalink actions. Table
row click still opens the in-tab dialog.

Credit-card installment plans expose `Apply to all N installments`.

The checkbox is checked by default when editing an installment row.

Saving with the checkbox runs `saveTransactionClassification` across sibling
rows matched by:

- account
- `totalInstallments`
- normalized merchant/description from `creditCardMetadata`
- installment `amount_cents` within +/- 1 cent

Classify triage Accept has the same installment checkbox, checked by default for
installment rows.

## Bulk edit

When multiple rows are selected, the detail dialog offers
`Update all N other selected transactions`.

Saving with that checked sends `applyToTransactionIds` to:

- `POST /api/transactions/:id/classification`

## Classification and display

The detail UI supports:

- upstream category override through `transaction_category_overrides`
- local annotation category
- local annotation subcategory
- label ids
- notes

Upstream category overrides are sync-safe.

Annotation notes replace upstream `description` in list/detail/triage display
through `display_description`.

Description and `q` search also match `annotation_notes_fts`.

## Charts

Charts disclosure is collapsed by default.

Open state and active chart tab persist in URL table state:

- `charts.open`
- `charts.tab`

Only the selected tab fetches data through:

- `GET /api/transactions/charts?chart=...`

Collapsed charts, or no selected chart tab, skip the request.

Chart types:

- Balance line.
- By category top-level pie.
- By label top-level bar.

Balance chart:

- True anchored BANK account balance.
- SQL aggregates per-account net from display start through sync.
- SQL also groups daily credit, debit, and net by local date.
- JS forward-walks from `anchor - net_after_start`.
- Warns on limited history, mixed currencies, or no bank accounts.
- See `account-balance-over-time.md`.

Category chart:

- Uses effective Open Finance category.
- Uses category colors.
- Selectable top-level slice opens sub-category pie on the right.
- Sub-category shades vary by amount.

Label chart:

- Top-level bar chart.
- Selectable parent opens sub-label bar chart below.
- Uses the same shading behavior.

## Credit-card scope

Credit-card scope in the sidebar exposes:

- Credit card bill filter.
- Use purchase date column toggle.

The bill filter uses the same searchable picker pattern as account filters and
accepts one bill at a time.

URL/API state:

- `bill-id`
- `display.date=credit-purchase`
- API `display-date=credit-purchase`

The date mode affects sort, filter, and display.

Date shortcuts include Past month. It resolves to the full calendar month before
the current month, unlike the rolling Last 12 months shortcut.

On narrow screens, transaction rows consolidate merchant with description and
category with labels; the duplicate standalone columns are hidden while the
remaining table stays horizontally scrollable.

The Credit Cards tab `View transactions` action opens Transactions with:

- `bill-id`
- `display.date=credit-purchase`
- `d=all`

No inferred date range is applied for that navigation.

## List API

`GET /api/transactions` filters, sorts, and paginates in SQLite.

Defaults:

- page size 50
- max page size 200

Search:

- merchant uses FTS5 prefix token matching
- description uses FTS5 prefix token matching
- `q` uses FTS5 prefix token matching

Filters:

- label filters use ids
- category filters use ids
- account filter is multi-select
- URL `a` and API `account` accept comma-separated account ids
- `bill-id` filters by persisted bill link or
  `raw_json.creditCardMetadata.billId`
- `transfers=only|hide`
- `installments=only|hide`

Installment filtering uses:

- `raw_json.creditCardMetadata.installmentNumber`
- `raw_json.creditCardMetadata.totalInstallments`

Detect transfers scans every matching transaction in the current filter scope.
It does not stop at the table page currently rendered in the browser.

CSV and JSON export walk the same unpaginated filter and sort, requesting
successive `GET /api/transactions` pages until `total` is collected. They do
not export only the visible table page.

Tables scroll horizontally within their own frame on narrow screens. Transactions
pin selection and date to the left edge and amount to the right edge. When the
active range stays in one month, dates show only the day. When it stays in one
year, dates show month and day.

`classification=classified|unclassified` uses
`TRANSACTION_IS_CLASSIFIED_WHERE`.

Classification includes:

- Open Finance override
- local annotation category/subcategory
- notes
- label ids

It does not treat upstream `transactions.category_id` alone as classified.

## URL table state

URL table state carries:

- `p` for page
- `ps` for page size
- `o` for sort
- `g` for grouping
- `display.category`
- `display.labels`
- `display.date`

Category and label display modes:

- `icon`
- `short`
- `full`

Date display mode includes:

- `credit-purchase`

## Classify helper

`POST /api/classify/assist` returns a stored precompute suggestion when one
exists.

Cached responses include:

- `fromCache: true`

Pass `force: true` to recompute and upsert only that transaction.

Requires `annotation.embedding` in config. Classifier config is optional.
