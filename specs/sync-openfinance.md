# OpenFinance Sync

## Source of truth

`banco-mcp-openapi.json` is the Banco MCP REST contract source of truth for
sync.

Banco MCP enforces roughly 2 requests per second per workspace.

`OpenFinanceClient` retries HTTP 429 using `retry_after_ms` from the error body.
It also retries HTTP 500 responses that explicitly identify Banco MCP's provider
queue/rate limit, which some upstream paths return instead of HTTP 429.

## Error reporting

`OpenFinanceClient` throws `OpenFinanceClientError` with a self-contained
multi-line message so CLI and web job UIs can show actionable detail without
inspecting nested fields.

Error kinds:

- `network` — `fetch` failed before an HTTP response (DNS, TLS, refused
  connection). Message includes the request URL, the `Error.cause` chain
  (for example `ECONNREFUSED` / `ENOTFOUND`), and hints to check
  `OPENFINANCE_BASE_URL` and connectivity to Banco MCP.
- `http` — non-2xx response. Message includes status, status text, truncated
  response body (JSON `message`/`error` preferred), and status-specific
  hints (auth key for 401/403, base URL for 404, rate limit, upstream 5xx).
- `upstream` — HTTP 200 with `ok: false` envelope. Message includes tool name
  and upstream error/result payload.
- `invalid_response` — non-JSON or non-object body.

Background jobs (`BackgroundJobManager`) format failures with
`formatUnknownError()` so bare `fetch failed` TypeErrors still expand their
cause chain into the SSE `error` event and job snapshot `error` field.

## String normalization

`readString` and `readFieldString` trim whitespace. Blank strings become
`null`.

This applies during sync and when parsing `raw_json`.

## Transaction merchant and description

Transaction sync resolves `merchant_name` and `description` through
`resolveTransactionMerchantAndDescription()`.

When `raw_json.merchant` is present, prefer:

1. `businessName`
2. `name`
3. a plain string value

That merchant value wins over description and payment-data heuristics.

Otherwise, heuristics handle:

- PIX pipe formats for Sicoob.
- Itau QR/enviado prefixes.
- Credit-card installment suffix stripping from `creditCardMetadata`.
- Zero-padded installment segments such as `01/03`.

## Incremental sync

Incremental sync skips upserting transaction and investment-transaction rows
whose ids already exist locally.

It stops paginating once a page's oldest date is before the overlap `from`
date.

The overlap comes from `sync.lookbackDays`, default 7.

Per-account and per-investment cursors are stored in `sync_cursors`.

Future-dated pending entries are stored, but never advance a cursor past the
sync time. If an older database already has a future cursor, the next
incremental sync caps it at the current time before applying the lookback.

Bypass incremental skips with:

- `sync --force-upsert`
- `sync --force`
- `sync.forceUpsert: true`
- the web Sync tab force-upsert checkbox

Force upsert re-upserts all rows, including categories.

## Account visibility during sync

Per-account transaction fetches and credit-card bill fetches skip merged alias
accounts where `account_group_members.is_canonical = 0`.

Accounts, investments, and credit-card bills are always re-fetched for visible
accounts because balances and bill status change.

## Account-currency amount

Transaction sync stores `amount_in_account_currency_cents`.

It comes from upstream `amountInAccountCurrency`, falling back to `amount` when
absent.

Charts, rollups, transfer detection, and sorts use the account-currency amount.

List and detail UI show original `amount`/`currency` plus the account amount
when they differ.

## Parsed detail columns

Sync upserts parsed detail columns from upstream `raw_json` into SQLite.

Investments include:

- status
- ISIN
- quantity
- unit/total/amount cents
- issuer
- issuer CNPJ
- rate
- rate type
- dates
- taxes

Loans include:

- name
- outstanding balance
- installments
- interest rate
- creditor

Accounts include:

- credit brand and level
- credit limits
- `balanceCloseDate`
- `balanceDueDate`
- bank transfer, branch, and account details

List and API layers read parsed columns first and fall back to parsing
`raw_json` until the next sync.

## Credit cards and bills

