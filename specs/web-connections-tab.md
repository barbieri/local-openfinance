# Web Connections Tab

## Scope

The Connections tab displays synced OpenFinance connections and supports manual
connection labels.

Implementation:

- `src/web/client/pages/ManagementPages.tsx`
- `src/web/client/components/connections/ConnectionEditDialog.tsx`

## Data

The tab fetches:

- `GET /api/connections`

Rows include display labels from `connection_labels` when set.

## Columns

Connection table columns:

- display name
- connector
- status
- last sync
- actions

Last sync values use shared sync-time formatting.

## Actions

The edit action opens the connection label dialog.

Connection labels store:

- branch
- account
- display name

Connection list handlers enrich rows with `display_name` when set.
