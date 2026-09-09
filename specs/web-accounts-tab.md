# Web Accounts Tab

## Scope

The Accounts tab displays synced accounts and supports manual account labels and
duplicate account linking.

Implementation:

- `src/web/client/pages/ManagementPages.tsx`
- `src/web/client/components/accounts/AccountEditDialog.tsx`
- `src/web/client/components/accounts/LinkAccountsDialog.tsx`

## Data

The tab fetches:

- `GET /api/accounts`
- `GET /api/connections`

Manual display names come from `account_labels`.

Fallback display names:

- Bank accounts use `bankData.transferNumber`.
- Credit cards use `BRAND (last4)` or `BRAND (LEVEL)`.

Connection labels do not override account names.

Bank account list rows may inherit label branch/account when `bankData` is
missing.

## Filters

Client-side filters:

- connection
- search

Search matches:

- display name
- account name
- formatted account details

## Summary

The tab shows a grand total summary with:

- account count
- balance totals by currency

## Columns

Account table columns:

- display name
- connection
- type
- subtype
- balance
- details
- last sync
- actions

Canonical rows show a merged-count badge when aliases are linked.

## Actions

Actions include:

- View transactions.
- Edit account label.
- Link duplicate accounts.

View transactions opens the Transactions tab with:

- account id in `a`
- `d=this-month`

## Link duplicate accounts

The Link duplicate accounts wizard uses:

- `GET /api/accounts/link-suggestions`
- `GET /api/accounts/linked-groups`

The wizard can:

- pick a canonical account
- merge aliases
- unlink selected aliases
- dissolve a group

Semantics match the CLI `link-accounts` command.

Merged duplicate accounts hide alias rows and alias transactions.

Canonical account rows may include `merged_account_ids`.