Credit-card bill sync normalizes `PAST_DUE_UNCONFIRMED` and `PAST_DUE_UNPAID`
to `PAID` when:

- `total_amount_cents <= 0`
- `due_date` is before the sync day in local time

Upstream `raw_json` is unchanged.

Pluggy documents optional credit-card transaction metadata:

- `creditCardMetadata.billId`
- `payeeMCC`
- `totalAmount`
- `purchaseDate`
- `feeType`
- `otherCreditsType`

Banco MCP `transactions/list` accepts `detail: "raw"` or `detail: "rich"`.
Sync requests `detail: "raw"` to get full merchant/CNPJ/CNAE and card metadata
when the institution provides them.

Use `sync --force-upsert` to backfill older rows.

CREDIT accounts from `accounts/list` may include:

- `creditData.balanceCloseDate`, stored as `credit_balance_close_date`
- `creditData.balanceDueDate`, stored as `credit_balance_due_date`

Bill membership persists in `credit_card_bill_transactions`.

Supported `source` values:

- `transaction_metadata`
- `inferred`
- `manual`

Sync links from `creditCardMetadata.billId` when present. Otherwise, it infers
statement windows from bill due dates and the `balanceCloseDate` day in
`src/db/credit-card-bill-links.ts`.

Manual bill override is allowed only when metadata has no `billId` and the
existing link is `inferred`.

The override route is:

- `POST /api/transactions/:id/bill-link`

See `credit-card-statement-correlation.md`.

## MCC names

ISO 18245 MCC names ship in `src/data/mcc-codes.json`.

`resolveMccName()` resolves labels.

Portuguese labels come from `src/data/mcc-codes.pt-overrides.json`, merged by
`scripts/import-mcc-codes.mjs`.

After bulk Portuguese edits, run:

- `scripts/fix-mcc-pt-overrides.mjs`

For an LLM fill of missing keys only, use:

- `scripts/translate-mcc-pt-overrides-once.mjs`

API/list enrichment exposes `payee_mcc_name`.

Merchant category strings win over MCC lookup.

## Category defaults

Open Finance category presentation defaults live in
`src/data/openfinance-category-defaults.json`.

They use:

- English `categories.name` keys.
- Material `Md...` icon ids.
- Hex colors.

After each category sync, `applyOpenFinanceCategoryDefaults()` upserts
non-manual `category_labels` rows from that file.

Manual edits through `label-category` or the web Categories tab set manual
flags and are not overwritten.

Display resolves icon and color by walking the category tree from child to
parent when a row omits either field.

## Category select ids

Hierarchical category select options may include `only:{id}` entries for
exact-match filtering in list views.

Strip that prefix with `resolveStoredCategorySelectId()` before persisting
overrides or annotations.

## Annotation embedding feature text

Annotation embeddings use `buildEmbeddingFeatureText()`.

The feature text is a compact semantic summary (no full raw JSON dump):

- Merchant, MCC, and payment type fields.
- Normalized peer documents (`cpf:…`, `cnpj:…`) for payer, receiver, and
  merchant.
- Amount sign and coarse amount bucket (not exact cents).
- Month and weekday (not exact clock time).
- Upstream category and parent category.
- Connection name and account type/subtype.

Searchable peer columns on `transactions`:

- `payer_document_key`
- `receiver_document_key`
- `merchant_document_key`

Keys are written on sync and backfilled on database open.

## Annotation assist cascade

Classify assist ranks labeled neighbors in this order:

1. Same **counterparty** document + same account (window ~3 years, small sample).
2. Same counterparty document on another account.
3. Merchant-name match on the same account.
4. Embedding cosine similarity on the same account (window ~180 days, fewer
   candidates than legacy).

All of payer, receiver, and merchant document keys are stored. Peer *candidate
recall* uses counterparty-side keys only (merchant + receiver on debits;
merchant + payer on credits) so the account-holder CPF does not flood the
neighbor limit. A peer *match* further requires that shared key to be a
counterparty signal for **both** sides.

It prompts the optional classifier with top-K example mappings when heuristics
do not produce a proposal.
