# CLI Commands

Register only durable, user-facing subcommands in `src/local-openfinance.ts`.
Each command should live in its own file under `src/commands/`.

Do not add CLI commands for one-off development data fixes, local migrations, or
bugs that will not recur after the root cause is fixed.

Use ad-hoc `sqlite3` or a temporary script under `scripts/` during development,
then delete the script when done.

## Implemented commands

`sync` pulls Banco MCP data into SQLite.

- Stderr progress uses persistent per-connection/account trails with checkmark
  lines.
- Pass `--quiet` to suppress progress.
- Skips merged alias accounts.
- Pass `--classify` to run the post-sync wizard.
- Pass `--no-precompute-assist` to skip the post-sync suggestion batch.
- Pass `--force-upsert` / `--force`, or set `sync.forceUpsert`, to bypass
  incremental skips.

`maintain` writes a restorable daily backup, prunes old backups, then syncs.

- Backs up the existing database with `VACUUM INTO` before sync.
- Backup files are `<stem>-YYYY-MM-DD.sqlite` in
  `<stem>-backups/` beside the database, or `--backup-dir`.
- Same local date overwrites that day's file.
- `--keep-days` (default 30) deletes dated backups older than that many local
  days.
- Skips backup when the database file does not exist yet.
- Without `--serve`, then runs the same sync and post-sync assist precompute as
  `sync`.
- Pass `--no-sync` to only backup and prune.
- Pass `--no-precompute-assist` to skip the suggestion batch.
- Pass `--serve` to start the local web UI after backup and prune, then start
  the same in-process background sync job as the Sync tab (`POST /api/jobs/sync`).
  The HTTP server listens before sync begins, so the UI stays usable and shows
  progress. Sync failures surface in the Sync tab; they do not prevent serve.
- Pass `--quiet` and `--force-upsert` / `--force` as on `sync`.
- Example systemd units: `examples/systemd/local-openfinance.service` plus the
  daily maintenance timer and service.

`precompute-assist` batches classify suggestions for unannotated transactions.

- Tier order: peer document (same account, then other accounts), merchant
  heuristic, strong example copy, then optional classifier LLM.
- Transactions with pending suggestions are skipped unless `--clear-pending` is
  set.

`check-database` runs `PRAGMA quick_check`.

- `--repair` rebuilds FTS indexes.
- `--backup` and `--vacuum` are optional.

`classify` runs interactive annotation with embedding/classifier suggestions.

`detect-transfers` links opposite-sign BANK account transactions across
checking/savings accounts.

- Requires `--date` or `--start-date`/`--end-date`.
- Confidence is the average linear amount/time score.
- Defaults are 500 cents and 24 hours.
- Prompts per pair unless `--no-prompt` is set.

`label-connection` sets branch, account, and display name for a synced
connection.

- The chooser shows recent transactions.

`label-account` sets a friendly display name for a synced account.

- The picker shows type/subtype, name, and recent transactions.

`label-category` sets custom display name, Material icon id, and color for an
upstream category.

`link-accounts` merges duplicate synced accounts.

- The interactive wizard detects duplicates by type/subtype/transfer number.
- It can also review linked groups to unlink.
- Explicit `--canonical`/`--alias`/`--unlink`/`--clear` are supported.

`serve` starts the local web UI on `127.0.0.1` only.

- See `web-app.md`.
- Optional `--tailscale-service` / `LOCAL_OPENFINANCE_TAILSCALE_SERVICE`
  advertises a Tailscale Service host for the local port.
- Optional `--tailscale-https-port` /
  `LOCAL_OPENFINANCE_TAILSCALE_HTTPS_PORT` (default `443`).

`list-connections` renders a grouped terminal view.

- Supports `--group-by=connector,status`.
- Supports `--json`.
- Highlights display name, branch/account, connector, and status.

`list-accounts` renders a grouped terminal view.

- Supports `--group-by=account,type,subtype`.
- Supports `--json`.
- Highlights display name, type/subtype, branch/account, and balance.

`list-transactions` renders a grouped transaction view.

- Sorts oldest first.
- Supports `--group-by=account,date`.
- Supports account CSV filter.
- Supports date shortcuts and partial selectors.
- Shows translated upstream category by default.
- Shows annotations, transfer marker, installments, and account suffix.
- Supports `--json`.

`list-credit-cards` renders a grouped terminal view.

- Supports `--group-by=account,subtype`.
- Supports `--json`.
- Highlights display name, type/subtype, card number, balance, and credit
  limits.

