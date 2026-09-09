# PLAN_WEB_APP.md — Local Web UI for local-openfinance

Implementation specification for the local-only web UI. See repository [`AGENTS.md`](AGENTS.md) for operational reference.

**Status (2026-09):** Phases 0–5 are complete for daily use (sync, browse, classify, label, charts, export, account merge, Reports).

## Stack decision

### Recommended: **Vite + React + Hono** (not Next.js, not HTMX)

| Option | Verdict | Why |
|--------|---------|-----|
| **HTMX** | Reject | Rich tables, wizards, keyboard batch classify, and charts need substantial client state. |
| **Next.js** | Reject for v1 | No SSR benefit; SQLite sync is a long-lived Node process anyway. |
| **Vite + React + Hono** | **Adopt** | ESM-native, direct imports from existing [`src/`](src/), fast dev loop. React familiarity applies. |

### Libraries

| Concern | Choice | Notes |
|---------|--------|-------|
| HTTP server | [Hono](https://hono.dev/) (`@hono/node-server`) | SSE, typed routes |
| UI / theme | [shadcn/ui](https://ui.shadcn.com/) + [Radixcn Banking preset](https://radixcn.com/create?preset=banking) | Finance-like visual: restrained palette, clear hierarchy, dense-but-readable tables |
| Icons | `react-icons/md` | Material Icons IDs stored in DB; render by id |
| Tables | TanStack Table v8 + TanStack Virtual | Grouping, column order, visibility |
| Data fetching | TanStack Query | Shared cache for connections/accounts/categories |
| i18n | [react-i18next](https://react.i18next.com/) | `en-US` + `pt-BR`; browser locale → fallback `en-US` |
| URL state | Custom minified codec (see below) | Filters + column layout in URL fragment |
| Charts | Recharts | Server-side aggregation via `/api/transactions/charts`; credit-card bills chart on Credit Cards tab |
| Styling | Tailwind CSS v4 | Matches shadcn Banking theme tokens |
| Dev | `concurrently` | Vite dev + Hono API |

**Dependencies:** all in root [`package.json`](package.json) — no `web/` workspace package. Frontend + server code live under [`src/web/`](src/web/).

---

## Visual design

- Base theme: **Radixcn Banking preset** — apply CSS variables / Tailwind theme extension from the preset export.
- Finance UX conventions:
  - Amounts right-aligned with `font-variant-numeric: tabular-nums` (see Number formatting).
  - Debits in muted red, credits in muted green (theme tokens, not hard-coded hex).
  - Dense table rows; sticky filter toolbar and column headers.
  - Column order: **most important left** (per-tab defaults documented below); user reorder persists in URL.
- Every user-visible string goes through i18n — labels, buttons, toasts, empty states, filter presets, tab names.

---

## Number formatting (mandatory everywhere)

**Rule:** never render a raw number in the UI. Always use shared formatters.

### CSS

All numeric cells/wrappers use:

```css
font-variant-numeric: tabular-nums;
```

Apply via a shared `.tabular-nums` utility on `<FormattedNumber>`, `<FormattedCurrency>`, `<FormattedPercent>` wrappers.

### React components (`src/web/client/components/format/`)

| Component | Behavior |
|-----------|----------|
| `FormattedNumber` | `Intl.NumberFormat(browserLocale, { useGrouping: true })` |
| `FormattedCurrency` | Grouping + **exactly 2** fraction digits + currency code/symbol from row |
| `FormattedPercent` | `99%` style via `Intl.NumberFormat` `style: 'percent'`; prop `decimals` default **0** |

Browser locale = i18n active locale (`en-US` or `pt-BR`). Fallback `en-US`.

### CSV export (separate from display formatting)

- Currency columns: `currency` code (e.g. `BRL`) + separate `{field}_cents` column with plain integer (no decimals).
- Display formatters are **not** used in CSV — raw codes + cents only.

---

## Internationalization

- Locales: **`en-US`**, **`pt-BR`**.
- Detection: `navigator.language` → map `pt*` → `pt-BR`, else `en-US`.
- Files: `src/web/client/locales/en-US.json`, `pt-BR.json`.
- All pages, table headers, filter labels, wizard steps, toasts, and chart legends must have keys in both files.
- Dates in UI: `Intl.DateTimeFormat` with active locale + config `TZ`.

---

## Security model (document prominently)

**Scope:** personal, localhost-only, low-volume, low-risk. **Not** production-grade auth.

- Bind **only** `127.0.0.1`. Port: `LOCAL_OPENFINANCE_WEB_PORT` (default `3847`).
- Token: `LOCAL_OPENFINANCE_WEB_TOKEN` in env (`openssl rand -hex 32`).
- Bootstrap: `http://127.0.0.1:3847/?token=…` → strip query via `history.replaceState` → token in **sessionStorage** and memory. Log out clears both.
- API: `Authorization: Bearer <token>` on all `/api/*`.
- Optional Tailscale Service announce via `LOCAL_OPENFINANCE_TAILSCALE_SERVICE` / `--tailscale-service` (still loopback + token; see `specs/web-app.md`).
- Single SQLite writer: concurrent sync → `409` (only one background job at a time).
- Document in `PLAN_WEB_APP.md`, `README.md`, `AGENTS.md`.

---

## Tab order (11 tabs)

Left-to-right in nav; **Sync last**. Desktop header shows app title + horizontal tabs; mobile (`max-sm`) uses a full-width select (title hidden). Log out sits after Sync.

| # | Tab | CLI / API source | Notes |
|---|-----|------------------|-------|
| 1 | **Transactions** | `list-transactions`, classify, `detect-transfers` | Collapsible filter sidebar; detail dialog; charts disclosure; CSV/JSON export of the full filtered set; shift-click range select |
| 2 | **Reports** | `run`, named reports | Viewer, history, chat, memory. Generation stays on the CLI |
| 3 | **Credit Cards** | cards + bills | Limits/balances; bills panel + due-date chart |
| 4 | **Investments** | `list-investments` | Status filter; portfolio totals |
| 5 | **Loans** | `list-loans` | Contract/outstanding columns |
| 6 | **Accounts** | `list-accounts`, `label-account` | Display-name edit dialog; jump to filtered transactions |
| 7 | **Connections** | `list-connections`, `label-connection` | Branch/account/name labels |
| 8 | **Categories** | `label-category`, category tree | Open Finance taxonomy presentation; local annotation categories stay on CLI classify |
| 9 | **Labels** | `annotation_labels` CRUD | Nested parent/child labels; icon/color inheritance |
| 10 | **Classify triage** | `precompute-assist`, assist queue | One-at-a-time Accept/Skip; precompute progress via SSE |
| 11 | **Sync** | `sync`, `precompute-assist` | SSE job log; skip/clear-pending options. Website sync does not email the suggestion digest |

---

## URL-persisted table state

Filters, sort, page size, column visibility/order, display badge modes (`display.category`, `display.labels`), and chart panel state (`charts.open`, `charts.tab`) serialize into the URL **fragment** (`#/transactions?s=<lz-encoded>` or `#/<tab>`). Uses lz-string compression with short filter keys. Not localStorage.

---

## Category labels

`category_labels` table + `label-category` CLI. Categories tab edits custom name, Material Icon id, and color. Open Finance categories are never mutated from classify or web UI. Defaults from `src/data/openfinance-category-defaults.json` apply on sync unless manually overridden (`*_manual` flags).

## Annotation labels

`annotation_labels` with optional `parent_id` (nested labels). Labels tab manages CRUD; children inherit unset icon/color from parent. Transaction filters and classification use label **ids** only.

## Background jobs (SSE)

`BackgroundJobsProvider` keeps a shared SSE subscription (`GET /api/jobs/events`) plus `/api/jobs/current` polling across tab navigation. Sync and Classify triage replay buffered events when opened mid-job. Only one writer job at a time (`409` when busy). Cooperative abort via `POST /api/jobs/abort`.

## Backend API summary

Implementation in [`src/web/server/server.ts`](src/web/server/server.ts) and [`src/web/server/job-routes.ts`](src/web/server/job-routes.ts). Key endpoints:

- Reference with `byId`: `/api/connections`, `/api/accounts`, `/api/categories`, `/api/annotation-labels`
- Entity lists: `/api/credit-cards`, `/api/credit-card-bills`, `/api/investments`, `/api/loans`
- Transactions: `/api/transactions` (filters, sort, pagination), `/api/transactions/:id`, `/api/transactions/:id/installment-plan`, `/api/transactions/search` (limit 1000, truncated flag), `/api/transactions/charts?chart=balance|category|label`
- Classification: `/api/classify`, `/api/classify/assist`, `/api/classify/suggest`, `/api/classify/triage`, `/api/classify/triage/:id/apply|dismiss`, `/api/transactions/:id/classification`, category override PUT/DELETE
- Annotation labels: `/api/annotation-labels` CRUD
- Labels (connections/accounts/categories): PUT `/api/connections/:id/label`, `/api/accounts/:id/label`, `/api/categories/:id/label`
- Account links (merge/unlink/dissolve): `/api/accounts/link-suggestions`, `/api/accounts/linked-groups`, `/api/accounts/link`, `/api/accounts/unlink`, `/api/accounts/dissolve-group`
- Transfers: `/api/transfers/detect`, `/api/transfers/confirm`, `/api/transfers/link`, DELETE `/api/transfers/link/:groupId`
- Jobs: `POST /api/jobs/sync`, `POST /api/jobs/precompute` (202), `GET /api/jobs/events`, `GET /api/jobs/current`, `POST /api/jobs/abort`

---

## Implementation phases

1. **Phase 0 — Mockups** ✅ — `docs/web-mockups/index.html`
2. **Phase 1 — Foundation** ✅ — `serve`, auth gate, i18n (`en-US`/`pt-BR`), formatters, URL fragment state, toasts (Sonner)
3. **Phase 2 — Read-only tables** ✅ — All entity tabs + `category_labels` / Categories tab
4. **Phase 3 — Mutations** ✅ — Classify (detail + triage), connection/account/category/annotation label edits, transfer detect/link/unlink in transaction UI, account merge wizard on Accounts tab
5. **Phase 4 — Jobs + export** ✅ — SSE sync/precompute, scoped detect-transfers dialog, CSV/JSON export of the full filtered set
6. **Phase 5 — Charts** ✅ — Transaction charts (balance line, category/label allocation pies/bars); credit-card bills chart

### Beyond original spec (also shipped)

- **Labels tab** — nested annotation label management
- **Classify triage tab** — precompute queue with Accept/Skip and installment bulk-apply
- **Transaction sidebar** — collapsible right overlay for filters, columns, and actions
- **Installment plans** — sibling detection, first-installment drill-down, apply-to-all checkbox
- **Assist precompute** — post-sync batch suggestions; `clear-pending` on Sync and triage
- **Open Finance category override** — per-transaction upstream category picker (sync-safe)
