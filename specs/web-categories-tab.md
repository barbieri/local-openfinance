# Web Categories Tab

## Scope

The Categories tab displays and edits upstream Open Finance category
presentation (name, icon, color). It does not create or edit local annotation
categories. Those are created in the CLI `classify` wizard.

Implementation:

- `src/web/client/pages/ManagementPages.tsx`
- `src/web/client/components/categories/CategoryTreeView.tsx`
- `src/web/client/components/categories/CategoryEditDialog.tsx`
- `src/web/client/components/categories/category-badge-presentation.ts`

## Data

The tab fetches:

- `GET /api/categories`

The request includes locale through `withLocaleQuery()`.

The response includes a `byId` map.

## Empty and loading states

Loading renders a short placeholder.

When there are no categories, the tab renders the shared empty-table message.

## Category presentation

Open Finance category presentation defaults live in
`src/data/openfinance-category-defaults.json`.

Manual edits can set:

- display name
- Material icon id
- color

Manual edits set manual flags and are not overwritten by default sync behavior.

Display resolves icon/color by walking from child to parent when a row omits
either field.

## Category ids

Persist category ids, not display names.

Hierarchical select options may use `only:{id}` for exact-match filtering. Strip
that prefix with `resolveStoredCategorySelectId()` before persisting.
