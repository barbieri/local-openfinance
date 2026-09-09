# Intelligence

Named reports (daily / weekly / monthly / custom), live chat, and durable
markdown memory scoped per report.

## Answers that blocked the last session

### Bundled `@DEFAULT_BASE_INSTRUCTIONS@` after npm install

Source and unbundled development load
`src/llm/prompts/base-instructions.md` at runtime. The CLI build injects that
same Markdown into `dist/bundle/local-openfinance.mjs` through an esbuild
define. The build smoke-tests the standalone file, so copying only the `.mjs`
keeps the default instructions.

`examples/expenses/*.md` is **not** bundled. Those paths resolve relative to
the config file. A user who copies only the JSON without the topic directory
loses the overlay.

### Weekly example guidance

`examples/expenses/weekly.md` supplies the cadence-specific investigation
guidance: spend by category, transfers and investment funding versus lifestyle
spend, and comparison with prior markdown memory. Named reports will reference
this file through `reports[].prompts`.

## Replaced single-report scaffold

Migration 025 and the named-report routes replace this earlier scaffold:

- One Reports header tab. Inner hashes: `#/reports`, `#/reports/run/<id>`,
  `#/reports/chat`, `#/reports/chat/<id>`, `#/reports/memory`.
- `intelligence_memory` one row (`id = 'default'`).
- `intelligence_runs` with no report id.
- Config: singular `report` filters and global `intelligence.*`.
- Briefing engine: last-complete local week only.

Treat that as a scaffold. Do not add more single-report APIs.

## Named reports

Inspired by slack-manager-ai-helper `run-portfolio --due`: one config can
declare several scheduled jobs, each with its own prompt and window. Do
**not** copy that product’s analyses × targets × rollups × git report
archive. This repo has one household SQLite topic. The missing piece is
**several reports over the same data**.

### Config

Keep singular `report` as **shared transaction filters** (`accountIds`,
`includeUnannotated`). Intelligent reports analyze transactions; holdings remain
available as supporting tools rather than alternate report entry kinds.

Add `reports`: an ordered array of named report objects. Required per item:

- `id` — stable path-safe slug (`weekly`, `daily`, `monthly`, or custom).
  Unique. Not `chat`, `memory`, `run`, or `history`.
- `name` — display title on `#/reports`.
- `schedule` — when `--due` fires it (local timezone).
- `window` — which local dates the briefing/agent cover.
- `prompts` — ordered Markdown refs (tokens and/or paths relative to the
  config), same compilation rules as today’s `report.prompts`.

Optional per report:

- `language` — supported locale (`en-US` or `pt-BR`) for prose, taxonomy translations, formatting,
  charts, and email period text. Default: `pt-BR`.
- `send` — `always` (default for the example weekly), `alerts`, or `never`.
- `model` — override; else topic `model`.
- `agentBudget` — analyst steps, reviewer steps per round, and reviewer rounds.
  A non-empty taxonomy-policy cache miss adds at most one provider call, making
  the complete-run ceiling `1 + analyst + reviewer * rounds`.
  Defaults are 8, 4, and 2. The schema caps them at 16, 8, and 2.
- Filter overrides — inherit singular `report` when omitted.

`intelligence.*` thresholds stay topic-global unless a later need appears.
`intelligence.suggestionConfidenceThreshold` defaults to `0.82` and controls
when pending suggestions participate in report analysis.

Schedule kinds (local calendar, `TZ`):

- `daily` + `time` (`HH:mm`)
- `weekly` + `weekday` + `time`
- `monthly` + `day` (1–28 or `last`) + `time`
- `manual` — only `run --report <id>`

Window kinds:

- `last-complete-day`
- `last-complete-week` (already in `src/intelligence/period.ts`)
- `last-complete-month`

The `last-complete-month` window always covers the preceding calendar month
from its first through its last day; it is not a rolling 30-day window.
- explicit `start` / `end` only for ad-hoc CLI overrides, not for `--due`

Example weekly (behavior of the current product):

