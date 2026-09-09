# Web Sync Tab

## Scope

The Sync tab starts OpenFinance sync and manual classify-assist precompute jobs.

Implementation:

- `src/web/client/pages/SyncPage.tsx`
- `src/web/client/components/sync/SyncProgressView.tsx`
- `src/web/client/components/classify-triage/PrecomputeProgressView.tsx`
- `src/web/client/hooks/use-background-job.ts`
- `src/web/server/job-routes.ts`

## Sync controls

Controls:

- Force upsert.
- Skip post-sync precompute assist.
- Clear pending assist.
- Start sync.
- Abort when a job can be aborted.

Force upsert bypasses incremental skips and re-upserts all rows.

Skip post-sync precompute assist prevents the automatic suggestion batch after
sync.

Clear pending assist deletes pending suggestions before recomputing.

## Sync job

Sync starts through:

- `POST /api/jobs/sync`
- `maintain --serve`, after the HTTP server is listening, by calling
  `jobs.startBackgroundSync()`. That path can email the classify-suggestion
  digest. The website Sync tab uses `jobs.startSync()`, which precomputes
  suggestions and does **not** send the digest. The Sync tab hydrates the
  running job from `/api/jobs/current` and SSE.

Progress is shown with `SyncProgressView`.

The view receives:

- running state
- live state
- persistent trails
- error
- done state

Errors from Banco MCP / network failures surface as multi-line text in
`JobErrorBanner` (title + mono details) and in a persistent toast. Messages
distinguish:

- cannot reach local web server when starting the job
- cannot reach Banco MCP (network / DNS / TLS)
- HTTP status and upstream body from Banco MCP

Abort uses:

- `POST /api/jobs/abort`

## Manual precompute

The tab exposes the same manual precompute action as Classify triage.

Manual precompute starts through:

- `POST /api/jobs/precompute`

Progress is shown with `PrecomputeProgressView`.

The Clear pending assist checkbox is shared with sync and precompute actions.
