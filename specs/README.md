# Specifications

This directory holds product and technical specifications for
`local-openfinance`.

Update these files when behavior changes. Keep `AGENTS.md` focused on how to
work in the repository.

## Cross-cutting specs

- `cli-commands.md` - user-facing CLI commands and shared flags.
- `config-and-validation.md` - JSON artifacts, config, Ajv, and prompt
  validation.
- `database-and-state.md` - SQLite state, migrations, and database
  conventions.
- `sync-openfinance.md` - Banco MCP sync, normalized fields, and incremental
  behavior.
- `llm-analysis.md` - LLM provider behavior.
- `ai-usage-and-cost.md` - report and embedding token usage, estimated cost,
  and model evaluation controls.
- `web-app.md` - shared web app shell, security, formatting, i18n, references,
  jobs, and route conventions.
- `intelligence.md` - named reports (daily/weekly/monthly), markdown
  memory, Reports tab routes, `--due`, and intelligence HTTP.
- `intelligent-reports.md` - deterministic report analysis, semantic
  exclusions, HTML output, charts, and memory rebuilding.
- `npm-publish.md` - package publishing behavior.

## Web tab specs

- `web-transactions-tab.md`
- `web-credit-cards-tab.md`
- `web-investments-tab.md`
- `web-loans-tab.md`
- `web-accounts-tab.md`
- `web-connections-tab.md`
- `web-categories-tab.md`
- `web-labels-tab.md`
- `web-classify-triage-tab.md`
- `web-sync-tab.md`

## Focused feature specs

- `account-balance-over-time.md`
- `classification-trends.md`
- `credit-card-statement-correlation.md`
- `investment-position-history.md`