```json
{
  "id": "weekly",
  "name": "Weekly",
  "schedule": { "kind": "weekly", "weekday": "monday", "time": "08:00" },
  "window": { "kind": "last-complete-week" },
  "prompts": [
    "@DEFAULT_BASE_INSTRUCTIONS@",
    "expenses/weekly.md"
  ],
  "send": "always"
}
```

The expenses **pair** includes the same `weekly` and `monthly` reports in both
files so full vs minimal still resolve identically. The monthly report runs on
day 8 and its `last-complete-month` window spans the preceding calendar month.

### CLI

`run`:

- `--report <id>` — one report. Optional `--date` / `--start-date` /
  `--end-date` override the window (ad-hoc).
- `--due` — every report whose schedule matches the current local day, and
  whose `time` has been reached (same idea as slack-manager `run-portfolio
  --due`). Cron/systemd is the clock; this command is not a daemon.
- `--send` / `--dry-run` as already planned (nodemailer CID, not
  run-and-notify).
- Without `--report` or `--due`, refuse (no implicit single report).

`rebuild-memory` scans configured report windows from oldest to newest and does
not generate report HTML, charts, runs, or email. The scan builds one bounded
cross-period packet from deterministic `mustReport` candidates and their
profiles. Empty evidence writes the localized heading without a memory model
call. Non-empty evidence uses one direct structured memory generation per
report, independent of period count. The previous memory is used only for an
optimistic conflict check before replacement. `--quantity` defaults to `all`;
`--report` selects one report, and omitting it selects all configured reports.
The result exposes the model, total provider-call count, and separate taxonomy
policy and memory-generation usage. A missing or stale taxonomy policy adds at
most one report-level call. The command backs up SQLite before replacing memory.

`maintain --serve` does not generate reports. A systemd timer should call
`run --due --send` on an interval finer than the coarsest cadence (hourly
is enough for daily/weekly/monthly). Due selection is intentionally limited to
the current local date. A persistent timer can catch a missed hourly activation
later on the same eligible date, but it does not backfill prior dates; stored
delivery retry has the same same-date boundary.

### Routes

One header tab: Reports. Configured reports are **not** extra header tabs.

- `#/reports` — list configured reports (id, name, cadence, last run,
  alert count). Empty state if `reports` is empty.
- `#/reports/<reportId>` — **current page** for that report: latest run
  (html/markdown), not the catalog. Empty state + generate if none.
- `#/reports/<reportId>/run/<runId>` — one stored run.
- `#/reports/<reportId>/chat` and `#/reports/<reportId>/chat/<runId>` —
  chat scoped to that report (and optional seed run).
- `#/reports/<reportId>/memory` — that report’s markdown document.

Old hashes (`#/reports/memory`, `#/reports/chat`, `#/reports/run/<id>`
without a report id) should redirect to the first configured report or
404. Prefer redirect when there is exactly one report (`weekly`).

Transaction permalink `#/transaction/<id>` is unchanged.

### Persistence

`intelligence_runs` stores aggregate provider-call, token, duration, and
estimated-cost fields. `intelligence_run_model_calls` stores one row for each
taxonomy, analyst, or reviewer provider call. The report runner writes these
rows with the report, charts, and memory in one transaction.

New migration (do not reuse `024_intelligence.sql` in place):

- `intelligence_memory.id` becomes the report id (drop `CHECK (id =
  'default')`). One document per configured report. Seed heading-only
  markdown on first read, still without place/merchant names.
- `intelligence_runs.report_id` required, indexed
  `(report_id, created_at DESC)`.
- `updated_by` stays `user` | `weekly-agent` | `chat-agent` **or**
  generalize to `user` | `report-agent` | `chat-agent` (prefer the latter
  so daily/monthly are not “weekly-agent”).
- Existing `default` row, if any, migrates to `weekly` when that id exists
  in config; otherwise keep the row until the user runs a report.

Charts stay keyed by run id.

