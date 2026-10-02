# AGENTS.md - local-openfinance

This file is the canonical guide for humans and coding agents working in this
repository. Keep it accurate, but keep product and technical specifications in
`specs/` instead of growing this file.

## User setup (Grok, OpenClaw, and other agents)

If the human asked you to install, configure, first-run, or "make this work"
on their machine, stop reading this contributor guide and follow
`.agents/skills/setup/SKILL.md`. That skill installs the localhost web UI and
the Linux systemd or macOS launchd jobs that keep it serving and syncing.

This file is for people changing the code.

## Self-update protocol (required)

When you learn something durable about this project, update the relevant
documentation in the same change before finishing the task.

- If the new detail is agent guidance, workflow, conventions, tooling,
  operational steps, or a rule for how contributors should work, update this
  file.
- If the new detail is product behavior, UI behavior, API behavior, data shape,
  SQL schema behavior, command behavior, validation rules, or application
  architecture, update the best matching file under `specs/`.
- If no matching spec exists, create one and link it from `specs/README.md`.
- Do not duplicate existing guidance. Revise or remove stale bullets when
  behavior changes.

After a check fails or a review comment reveals a lesson, reflect on whether
the lesson will prevent a repeat. If it will, update the source that owns it
before finishing. Keep transient failures out of permanent guidance. In a
commit series, put general lessons in the first commit and fold a
slice-specific lesson into the commit that introduced that slice.

Never change non-owned installed skills in `~/.agent/skills/`,
`~/.agents/skills/`, or project `.agents/skills/` as part of self-update when
a skill lock tracks them. Report upstream corrections instead. A dependency
refresh with `npx skills update` is separate maintenance. For skills owned by
Gustavo, make the source change in
`barbieri-playground/skills/`, open a pull request for review, and update
downstream installations only after that pull request is merged.

Before finishing any task that touches config, including schema, loader,
`config.example.json`, or config behavior, check that `README.md` documents
every field and constraint in `schemas/config.schema.json`. Update `README.md`
in the same change if it is missing or stale. Treat the schema as canonical.

## Project overview

`local-openfinance` uses the Banco MCP REST API to synchronize Brazilian
OpenFinance data locally into SQLite. It annotates and labels entries for cost
segmentation and reporting.

Annotation can use embeddings and classifiers, including local models through
Ollama. Reporting and other LLM features use Vercel AI SDK model APIs.

Implementation roadmap: `PLAN.md`.

## Specification map

Start with `specs/README.md` when changing application behavior.

Key specs:

- `specs/cli-commands.md` - user-facing CLI commands and shared flags.
- `specs/config-and-validation.md` - JSON artifacts, config validation, and
  prompt validation.
- `specs/database-and-state.md` - SQLite state, migrations, and database
  conventions.
- `specs/sync-openfinance.md` - Banco MCP sync behavior and normalized fields.
- `specs/llm-analysis.md` - report model provider behavior.
- `specs/web-app.md` - shared web shell, security, i18n, formatting, and route
  conventions.
- `specs/web-transactions-tab.md` - Transactions tab.
- `specs/web-credit-cards-tab.md` - Credit Cards tab.
- `specs/web-investments-tab.md` - Investments tab.
- `specs/web-loans-tab.md` - Loans tab.
- `specs/web-accounts-tab.md` - Accounts tab.
- `specs/web-connections-tab.md` - Connections tab.
- `specs/web-categories-tab.md` - Categories tab.
- `specs/web-labels-tab.md` - Labels tab.
- `specs/web-classify-triage-tab.md` - Classify triage tab.
- `specs/web-sync-tab.md` - Sync tab.
- `specs/intelligence.md` - named reports, markdown memory, and Reports tab.
- `specs/npm-publish.md` - package publishing behavior.

Existing focused specs:

- `specs/account-balance-over-time.md`
- `specs/credit-card-statement-correlation.md`
- `specs/investment-position-history.md`

## Repository layout

