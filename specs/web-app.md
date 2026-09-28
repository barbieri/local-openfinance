# Web App

## Stack

The web UI is served by the `serve` command.

Implementation stack:

- Vite
- React
- Hono

Source lives in `src/web/`.

Specification background: `PLAN_WEB_APP.md`.

## Tabs

Tab order:

1. Transactions
2. Reports
3. Credit Cards
4. Investments
5. Loans
6. Accounts
7. Connections
8. Categories
9. Labels
10. Classify triage
11. Sync

`src/web/client/App.tsx` lazy-loads tab pages with `React.lazy` and `Suspense`.

Desktop header shows the app title and horizontal tabs.

Mobile (`max-sm`) hides the title and uses a full-width select for the current
tab.

## Security

The web UI is for personal localhost use only.

- Bind `127.0.0.1`.
- Authenticate with `LOCAL_OPENFINANCE_WEB_TOKEN`.
- The token can be passed through `?token=` for first-run exchange or entered
  in the login form. The client removes `?token=` from the URL before it sends
  the login request.
- `POST /api/auth/login` validates the token and sets a host-only, `HttpOnly`,
  `SameSite=Strict` cookie scoped to `/api`. The cookie contains a random
  256-bit session id, not the token, and lasts for 400 days unless the user
  logs out first. SQLite stores only a domain-separated SHA-256 hash of the
  session id. The hash also depends on the current web token, so token rotation
  invalidates existing sessions. Logging in with an existing session rotates
  it atomically so the previous cookie cannot be replayed. Login request bodies
  are limited to 1 KiB before JSON parsing.
- The browser client sends the cookie with same-origin requests. It does not
  store the web token in Web Storage or add an `Authorization` header. On the
  first load after an upgrade, it removes and exchanges the legacy
  `local-openfinance.web-token` session entry before sending the login request.
- `GET /api/auth/session` checks the persisted session and extends its 400-day
  expiry without changing the session id. `POST /api/auth/logout` deletes the
  persisted session before it expires the cookie. Logout is idempotent and
  still expires stale or malformed cookies. A copied cookie cannot be replayed
  after logout.
- Cookie-authenticated `POST`, `PUT`, `PATCH`, and `DELETE` requests require
  `X-Local-OpenFinance-CSRF: 1`. Login requires the same header. The API does
  not allow cross-origin requests.
- API clients can continue to use `Authorization: Bearer <token>`. A valid
  Bearer request does not require the CSRF header on protected routes. The
  idempotent logout route requires the header for every caller. An invalid
  `Authorization` header fails with 401 on protected routes even if the request
  also has a valid cookie.
- The header menu after Sync contains language selection and log out.
- The language defaults to the browser locale and an override is stored in
  `sessionStorage` for the current browser session.
- Log out calls the server, revokes the persisted session, expires the cookie,
  clears cached API data, and re-prompts. The client keeps the authenticated UI
  and reports the error when the request fails so the user can retry.
- 401 responses clear cached API data and re-prompt.
- Unknown `/api/*` routes return JSON 404 instead of the SPA `index.html`.

This is not production-grade security.

Generate a token with:

```sh
openssl rand -hex 32
```

## Tailscale Services