Chat transcripts persist in `intelligence_chats` with `report_id` and an
optional seed run id. Current-report and per-run conversations have stable ids.
An expiring, token-owned generation claim permits one active response per chat
and prevents stale workers from releasing a newer claim. Failed or aborted
streams release their claim without persisting a partial transcript.

### HTTP

Bearer token unchanged. Nest under report id:

- `GET /api/intelligence/reports` — from config, plus last-run summary
- `GET|PUT /api/intelligence/reports/:reportId/memory`
- `GET /api/intelligence/reports/:reportId/runs`
- `GET /api/intelligence/reports/:reportId/runs/:id`
- `GET|POST|DELETE /api/intelligence/reports/:reportId/chat` with optional `runId`.
  `DELETE` clears only that persisted transcript and writes a full database backup
  before deletion when the database is file-backed.
- `POST /api/intelligence/reports/:reportId/runs/:runId/regenerate` creates an
  in-memory preview using the current memory. `POST .../save-regeneration` with
  its preview id replaces that same run only after explicit user save.
- `POST /api/intelligence/tools/:name` with `reportId` in
  the body so briefing window and memory are scoped

The tool route exposes bounded, read-only tools for briefing, transactions,
transaction charts, accounts, investments, investment transactions, loans,
credit-card bills, and report memory. Each call resolves the configured report
window and effective filters first. Tool arguments can narrow a query but cannot
widen its dates or accounts. The two historical transaction tools require an
anchor transaction already allowed by the report
window and derives same-account and counterparty-document-key recurrence
server-side. `sameAccount` and `sharedCounterparty` are independent relation
flags, so a same-account recurring peer can have both flags. Cross-account
personal documents must retain the same payer/receiver role and transaction
direction; merchant CNPJs may match through either direction. The SQL query
applies this strong-peer predicate before `COUNT`, `LIMIT`, and `OFFSET`, so a
history request never materializes the complete candidate history in memory.
The strong-peer terms are defined once in the neutral peer-policy module and
generate both the SQL predicate and the in-memory relation check. SQLite
compilation exists only in the database history-query module. Members of
`transfer_group_members` are excluded from the cross-account
`sharedCounterparty` relation, including same-direction self-transfers;
same-account rows remain available for account-history analysis, and a strong
same-account peer may have both `sameAccount` and `sharedCounterparty` set.
It accepts no dates, account ids, or document keys, retains the report account
allow-list and annotation policy, and returns at most 50 rows.
`aggregate_classification_history` is the aggregate historical counterpart: it
requires an in-scope anchor transaction and resolves its effective dimension
inside the historical query module. Category resolution uses one expression,
`COALESCE(annotation.subCategoryId, annotation.categoryId,
category_override_id, category_id)`, for both the anchor and grouped rows. It
accepts no caller-supplied classification ids, dates, or accounts and applies the same account allow-list, visibility,
amount floor, and classification policy before grouping only over the derived
dimension IDs. Label joins are restricted to those IDs, so concomitant labels
do not leak into the result. Totals use the converted account amount and are
grouped and labeled with the account currency (`a.currency`).
Dimension keys and grouped rows are capped at 50 in SQL; the response returns
`cap` and `truncated` so the model can distinguish a complete result from a
capped one. `firstDate` and `lastDate` use the same credit-card purchase-date
expression as the historical filters.
List tools cap results at 50 rows and offsets at 5,000; memory is truncated at
50,000 characters with an explicit flag.
The editable report memory is also capped at 50,000 characters so every saved
document can be passed to the report and chat models without silent truncation.
Credit-card bill tools include only non-null due dates inside the report window.
Investments and loans are connection-level records without an account id. When
a report has a non-empty `accountIds` allow-list, connection-only investments,
investment transactions, and loans are excluded from tools and net worth rather
than widening the allow-list to every holding on a selected account's
connection. Leave `accountIds` empty to include connection-level holdings.