```text
local-openfinance/
├── banco-mcp-openapi.json     # Banco MCP REST contract
├── schemas/                   # Ajv JSON Schemas
├── specs/                     # Product and technical specifications
├── skills/                    # Agent skills, installable with npx skills
├── examples/                  # Topic configs and prompt directories
├── src/
│   ├── local-openfinance.ts   # CLI entrypoint
│   ├── env.ts                 # dotenv, import first
│   ├── commands/              # One CommandModule per subcommand
│   ├── config/                # Config loading and validation
│   ├── openfinance/           # HTTP client and sync engine
│   ├── db/                    # SQLite migrations and query layer
│   ├── annotation/            # Categories, embeddings, classify wizard
│   ├── transfers/             # Cross-account movement linking
│   ├── state/                 # Shared state helpers
│   ├── scoring/               # Embedding/classifier providers
│   ├── llm/                   # Model generation helpers and bundled prompts
│   ├── intelligence/          # Named reports, briefing, agent, charts, mail
│   ├── web/                   # Vite React client and Hono server
│   └── utils/                 # Paths, JSON, local time, helpers
├── tests/                     # Vitest unit tests
├── scripts/                   # Build, prepare, smoke, import scripts
├── PLAN.md                    # Engineering plan and SQL DDL
└── README.md                  # User documentation
```

## Tooling

- Use `nvm use` before running project commands. `.nvmrc` pins the required
  Node version, currently 26+ for built-in `node:sqlite`.
- SQLite uses `import { DatabaseSync } from 'node:sqlite'`; do not add
  `better-sqlite3` or another DB npm dependency.
- TypeScript extends `@tsconfig/strictest` with `"types": ["node"]`.
- pnpm v12 is the package manager. `packageManager` pins the pnpm version.
- Install that pinned pnpm version before running commands. `pnpm-workspace.yaml`
  sets `pmOnFail: ignore` so pnpm does not prepend a package-manager document
  to `pnpm-lock.yaml` during ordinary commands.
- `pnpm-workspace.yaml` allows the `esbuild` postinstall needed by the CLI
  bundle step.
- Biome handles formatting and linting. TypeScript and JavaScript use single
  quotes.
- Vitest is the test runner.
- Pino is used for structured trace logs.
- yargs handles CLI command and option parsing.
- `@inquirer/prompts` powers interactive CLI flows.
- `chalk` and `marked-terminal` format terminal output and markdown reports.

## Formatting and QA (required)

- TypeScript and JavaScript use single quotes. JSON files keep standard double
  quotes.
- Every commit requires a passing `pnpm run qa`. Run `nvm use`, then `pnpm run
  qa` before handing work back and before committing.
- `pnpm run qa` runs check, build, test, typecheck, and React Doctor in
  parallel.
- Use `pnpm run check:fix` for Biome formatting and safe lint fixes, then rerun
  `pnpm run qa`.
- `.husky/pre-commit` enforces `pnpm run qa`. Never disable, bypass, or weaken
  this hook, and do not commit with failing QA.
- GitHub Actions `.github/workflows/qa.yml` runs the same `pnpm run qa` on
  `master`/`main` and pull requests. It must not load a personal `.env` or call
  model providers.
- React Doctor is configured by `doctor.config.json`. It is part of `pnpm run
  qa` and **blocks on warnings**. The `deslop/unused-dev-dependency` rule is
  off for CLI-only dev dependencies such as `pino-pretty`.
- Subscribe to `window.location.hash` with `useSyncExternalStore`, not
  `useState` plus a `hashchange` `useEffect`.
- Destructure `useQuery()` results (`data`, `isLoading`). Do not assign the
  whole query object.
- Combine `.filter().map()` into one pass in files React Doctor scans.

## Task routing and real-data evaluation

- For work that is not clearly simple, agents must load the project-local
  Poteto Mode workflow (`.agents/skills/poteto-mode/SKILL.md`) before work and
  load and run the project-local Thermos workflow
  (`.agents/skills/thermos/SKILL.md`) before handoff, unless the user explicitly
  opts out. Do not wait for the user to name either workflow.
- For Codex, use native subagents for upstream `Task` roles. In Thermos,
  give one reviewer `.agents/skills/thermo-nuclear-review/SKILL.md` and another
  `.agents/skills/thermo-nuclear-code-quality-review/SKILL.md`, then synthesize
  their findings.
