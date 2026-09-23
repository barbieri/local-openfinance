---
name: local-openfinance-analysis
description: >
  Read-only analysis of a local-openfinance SQLite database. Use when the
  user asks to query, chart, or summarize synced Open Finance data, compare
  periods (month vs month, year vs year), break down spend by label or
  category, or inspect transactions, investments, loans, credit-card bills,
  or pending classification triage. Documents the schema (transactions,
  annotations/labels, investments, credit cards, loans, triage) and
  enforces read-only access with the correct money, timezone, and
  soft-delete conventions.
---

# local-openfinance SQLite analysis (read-only)

## Guardrails

- Open the database READ-ONLY only: `sqlite3 -readonly <path>` or
  `sqlite3 "file:<path>?mode=ro"`. The app serves the web UI and syncs
  concurrently in WAL mode; a reader must never take a write lock.
- Never run INSERT/UPDATE/DELETE/DROP/ALTER/VACUUM or write-mode PRAGMAs
  on the live file. Data changes belong to the app's own CLI commands
  (`classify`, `label-*`, `link-accounts`, `detect-transfers`, `sync`).
- Never copy a live WAL database with plain `cp` of the `.sqlite`; use the
  app's `maintain` backup or `VACUUM INTO`.
- Locate the database via the topic config: `storage.databasePath`
  (default `openfinance.sqlite` beside the config). It is gitignored and
  may be a symlink to the live DB; follow it read-only.
- For lookups prefer the app CLI over manual SQL — it resolves display
  names, translations, and date shortcuts, and list commands are pure
  local reads. See "CLI commands" below.

## CLI commands (prefer before manual SQL)

Run from the repo clone: `pnpm run local-openfinance:bundle <command>
--config <path>`. This executes the prebuilt bundle
(`dist/bundle/local-openfinance.mjs`) and is much faster than the tsx
`local-openfinance` script; run `pnpm run build` first if the bundle is
missing or stale. Every command needs `--config`; full reference lives in
`specs/cli-commands.md` in the repo. List commands are pure local reads
and safe; most other commands write or cost money.

Read-only lookups:

- `list-transactions` — grouped, oldest first. Filters: `--date`
  shortcuts (`today`, `this-week`, `this-month`, `YYYY`, `YYYY-MM`),
  `--start-date`/`--end-date` (`YYYY-MM-DD`), `--account` (CSV ids),
  `--status`, `--category-id`, `--merchant` (regexp), `--payment-type`;
  `--group-by=account,date`; `--json`; `--no-translate` for original
  upstream category names. Shows annotations, transfer marker, and
  installment suffixes.
- `list-accounts` — type/subtype, branch/account, balance;
  `--group-by=account,type,subtype`; `--name.contains=…`; `--json`.
- `list-connections` — `--group-by=connector,status`; `--json`.
- `list-credit-cards` — card number, balance, limits;
  `--group-by=account,subtype`; `--json`.
- `list-credit-card-bills` — due date, total, minimum, payment status;
  `--group-by=account,payment_status,due_date`; filters like
  `--due_date.ge=YYYY-MM-DD`; `--json`.
- `list-investments` — positions by `--group-by=account,type,subtype`;
  `--status=all|ACTIVE`; `--json` includes `db`, `parsed`, `raw_json`.
- `list-loans` — contract amount, due date;
  `--group-by=account,type,name`; `--json`.
- `list-categories` — upstream Open Finance category tree.
- `list-transfer-groups` — linked cross-account transfer groups.
- `inspect-config` / `validate-config` — resolved or validated config
  JSON.
- `check-database` — `PRAGMA quick_check`; read-only without
  `--repair`/`--backup`/`--vacuum`.

List commands share `--limit`/`--offset` and field filters
`--FIELD.OPERATOR=VALUE` (operators: `contains`, `eq`, `ne`, `lt`, `gt`,
`le`, `ge`).

Writes or side effects (run only when the human explicitly asks, never
for analysis): `credit-card-details` (live Banco MCP API call),
`sync`/`maintain` (write, need API key), `classify`/`precompute-assist`
(write suggestions), `detect-transfers` (write; requires `--date` or
`--start-date`/`--end-date`), `label-connection`/`label-account`/
`label-category`/`link-accounts` (interactive writes), `run`/
`rebuild-memory` (LLM cost, DB writes), `serve`.

## Schema

### Accounts
- `accounts(id, connection_item_id, type, subtype, name, balance_cents,
  raw_json, synced_at, …)`; `type` is `BANK` or `CREDIT`. Credit-card
  detail columns: `credit_brand`, `credit_level`, `credit_limit_cents`,
  `credit_available_limit_cents`, `credit_balance_due_date` and
  `credit_balance_close_date`. Bank detail: `bank_transfer_number`,
  `bank_branch`, `bank_account`.
- Friendly names: `account_labels(account_id, name)`; display name is
  `coalesce(account_labels.name, accounts.name)` (cards default to
  `BRAND (last4)` / `BRAND (LEVEL)`).
- Duplicate physical cards merged across connections: `account_groups` +
  `account_group_members` (`is_canonical`); non-canonical rows are hidden
  by the app — exclude them or aggregate via the canonical member.
- Manual connection labels: `connection_labels(item_id, branch, account,
  name)`.

### Transactions
- `transactions(id, account_id, occurred_at, amount_cents, currency,
  description, merchant_name, payment_type, status, raw_json, synced_at,
  amount_in_account_currency_cents, deleted_at, delete_reason,
  payer_document_key, receiver_document_key, merchant_document_key)`.
- `status`: `POSTED` (settled) or `PENDING` (may be future-dated
  scheduled installments — descriptions end `NN/NN`).
