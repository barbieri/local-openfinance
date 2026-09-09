# Web Classify Triage Tab

## Scope

The Classify triage tab reviews precomputed classification suggestions one
transaction at a time.

Implementation:

- `src/web/client/pages/ClassifyTriagePage.tsx`
- `src/web/client/components/classify-triage/PrecomputeProgressView.tsx`
- `src/web/client/components/transactions/TransactionEditPanel.tsx`
- `src/web/server/job-routes.ts`
- `src/web/server/triage-present.ts`

## Queue

The tab fetches queue and stats:

- `GET /api/classify/triage?limit=1&offset=0`
- `GET /api/classify/triage/stats`

The queue renders one item at a time.

Each queue item uses the shared `TransactionEditPanel` with `mode=triage`.

The transaction details are fetched from:

- `GET /api/transactions/:id`

Locale is included through `withLocaleQuery()`.

## Accept and skip

Accept saves through:

- `POST /api/classify/triage/:id/apply`

Skip dismisses through:

- `POST /api/classify/triage/:id/dismiss`

Accept persists:

- Open Finance category override id
- annotation category id
- annotation subcategory id
- label ids
- notes
- reasoning

Category select ids are normalized with `resolveStoredCategorySelectId()`.

## Installments

Accept can apply classification to installment siblings.

The installment sibling checkbox is checked by default for installment rows.

When applied, the success toast reports the total installment count.
It includes an action that opens the classified transaction in a new tab.

The transaction editor action area stays visible at the bottom while the
editor content scrolls.

## Precompute controls

The tab can start precompute through:

- `POST /api/jobs/precompute`

The Clear existing checkbox sends `clear-pending=true`.

Clear existing deletes pending suggestions and recomputes all.

Abort uses:

- `POST /api/jobs/abort`

Progress is shown with `PrecomputeProgressView`.

Precompute (and any shared background job) failures use the same detailed
error surface as Sync: multi-line `JobErrorBanner` plus a toast with
`whitespace-pre-wrap` so network/provider messages remain readable and
actionable.

## Precompute behavior

Auto precompute after web/CLI sync, unless opted out, prepares suggestions for
unannotated transactions that do not already have a pending suggestion.

Before precompute, sync detects internal-transfer proposals among the newly synced
transactions and transactions from the preceding day. A proposal appears
in the triage editor before classification.

Precompute skips entries already marked applied or dismissed so triage does not
repeat the same transaction.

Pending suggestions created by an older assist-algorithm version are recomputed
once; applied and dismissed suggestions remain untouched.

## Assist classifier constraints

Assist classifier prompt exposes at most 3 label ids ranked from similar
examples.

The model `labelIds` output is capped at 3.

Tier order:

1. Counterparty document heuristic (same account, then other accounts).
   Stores/considers payer + receiver + merchant; a match requires a shared key
   that is a counterparty for at least one side (not self-CPF alone on debits).
   Documentary matches retain two years of history.
2. Merchant heuristic.
3. Strong example copy.
4. Classifier LLM only when needed.

An exact same-account merchant match takes precedence over a shared document
when the document also identifies a different payment flow, such as salary and
dividend payments from the same company.

Merchant-name recall may also retain two years of same-account history, but a
name with conflicting prior classifications is not copied heuristically. This
prevents payment proxies from inheriting an arbitrary past purchase; the
classifier receives the conflicting examples and may resolve the target or
abstain.

Example-copy tiers copy notes when peer match is exact, or when
merchant/embedding match is very strong.

`sanitizeAssistNotes` drops notes that fuzzy-match an example note while the
target transaction differs.

Keeping an echoed example note requires at least 0.95 merchant/description
similarity.

Assist note proposals are also dropped when they:

- are fuzzy-similar to the transaction description
- are fuzzy-similar to the merchant
- echo the assist classifier prompt

Prompt leakage detection lives in:

- `src/annotation/assist-classifier-prompt.ts`

It derives prefixes and instruction lines from `buildAssistClassifierPrompt()`,
strips markdown list markers, and compares case-insensitively.

Embedding feature text includes:

- `payment_receiver_name`
- normalized `payer_document` / `receiver_document` / `merchant_document`
  (`cpf:…` / `cnpj:…`)
- `peer_documents`
- `payee_mcc`
- `payee_mcc_name`
- amount sign/bucket (not exact cents)

Requires `annotation.embedding` in config.