Optional: when `LOCAL_OPENFINANCE_TAILSCALE_SERVICE` or `--tailscale-service` is
set, `serve` advertises this host as a
[Tailscale Service](https://tailscale.com/docs/features/tailscale-services)
after the local HTTP server listens.

- Implementation: `src/web/server/tailscale-service.ts`.
- Advertise: `tailscale serve --service=svc:<name> --https=<port> --yes 127.0.0.1:<localPort>`.
- Drain on SIGINT/SIGTERM so the Service stops accepting new connections.
- Failures to advertise are logged; the local UI still runs.
- Prerequisites (operator, not app-enforced): Service defined in the admin
  console, tag-based identity on the host, `tailscale` on `PATH`, host approval
  or auto-approvers.
- Env: `LOCAL_OPENFINANCE_TAILSCALE_SERVICE`, optional
  `LOCAL_OPENFINANCE_TAILSCALE_HTTPS_PORT` (default `443`).

## API validation

Write routes use JSON request bodies validated by Ajv against
`schemas/web-api.schema.json` through `src/web/server/validate-body.ts`.

Malformed input returns HTTP 400 with predictable messages.

Validated write routes include:

- classification
- category override
- transfer detect/confirm/link
- intelligence memory

## Reports

The Reports tab lists configured named reports with ids, schedules, latest-run
timestamps, and alert counts. A report page renders stored run Markdown without
raw HTML or Markdown images, displays only the persisted balance and allocation
PNGs, and provides run history, editable per-report memory, and a taxonomy-policy screen grouped by category or label root path. The policy screen shows generated and user decisions, identifies each row and group as a category or label, displays each entry with its configured icon and color, filters by treatment and taxonomy kind, and searches paths without case or diacritic sensitivity. It allows treatment overrides and can clear an override back to its generated value. A report with no
runs shows a copyable, shell-safe CLI generation command.

Current-report chat and chat seeded from a stored run use persisted transcripts.
Each streamed request must extend the exact server transcript with one text-only
user message. The server scopes the model tools to the named report and, for a
seeded chat, to that run's period. Failed streams offer retry and edit actions;
the UI never appends a second user message behind an unpersisted failed turn.
Assistant messages render Markdown. Transaction anchors from report tools render
as links only when they target a supported local report route. Other model-authored
HTML remains text.
The chat view identifies its report and links back to the selected run. Chat can
update shared memory only after the user explicitly writes `Atualize a memória com:
<informação>`.

## Numbers and confidence

Always use:

- `FormattedNumber`
- `FormattedCurrency`
- `FormattedPercent`

Numeric UI should use `font-variant-numeric: tabular-nums`.

Confidence percentages use `Confidence`:

- red below 50%
- orange from 50% through 74%
- green at 75% or above

## i18n and locale

Supported UI locales:

- `en-US`
- `pt-BR`

Locale uses the browser locale with `en-US` fallback. Users can override it
from the header menu for the current browser session.

Shared locale resolution lives in `src/utils/locale-resolve.ts`.

Helpers:

- `resolveUiLocale`
- `resolveContentLocale`
- `parseRequestLocale`
- `resolveCategoryTranslationEnabled`

Behavior:

- Normalize BCP-47 tags, for example `pt-BR` to `pt`.
- Fall back to English.
- Drive category and MCC translated fields from the content locale.

## Table and URL state

Filters, column layout, and chart panel state live in the URL fragment, not
localStorage.

Examples:

- `#/tab`
- `#/transactions/s=...`
- `#/transaction/<uuid>` — dedicated transaction permalink. It is not a
  header tab. Back returns to the previous hash, or `#/transactions`.
- `#/reports` — catalog of configured named reports (not a run history).
- `#/reports/<reportId>` — current page for that report (latest run).
- `#/reports/<reportId>/run/<runId>`, `#/reports/<reportId>/chat`,
  `#/reports/<reportId>/chat/<runId>`, `#/reports/<reportId>/memory`,
  `#/reports/<reportId>/taxonomy` — history, chat, memory, and taxonomy policy
  **scoped to that report**. Chat and Memory are
  not header tabs. See `specs/intelligence.md`. Old hashes without a report
  id redirect when exactly one report is configured. Otherwise the Reports
  page rejects the ambiguous link.

Transaction table state is lz-string encoded when needed.

## Reference data

Reference endpoints return rows or trees plus `byId` maps:

- `GET /api/connections`
- `GET /api/accounts`
- `GET /api/categories`
- `GET /api/annotation-labels`

Resolve ids client-side with `useEntityRef`.

## Background jobs

Background jobs run in-process on the server.

They are not tied to a single HTTP request and can survive tab close while the
server process keeps running.

Events are broadcast over:

- `GET /api/jobs/events`

The shared `BackgroundJobsProvider` keeps the SSE subscription across tab
navigation and polls `/api/jobs/current` every 2 seconds as fallback.
It aborts the active SSE request when authentication ends or the provider
unmounts. An intentional abort does not trigger a final status refresh.

Multiple viewers are supported.

Opening Sync or Classify triage while a job is running replays buffered events
and subscribes live.

`maintain --serve` starts the HTTP server after backup/prune, then starts the
same sync job as the Sync tab so a daily restart is usable immediately.

Abort route:

- `POST /api/jobs/abort`

Current status route:

- `GET /api/jobs/current`

## Route modules

Web API route modules live under `src/web/server/`.

Important modules:

- `transaction-routes.ts`
- `transfer-routes.ts`
- `job-routes.ts`

Transaction list, charts, and search share
`parseTransactionFiltersFromRequest()` in `transaction-request.ts`.

## Development

Dev server:

```sh
pnpm run dev:web
```

Production:

```sh
pnpm run build
serve --config ...
```

`serve` resolves the Vite client build (`dist/client`) from several layouts:

- esbuild CLI bundle (`dist/bundle/*.mjs`) → sibling `dist/client`
- compiled server modules (`dist/web/server/`) → `dist/client`
- source via `tsx` (`src/web/server/`) → repo `dist/client`
- package/repo cwd fallback → `dist/client`

The published package includes both `dist/bundle` and `dist/client` so
`local-openfinance serve` works after install. Unknown `/api/*` routes still
return JSON 404; missing client assets yield a plain 404 for SPA routes.

Mockups live in `docs/web-mockups/index.html`.