- The two workflows above are installed with `npx skills` under
  `.agents/skills/`. `skills-lock.json` locks both external installs. Do not
  edit the installed skill files or their lock entries by hand.
- If `npx skills update` skips `ai-sdk`, `pr-review-canvas`, or
  `thermo-nuclear-code-quality-review` with a multiple-path warning, refresh
  them from their skills.sh sources with:

  ```sh
  npx skills add vercel-labs/ai -s ai-sdk -y --copy
  npx skills add cursor/plugins -s pr-review-canvas -s thermo-nuclear-code-quality-review -y --copy
  ```

  The CLI updates `skills-lock.json` and the installed copies. Review both
  before committing.
- Treat documentation-only changes, visual HTML/CSS adjustments, and simpler
  or trivial code as simple tasks. New specifications, architecture, modules,
  or changes that touch more than five files are not simple tasks.
- Use `.agents/skills/code-review/SKILL.md` to review a branch against its
  originating issue or specification when one exists. The paired setup guide
  is `.agents/skills/setup-matt-pocock-skills/SKILL.md`.
- Add a test only when it covers behavior or a regression that existing tests
  do not cover. Do not add duplicate assertions, mirrored examples, or tests
  that only repeat an existing path. State the uncovered behavior the test
  proves.
- When a user asks to check with real data, reading the available configuration
  and database and sending that data to the configured model provider is
  authorized and expected. This includes gitignored and `tmp/` artifacts, or
  paths explicitly supplied by the user. Do not ask separately for permission.

## Read-only database analysis

Agents that query the local SQLite database for analysis read
`skills/local-openfinance-analysis/SKILL.md` first. It documents the core
tables (transactions, annotations/labels, triage suggestions, credit
cards, investments, loans, transfers) and the money sign, UTC timestamp,
and soft-delete conventions, and requires read-only access to the live
file. Schema or convention changes that affect analysis update that skill
in the same change.

The root `skills/` directory is published for other projects:
`npx skills add <owner>/<repo>`. `skills/local-openfinance-analysis` is
symlinked into `.agents/skills/` so in-repo agent sessions discover the
canonical copy. Do not add locally authored skills to
`skills-lock.json`; that lock tracks external installs only.

## Data safety

- Never destroy user data. Before an operation that may be destructive,
  including database migrations or SQL `DELETE`, `UPDATE`, `DROP`, or `ALTER`,
  make a full timestamped copy named with the change slug, such as
  `20260826T123456-before-recreate-report-memory`.
- Apply the same backup rule to configuration and every other changed artifact
  that is not already tracked by Git.
- `pnpm run qa` rebuilds `dist/bundle/`, which the installed service and report
  timer execute directly. Add and test a destructive migration's backup gate in
  the same slice before the first build so a scheduled job cannot apply an
  intermediate migration without its matching backup.

## Code conventions

- The package is ESM (`"type": "module"`).
- TypeScript imports use `.js` extensions.
- Use `readString` and `readFieldString` for string fields that should trim
  whitespace and convert blanks to `null`.
- Add new scoring and analysis providers in `src/providers.ts`.
- Persist identifiers and display names:
  - UI pickers may display human-readable names and paths.
  - APIs, assist proposals, and SQLite writes should use stable ids.
  - Resolve legacy name/path references only when reading old stored proposals.
- SQLite write helpers in `src/db/sqlite-query.ts` log failed statements and
  return user-facing constraint messages through web API `{ error }` payloads.
- Use cached dynamic `Intl` helpers from `src/utils/intl-formatters.ts`.
- Hoist static formatters at module scope or use `useMemo` in React when locale
  and options are stable per render.
- For independent async work over many items, use `mapInParallel` from
  `src/utils/map-in-parallel.ts` or `Promise.all` for small batches without
  shared mutable state.
- Prefer `.toSorted()` when you need a sorted copy and the source array is still
  referenced elsewhere.
- When you already allocated a throwaway array, such as `[...map.entries()]`,
  sort that copy in place instead of chaining `.toSorted()`.