Individual transaction and investment-transaction results exclude amounts at
or below `minReportedItemAmountCents`. Briefing aggregates and transaction
charts still include those amounts. Model-visible transactions state
`classificationSource` as `confirmed`, `suggestion`, or `none`; a persisted
category-only annotation is confirmed. When `includeUnannotated` is false,
unclassified entries are excluded from briefing aggregates and list tools, and
pending suggestions do not count as confirmed classifications:
`get_transaction` and both historical tools reject a suggestion-only anchor.
The briefing net-worth snapshot groups bank, credit-card, investment, and loan
balances by currency. It never adds nominal cents from different currencies;
historical deltas compare only snapshots carrying the same currency.

Do not keep the unscoped `/api/intelligence/memory` once the nested
routes exist.

### PNG charts and email

Every generated run renders three deterministic 1200 by 640 PNG artifacts:
cash flow and balance, category allocation over time, and label allocation over
time. `specs/intelligent-reports.md` defines their windows, exclusions, axes,
localization, and current-period marker.

Chart totals include sub-floor items. PNGs are stored with their report run and
attached to one nodemailer message with stable CID references. SMTP passwords
come only from `notify.smtp.auth.passEnvVar`; messages, previews, logs, and
SQLite never contain the password. SMTP delivery always uses TLS: `secure: true`
starts TLS with the connection, while `secure: false` requires a successful
STARTTLS upgrade before authentication or report delivery. `--dry-run` still generates prose, HTML, and
PNG artifacts for validation, but neither persists a run or memory update nor
opens an SMTP transport.

A due run is persisted before SMTP delivery. Its `email_sent_at` remains null
until SMTP succeeds, so a later `run --due --send` reuses the stored prose and
charts instead of regenerating or permanently skipping a failed delivery.
Model-authored HTML cannot embed remote images; the email renderer adds only
the stored CID charts.

After an explicit CLI or background sync finishes assist precompute, the
attachment-free HTML sync digest is sent whenever any pending suggestion
remains. It separates entries absent from the precompute snapshot from entries
already pending before that snapshot and uses the current post-precompute proposal in both sections. The
original effective category uses `transaction_category_overrides.category_id`
when present and otherwise the provider-synced `transactions.category_id`; an
override suggestion is shown separately. Pending entries are unannotated, so
the per-row original-label column is explicitly `Sem etiqueta`. Suggested
local categories and labels use `Parent > Child`, plus the confidence score.
Website-triggered sync and standalone precompute do not send this digest.

The canonical post-sync orchestrator is used only by CLI and background sync
paths that can deliver SMTP mail. It snapshots pending entry IDs before
precompute and compares that snapshot with the final pending set. Entries absent
from the snapshot form the new-classifications section; entries already present
form the previous-classifications section. Website sync calls precompute directly
and never captures the mail snapshot or delivers the digest.

The agent returns a plain-text subject, a sanitized HTML body fragment, and
Markdown memory. `specs/intelligent-reports.md` owns the report contract,
allowed classes, semantic links, deterministic briefing packet, and locale
behavior. The legacy `intelligence_runs.markdown` column stores the derived
plain-text fallback for terminal, chat seed, and email clients that do not
render HTML.

Digest delivery has distinct `sent`, `dry-run`, `skipped`, and `failed`
results; a dry-run never reports itself as sent.

Persistence uses optimistic concurrency for report memory: if another run
updates the same report while generation is in progress, the stale result is
rejected instead of overwriting that memory. SMTP retries acquire an atomic,
token-owned, expiring database claim so overlapping `--due --send` processes do
not deliver the same stored run concurrently. Nodemailer connection and socket
timeouts expire before the claim lease.

Rendering uses the pinned DejaVu Sans TTF files with system-font loading
disabled, so identical chart inputs produce identical PNG bytes across hosts.
Report chart generation rejects mixed-currency datasets instead of adding
nominal amounts and labeling the result as one currency. One-day balance charts
render their sole observation as a visible marker.

### Prompts and briefing