- Soft delete: filter `deleted_at IS NULL`.
- `payment_type` values include DEBIT, PIX, TED, BOLETO, PAGAMENTO,
  CREDIT, TRANSFERENCIA_MESMA_INSTITUICAO, RENDIMENTO_APLIC_FINANCEIRA
  (yield), RESGATE_APLIC_FINANCEIRA (redemption), FOLHA_PAGAMENTO,
  PACOTE_TARIFA_SERVICOS, TARIFA, CARTAO, CONVENIO_ARRECADACAO.
- FTS5 search: `transactions_fts`.

### Money sign conventions (verify before trusting sums)
- BANK accounts: expense `< 0`, income `> 0`.
- CREDIT accounts: purchases and installments `> 0` (DEBIT, PAGAMENTO);
  statement payments/refunds `< 0` (CREDIT, PAGAMENTO_FATURA).
- The CLI colors amounts by this sign (`src/db/transactions/present.ts`
  in the app repo); re-verify there if the convention ever changes.
- Money is integer cents: aggregate in cents, present with `/ 100.0`
  (never `/100` — integer division).

### Timestamps
- `occurred_at`/`synced_at` are UTC ISO strings. Confirm the effective
  offset from data (`SELECT substr(occurred_at,12,2) h, count(*) FROM
  transactions GROUP BY 1` — a spike marks local midnight). Bucket
  periods in local time, e.g. America/Sao_Paulo (no DST):
  `substr(datetime(occurred_at,'-3 hours'),1,7)` for year-month.
- Date-only columns (`due_date`, `purchase_date`) compare as `YYYY-MM-DD`.
- "This month" analyses must decide explicitly about PENDING future
  installments (include knowingly, or filter `status='POSTED'` and cap at
  today).

### Categories (upstream taxonomy)
- `categories(id, name, name_translated, parent_id, parent_name,
  raw_json)` — the provider's Open Finance category tree (ids like
  `05000000`); display `coalesce(name_translated, name)`. Local
  per-category presentation (icon/color/manual name) lives in
  `category_labels`.

### Labels (local classification taxonomy)
- `annotation_labels(id, name, parent_id, icon, color, sort_order)` —
  hierarchical; `id` is the slugified name chain (`viagens.f.rias` =
  "Férias" under "Viagens"). Top-level and nested slugs are distinct
  (`recorrente` vs `casa.recorrente`).
- Per-entry annotation: `entry_annotations(id, entry_type, entry_id,
  category_id, sub_category_id, notes, source, UNIQUE(entry_type,
  entry_id))`; `entry_type='transaction'`, `entry_id` = transaction id,
  `source` is `manual` or `suggested`.
- Join ladder:

      transactions t
      LEFT JOIN entry_annotations ea
             ON ea.entry_type='transaction' AND ea.entry_id = t.id
      LEFT JOIN entry_annotation_labels eal ON eal.annotation_id = ea.id
      LEFT JOIN annotation_labels l         ON l.id = eal.label_id

  LEFT JOIN keeps unannotated rows (NULL labels) — decide whether "no
  label" is its own bucket. Multiple labels per entry are possible:
  aggregate with `group_concat(l.name, ' | ')` per entry.

### Pending triage (classification suggestions)
- `annotation_assist_suggestions(entry_type, entry_id, status,
  proposal_json, examples_json, confidence, used_classifier,
  embedding_model, classifier_model, computed_at, review_status,
  reviewed_at, algorithm_version)`, PK `(entry_type, entry_id)`.
- `status`: `ok` (proposal generated) or `no_suggestion`;
  `review_status`: `pending` / `applied` / `dismissed`. Pending triage =
  `status='ok' AND review_status='pending'`.
- `proposal_json` contains `categoryId`, `subCategoryId`, `labelIds`
  (array of label ids); resolve names via `annotation_labels` and the
  local category tree (`annotation_categories`, nested via `parent_id`).
- Applied proposals are reflected in `entry_annotations` (source
  `suggested`).

### Credit cards
- `credit_card_bills(id, account_id, due_date, total_amount_cents,
  minimum_payment_cents, payment_status, raw_json)`.
- `credit_card_bill_transactions(bill_id, transaction_id, source[=
  transaction_metadata | inferred | manual], confidence)` links purchases
  to bills. Bill cycle runs close date to due date; monthly card spend is
  better computed from bill totals than transaction months.

### Investments
- `investments(id, connection_item_id, type, subtype, name, code,
  balance_cents, status, isin, quantity, unit_price_cents, total_cents,
  amount_cents, amount_withdrawal_cents, issuer, issuer_cnpj, rate,
  rate_type, purchase_date, due_date, taxes_cents, deleted_at,
  delete_reason)`.
- `investment_transactions(id, investment_id, occurred_at, type,
  amount_cents, quantity, raw_json)` — money in/out per position.

### Loans
- `loans(id, connection_item_id, type, name, contract_amount_cents,
  outstanding_balance_cents, installment_cents, paid_installments,
  total_installments, contracted_date, due_date, interest_rate,
  creditor)`.

### Internal transfers (not spend)
- `transfer_groups(id, kind, confidence, notes)` +
  `transfer_group_members(group_id, entry_type, entry_id, role)`.
- `kind`: `internal_transfer` or `investment_funding`. Exclude member
  entries from spend/income totals or both legs double-count; show them
  separately when relevant.

## Period comparison recipe (month vs month, year vs year)

1. Build the local-time bucket expression once (timezone rule above).
2. Split flows: money out, money in, transfers excluded or shown apart.
3. Aggregate per bucket × label for both periods side by side with a
   delta column; note where PENDING future installments skew totals.
4. Cross-check one figure (a single merchant total, or the stored
   `intelligence_runs` briefing for that period) before presenting.

If no list command fits an analysis, fall back to read-only SQL against
the tables above instead of ad-hoc scripts or writes.