- Minimize change scope and match existing Biome-formatted style.
- Do not commit secrets, `tmp/`, or browser profile data.
- Code and documentation should not use absolute paths to project files. Use
  project-relative paths.

## Example topic configs

`examples/expenses-config.json` and `examples/expenses-minimal-config.json`
must stay behaviorally identical.

- The full file lists every loader-defaulted field at its default value so
  readers can see what would be used and copy a starting point for custom
  configs.
- The minimal file omits every field that has a loader default.
- Specified fields (required fields, and any non-default choice) must match
  in both files.
- Do not put empty `sync.connections` or `report.accountIds` arrays in the
  full example; the schema forbids `minItems: 1` empty lists, and omitting
  them is the default (“all”).
- `tests/config.test.ts` asserts the resolved configs are equal and that
  defaulted leaves are present only in the full file.

See `specs/intelligence.md` for prompt loading, topic overlays, and named
report behavior. Edit source markdown prompts under `src/llm/prompts/` when
changing bundled default instructions.

## React implementation guidance

See `specs/web-app.md` and its tab-specific specs for routes, architecture, and
web behavior.

- For React form/dialog state, when several scalar values are reset together,
  store them in one object state with readonly fields and update through one
  setter.
- Prefer render-time sync from props/keys over `useEffect` for prop-to-state
  alignment.
- When resyncing derived fields after reference data loads, overwrite only
  fields the user has not customized.
- Keep separate `useState` calls when fields are independent.

## CLI implementation guidance

Register only durable, user-facing subcommands in `src/local-openfinance.ts`.
Use one file per command under `src/commands/`.

Do not add CLI commands for one-off development data fixes, local-state
migrations, or bugs that will not recur after the root cause is fixed. Use
ad-hoc `sqlite3` or a temporary script under `scripts/` during development, then
delete the script when done.

Command behavior is specified in `specs/cli-commands.md`.

Example systemd units live in `examples/systemd/`.

## Commit series for review

Each slice in a to-be-submitted series should be **one commit** with the
finished behavior of that slice.

Before a pull request, inspect the complete branch range from its merge-base
with `master`. A later commit in the branch must not repair or delete code
introduced by an earlier branch commit. Use a fixup and autosquash that change
into its introducing commit. Keep independent improvements as separate
commits, and keep fixes to code already on `master` separate.

When QA or an independent review finds bugs in a slice already committed on
the branch, do **not** leave a follow-up `fix:` commit in the published
history. Record a fixup and fold it into the original slice before the branch
is handed over:

```sh
git commit --fixup=<slice-commit>
git rebase --autosquash <series-base>
```

`<series-base>` is the commit the PR starts from (the parent of the first PR
commit). Example: for a series that starts after `39cbe18`, rebase onto that
commit.

Do not publish `feat:` then `fix:` for the same slice. Reviewers should see
the corrected slice, not the mistake and the patch.

Before a nontrivial change is ready for a pull request, complete the review
routing above. Then use
`.agents/skills/make-pr-easy-to-review/SKILL.md` to prepare the history and
reviewer guidance. For a messy private linear series, use
`.agents/skills/git-history-cleanup/SKILL.md`. Do not leave a commit that
introduces behavior later fixed within the same change set. Fold that
correction into its introducing commit. Keep distinct improvements separate.

## Multi-slice agent work

For a large feature split into slices (see `specs/intelligence.md`):

- Implement **one slice at a time**. Do not run parallel worktrees or
  parallel implementers on this repo unless the user asks; it burns tokens
  and collides on shared files (`App.tsx`, hash routing, migrations).
- After the slice is committed, run a **fresh** review subagent that does
  **not** resume the implementer and does **not** receive implementer
  notes. Give it the user request, the plan, the slice id, and `git show`.
- If implementer and reviewer disagree, launch a **tie-break** subagent
  (no loyalty to either). Treat its verdict as the gate for the next slice.
- Fold review fixes with `--fixup` as above before starting the next slice
  when practical, and always before the series is submitted.

## Intelligence behavior

See `specs/intelligence.md` for report routes, prompt rules, email delivery,
live evaluation, and implementation history.