Each report’s `prompts` are the investigating-agent instructions for that
cadence. Shared evidence-handling stays in
`src/llm/prompts/base-instructions.md`. Cadence-specific files (topic
overlay) must include, at least for weekly:

- spend by annotation category / sub-category
- transfers and investment funding vs lifestyle spend
- leak vs peak vs trend; classification-lag caveats
- label-combination episodes (no hardcoded place names)
- rare large events; R$ floor from `intelligence.minReportedItemAmountCents`
- cite permalinks `#/transaction/<id>`

Report generation performs three passes: an analyst draft followed by two
sequential review rounds. The analyst and both review rounds are
tool-calling agents. A single reviewer configuration is reused for both rounds;
each round receives the complete validated `ReportGenerationOutput` returned by
the previous pass and returns another complete `ReportGenerationOutput`.
Reviewers must investigate material claims, recurrence, and relevance with the
available tools before deciding what to preserve, rewrite, remove, or add.
There are no decision, patch, or binary-verification contracts. The complete
output is parsed at the model boundary after the analyst and after every review
round, before the next round or rendering.

Tool responses, transaction text, serialized report content, and persisted
memory are explicitly delimited and treated as untrusted data rather than
instructions. Weekly dates include the day of month and weekday; monthly dates
include only the day of month.

Daily/monthly overlays can be shorter; they still must not dump the full
timeline.

`buildReportBriefing()` owns the report packet and always takes the resolved
window. It contains only the deterministic report analysis and net-worth
snapshot; the superseded alert/episode/rare-event briefing pipeline is not run.
Transaction facts prefer credit-card purchase date over statement posting
date. Category and label profiles use the bounded historical window described
in `specs/intelligent-reports.md`. Net worth compares with the preceding
same-report run and the latest same-report run at least 28 days old.

### What not to take from slack-manager portfolio

- Separate analysis vs target vs rollup vs maintenance
- Git report archive / Handlebars path templates
- `run-and-notify`
- Workday-only calendars as the primary schedule

Do take: `--due` as schedule filter, each job’s own prompt + window,
stable ids, cron as the external timer.

## Completed slices

The named-report implementation is complete. Each slice remains one
independently reviewed commit in the series.

4. ✅ **Named reports (config, migration, hashes, APIs, example prompts).** No
   LLM. Add `reports[]`, point `#/reports` at the catalog and
   `#/reports/<id>` at the current page, and keep the example pair
   behaviorally identical (single `weekly`).
5. ✅ Agent tools wrapping existing query APIs plus briefing helpers; HTTP
   `POST /api/intelligence/tools/:name` with `reportId`; caps;
   `classificationSource`; line-item floor.
6. ✅ PNG charts (overlays, trendlines) + nodemailer CID `--send` /
   `--dry-run`; standalone CLI prompt embedding.
7. ✅ `ToolLoopAgent`, `run` / `run --due`, and atomic run + memory
   persistence per `report_id`. Due runs use one unique local-date key per
   report and cadence. `--dry-run` performs generation and chart rendering but
   skips run, chart, memory, and SMTP writes. Live evaluation against
   `examples/tmp/openfinance.sqlite` completed with the configured model.
8. ✅ Reports UI: catalog, current page, history with sanitized HTML and stored
   charts, and persisted streaming chat (`useChat`) seeded from
   `#/reports/<id>/chat/<runId>`. The server accepts only one new text user
   message extending the exact stored transcript and keeps all tools scoped to
   the report or seed-run period. Model-authored images are discarded,
   failed chat turns can be retried or edited, and a no-run report shows the
   exact CLI generation command.
9. ✅ Hourly persistent systemd `run --due --send` timer, bounded oneshot
   service, operator instructions, and documentation polish.

### How to continue on another machine

1. Sync this branch (history may have been rewritten with fixups).
2. Read this spec first, then `AGENTS.md` (commit series + slice review).
3. All report slices are complete. Run `pnpm run qa` and inspect the series
   before opening the PR.
4. If review adds a fixup, `git rebase --autosquash` onto the series base so
   each slice remains one commit.
