# Security

`local-openfinance` is a personal, local-first tool. It is not a multi-user
service and it is not production-grade remote authentication.

## What it stores

The SQLite database holds Brazilian Open Finance payloads (`raw_json`),
account numbers, merchants, tax document keys, annotations, embeddings, and
report history. Dated `VACUUM INTO` backups next to the database contain the
same data.

Treat the database file, WAL/SHM siblings, and backup directory as private.
Keep them off shared disks, public git remotes, and issue attachments.

## What leaves the machine

- Sync talks to Banco MCP with `OPENFINANCE_API_KEY`.
- Classification assist and named reports send transaction text, merchants,
  and sometimes CPF/CNPJ values to the configured model provider.
- Optional SMTP delivers report HTML and classify-suggestion digests.

Do not commit `.env`, the SQLite file, or backup copies.

## Web UI

The UI binds `127.0.0.1` only. `/api/*` requires `LOCAL_OPENFINANCE_WEB_TOKEN`.
The token may be bootstrapped with `?token=` and is then stored in
`sessionStorage` plus memory. Use Log out to clear both.

Optional Tailscale Service exposure still requires the token. Do not put the
token in `web.publicBaseUrl` or in emailed permalinks.

## Reporting

This is a personal project. If you find a vulnerability in a public copy,
open a private GitHub security advisory on the repository or contact the
maintainer from git history.
