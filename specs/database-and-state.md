# Database and State

## Storage

Runtime state is SQLite only through `storage.databasePath`.

The database stores:

- Synced Open Finance entities.
- FTS5 text search.
- Annotation categories.
- Nested annotation labels.
- Entry annotation labels.
- Embeddings.
- Transfer groups.
- Manual connection labels.
- Manual account labels.
- Searchable transaction peer document keys
  (`payer_document_key`, `receiver_document_key`, `merchant_document_key`)
  such as `cpf:39053344705` or `cnpj:11222333000181`.
- Intelligence markdown memory (`intelligence_memory`), **one document per
  named report id**.
- Stored report runs and chart blobs (`intelligence_runs`,
  `intelligence_run_charts`), **keyed by `report_id`**. See
  `specs/intelligence.md`.
- Per-call report model usage (`intelligence_run_model_calls`) and aggregate
  token and estimated-cost columns on `intelligence_runs`.
- Stored report chat transcripts (`intelligence_chats`), keyed by `report_id`
  and an optional seed run id.
- Report-scoped semantic taxonomy policies
  (`intelligence_taxonomy_policies`), keyed by `report_id`. Each row replaces
  the previous policy when its localized taxonomy hash changes; it is not an
  append-only run history.

Manual report runs may repeat for the same period. Scheduled runs store
`trigger_kind = 'due'` and a cadence/local-date `due_key`; a partial unique
index on `(report_id, due_key)` makes each scheduled occurrence idempotent.
The run, model-call rows, chart blobs, and report memory update commit in one
transaction.
`email_sent_at` is recorded only after SMTP succeeds; an unsent due run can be
delivered later from its stored content without creating another run.
`email_delivery_started_at` and an ownership token form an expiring claim used
to serialize overlapping delivery attempts. Stale workers cannot release or
complete a newer claim. A report run commits only when its captured
`memory_before` still matches current report memory.

Schema details are tracked in `PLAN.md`.

## No JSON state file

There is no JSON state file.

Out of scope:

- Memory versioning / rollback.
- `compact-state`.
- Checkpoint helper commands.
- `unified-report`.
- Sidecar `state-*.json` persistence.

## Annotation labels

`annotation_labels` are nested with optional:

- `parent_id`
- icon
- color

Sibling names are allowed under different parents through composite ids such as
`parent.child`.

## Database startup

`openDatabase()`:

1. Enables WAL mode.
2. Runs `PRAGMA quick_check`.
3. Before pending migration 030 clears legacy report artifacts, writes a
   standalone `VACUUM INTO` backup beside the configured database. This backup
   is mandatory when any legacy report, memory, chart, or chat row exists.
4. Runs each migration and its `schema_migrations` marker in one transaction.
5. Rebuilds FTS indexes.

FTS indexes include:

- `transactions_fts`
- `annotation_notes_fts`

Use `check-database --repair` if SQLite reports corruption.

## Daily backups

`maintain` writes a consistent standalone copy with `VACUUM INTO` before sync.

- Default directory: `<database-stem>-backups` beside `storage.databasePath`.
- File name: `<stem>-YYYY-MM-DD.sqlite` using the local date (`TZ`).
- The copy is restorable by itself (no `-wal` / `-shm` siblings).
- Same-day reruns replace that date's file.
- `--keep-days` (default 30) deletes dated backups whose filename date is older
  than today minus that many local days.
- Unrelated files in the backup directory are left alone.

To restore:

1. Stop `serve` / `maintain --serve`.
2. Replace `storage.databasePath` with the backup file.
3. Remove any leftover `-wal` / `-shm` siblings of the live database.
4. Start `serve` again.

## Query and write behavior

SQLite write helpers in `src/db/sqlite-query.ts` log failed statements with:

- `sql`
- `params`

The web API surfaces user-facing constraint messages through `{ error }`
payloads.
