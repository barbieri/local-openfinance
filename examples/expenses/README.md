# Expenses reporting example

Weekly household spending analysis over locally synced Open Finance data with
manual annotation categories.

## Files

- [`../expenses-config.json`](../expenses-config.json) — full topic config; spells out loader defaults.
- [`../expenses-minimal-config.json`](../expenses-minimal-config.json) — same behavior, omitting defaulted fields.
- [`weekly.md`](./weekly.md) — weekly named-report guidance used by both example configs.
- [`monthly.md`](./monthly.md) — monthly guidance for the preceding complete calendar month.

## Typical workflow

```bash
cp .env.example .env
# set OPENFINANCE_API_KEY, a model key, and SMTP_PASS (matches notify.smtp.auth.passEnvVar)

pnpm run local-openfinance sync --config examples/expenses-config.json
pnpm run local-openfinance classify --config examples/expenses-config.json
pnpm run local-openfinance run --config examples/expenses-config.json --report weekly
pnpm run local-openfinance run --config examples/expenses-config.json --report monthly
pnpm run local-openfinance run --config examples/expenses-config.json --due --send
```

After `sync`, pass `--classify` to run the wizard for newly synced entries, or run `classify` separately. The monthly report runs on day 8 and covers the complete previous calendar month.

See [`PLAN.md`](../../PLAN.md) for implementation status.