`list-credit-card-bills` renders a grouped terminal view.

- Supports `--group-by=account,payment_status,due_date`.
- Supports `--json`.
- Highlights due date, total, minimum payment, and payment status.

`credit-card-details` resolves a synced credit card by account id/name fragment
and fetches live Banco MCP bill details.

- `--json` emits bare fields.

`list-investments` renders a grouped terminal portfolio view.

- Supports `--group-by`.
- Supports `--status`.
- Supports `--json`.
- JSON includes `db`, `parsed`, and `raw_json`.

`list-loans` renders a grouped loan view.

- Supports `--group-by=account,type,name`.
- Highlights contract amount and due date.
- Supports `--json`.

`list-categories` lists upstream Open Finance categories.

`list-transfer-groups` lists linked transfer groups.

`validate-config` validates config with Ajv.

- JSON errors are written to stderr.

`inspect-config` prints resolved config JSON.

`run` generates an LLM report for one named report or all reports due now.

- `--report <id>` selects one `reports[]` entry.
- `--due` selects scheduled reports whose local day and time are due and skips
  a report already completed for that cadence and local date.
- `--date` / `--start-date` / `--end-date` override the configured window only
  for ad-hoc `--report` runs. A range override must resolve both endpoints.
- `--send` emails reports allowed by each report's send policy as HTML with CID
  charts. A failed scheduled delivery is retried from the stored run on the
  next `--due --send` invocation without rerunning the model.
- `--dry-run` generates prose, HTML, and PNGs without run, memory, chart, or
  SMTP writes. It still prints provider-call, token, and estimated-cost metrics.
  Opening an older database may still apply schema migrations.
- Without `--report` or `--due`, the command refuses to run.
- `examples/systemd/local-openfinance-reports.timer` invokes the paired oneshot
  service hourly with `--due --send`. The timer is persistent and the service
  timeout is 30 minutes. Operators configure the working directory, Node 26
  executable, topic config, model credentials, SMTP password, and timezone.
  Persistent activation and failed-delivery retry apply only while the current
  local date still matches the report schedule; `--due` does not backfill a
  prior weekly or monthly date.

`rebuild-memory` recreates report Markdown memory without generating reports.

- `--report <id>` selects one report. Omitting it selects every configured
  report.
- `--quantity <number|all>` selects the most recent report periods. The default
  is `all`.
- The command scans selected periods from oldest to newest. It builds a stable
  evidence packet of at most 64 KiB from `mustReport` candidates and their
  referenced profiles.
- Empty evidence writes the localized memory heading with zero memory
  generation calls. Non-empty evidence uses one direct structured generation
  per report, regardless of period count.
- Each JSON result identifies the model and reports `providerCalls`, evidence
  counts and UTF-8 bytes, taxonomy-policy source and generation usage, and
  memory-generation usage. A cached or empty taxonomy policy costs zero calls;
  refreshing it costs one. Memory synthesis costs zero or one additional call.
- The command replaces memory only after evidence collection, generation,
  validation, and compaction succeed. A concurrent edit rejects the replacement.
- Before opening the database for migrations or changing memory, the command
  writes `<database>.<timestamp>-before-rebuild-report-memory.sqlite` with
  `VACUUM INTO`.

## Shared list behavior

List commands accept:

- `--limit`
- `--offset`
- field filters as `--FIELD.OPERATOR=VALUE`

Supported field filter operators:

- `contains`
- `eq`
- `ne`
- `lt`
- `gt`
- `le`
- `ge`

yargs uses `.strictCommands()` rather than `.strict()` so unknown filter flags
pass through to the list layer.

## Shared enrichment

List handlers enrich connection rows with `display_name` from
`connection_labels` when set.

Account `display_name` / `account_display_name` use manual `account_labels`
when set.

Fallback account display names:

- bank accounts use `bankData.transferNumber`
- credit cards use `BRAND (last4)` or `BRAND (LEVEL)`

Connection labels do not override account names.

Bank account list rows may still inherit label branch/account when `bankData` is
missing.

Credit card list rows include grouped `credit_data` parsed from
`raw_json.creditData`.

Merged duplicate accounts hide alias rows and alias transactions.

Canonical account rows may include `merged_account_ids`.

## Shared flags

Most commands require:

- `--config`

`run` also accepts:

- `--report`
- `--due`
- `--date`
- `--start-date`
- `--end-date`
- `--send` / `--dry-run`
