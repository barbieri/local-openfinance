---
name: setup
description: >
  Install local-openfinance on Linux or macOS so the localhost web UI stays
  up and syncs daily. Use when the user asks to set up, install, onboard,
  first-run, configure, serve, systemd, launchctl, launchd, or "make it work".
  Also when Grok, OpenClaw, or another agent is told to read this repo and do
  the full setup. Slash: /setup
---

# Setup local-openfinance

You are installing this **web app** on the human's Linux or macOS machine.
The browser UI is the product. The CLI is how you install it and keep it
running.

Human-facing copy of the same jobs: `README.md` sections Setup, Keep the web
UI running, and Web UI. Config fields: `schemas/config.schema.json`.
Do not duplicate those catalogs. Follow the procedure here.

## Guardrails

- Never commit `.env`, `*.sqlite`, WAL/SHM, or backup copies.
- Never paste API keys, SMTP passwords, or the web token into git or issues.
- Do not edit tracked `examples/*.json` as the live config. Copy them out.
- Do not run `pnpm run qa` for a user install.
- Banks must already be connected in the Banco MCP workspace.

## Collect

Ask for anything still missing:

1. Banco MCP workspace API key (`OPENFINANCE_API_KEY`) from
   https://banco.mcp.ai/
2. Timezone (`America/Sao_Paulo` is the usual Brazil default)
3. Model provider and API key (`openai`, `anthropic`, `google`, `xai`,
   `openrouter`, `ollama`, …)
4. Confirm at least one bank is already connected in Banco MCP
5. Optional: SMTP if they want emailed reports. The JSON sets
   `notify.smtp.auth.passEnvVar` to `SMTP_PASS`. The password goes in `.env`
   as `SMTP_PASS=`. Gmail uses smtp.gmail.com:587 and an App Password.

## First run

Work from the git clone. `CLONE` is that directory.

1. `nvm use` (Node 26+, `.nvmrc`). `corepack enable` if `pnpm` is missing.
2. `pnpm install` then `pnpm run build` (needs `dist/bundle` and `dist/client`).
3. `cp .env.example .env` and fill:
   - `OPENFINANCE_API_KEY`
   - the model key
   - `TZ`
   - `LOG_LEVEL=warn`
   - `LOCAL_OPENFINANCE_WEB_TOKEN` from `openssl rand -hex 32`
   - `SMTP_PASS` when they want `run --due --send` (must match
     `notify.smtp.auth.passEnvVar` in the topic JSON)
4. Private topic (prompt paths are relative to the JSON file):

```bash
mkdir -p "$HOME/local-openfinance"
cp examples/expenses-minimal-config.json "$HOME/local-openfinance/expenses-config.json"
cp -R examples/expenses "$HOME/local-openfinance/"
```

5. Set `storage.databasePath` to `$HOME/local-openfinance/openfinance.sqlite`
   and `model.provider` / `model.model` to their keys. Edit `notify.smtp`
   `from` / `to` / `auth.user` to their email (keep `passEnvVar` as
   `SMTP_PASS`). Omit `notify` entirely if they do not want email.
6. `pnpm run local-openfinance validate-config --config "$HOME/local-openfinance/expenses-config.json"`

Resolve paths you will substitute into units:

```bash
CLONE="$(pwd)"
NODE="$(command -v node)"
CONFIG="$HOME/local-openfinance/expenses-config.json"
```

`NODE` must be Node 26. Prefer the nvm binary, not an old `/usr/bin/node`.

## Keep it running

Same three jobs on both OS:

1. Always on: `maintain --serve` (backup, web UI, then background sync)
2. 05:00 local: restart that job (new backup + sync)
3. Hourly: `run --due --send` (skip if they have no SMTP; still install the
   oneshot, they can enable it later)

Do not also run a foreground `sync` if you are about to start the service.
The service syncs itself.

### Linux

Copy `examples/systemd/*.service` and `*.timer` to
`~/.config/systemd/user/`. In `local-openfinance.service` and
`local-openfinance-reports.service` set:

- `WorkingDirectory=` `$CLONE`
- `ExecStart=` `$NODE dist/bundle/local-openfinance.mjs … --config $CONFIG …`

Then:

```bash
systemctl --user daemon-reload
systemctl --user enable --now local-openfinance.service
systemctl --user enable --now local-openfinance-daily.timer
systemctl --user enable --now local-openfinance-reports.timer
```

If user units die on logout (headless box): `loginctl enable-linger "$USER"`.

Check: `systemctl --user is-active local-openfinance.service` and
`systemctl --user list-timers`.

### macOS

Copy `examples/launchd/*.plist` to `~/Library/LaunchAgents/`. Replace
`__CLONE__`, `__NODE__`, `__CONFIG__`, `__HOME__` (`$HOME`), and `__UID__`
(`id -u`) in every file.

```bash
uid="$(id -u)"
mkdir -p "$HOME/Library/Logs"
launchctl bootstrap "gui/${uid}" "$HOME/Library/LaunchAgents/ai.mcp.local-openfinance.plist"
launchctl bootstrap "gui/${uid}" "$HOME/Library/LaunchAgents/ai.mcp.local-openfinance-daily.plist"
launchctl bootstrap "gui/${uid}" "$HOME/Library/LaunchAgents/ai.mcp.local-openfinance-reports.plist"
launchctl enable "gui/${uid}/ai.mcp.local-openfinance"
launchctl enable "gui/${uid}/ai.mcp.local-openfinance-daily"
launchctl enable "gui/${uid}/ai.mcp.local-openfinance-reports"
launchctl kickstart -k "gui/${uid}/ai.mcp.local-openfinance"
```

On older macOS, `launchctl load -w` each plist instead of bootstrap/enable.

## Hand off

Tell them to open `http://127.0.0.1:3847/?token=<token>` once. That is the
app. Classify and reports live there. CLI `classify` is only required to
*create* local annotation categories the first time.

Personal localhost only. See `SECURITY.md`.
