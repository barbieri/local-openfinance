# Web Labels Tab

## Scope

The Labels tab manages local nested annotation labels.

Implementation:

- `src/web/client/pages/ManagementPages.tsx`
- `src/web/client/components/labels/LabelTreeView.tsx`
- `src/web/client/components/labels/LabelEditDialog.tsx`
- `src/web/client/components/labels/LabelMultiSelect.tsx`

## Data

The tab fetches:

- `GET /api/annotation-labels`

The response includes a `byId` map.

## Empty state

When no labels exist, the tab shows the labels empty message and still renders
`LabelTreeView` with an empty map so labels can be created.

## Hierarchy

Labels are nested parent/child rows in `annotation_labels`.

Child labels inherit icon and color from the parent when unset in SQLite.

Unset inherited fields are stored as `NULL`.

Updating a parent updates presentation for inheriting children.

## Delete constraints

Delete is blocked when a label:

- is assigned to transactions
- has child labels

## Transaction usage

Transaction detail dialogs and filters use multi-select against existing labels.

There is no inline label creation from transaction classification UI.

Persist label ids, not names or paths.

Legacy proposal paths may be resolved only when reading old stored proposals.
