# Config and Validation

## Machine-readable artifacts

- Machine-readable artifacts are JSON.
- JSON files are pretty-printed with 2-space indentation and a trailing newline.
- Validate persisted JSON with Ajv against `schemas/*.schema.json`.
- Example configs under `examples/` are tested against
  `schemas/config.schema.json`.

## Config documentation rule

When schema, loader, `config.example.json`, or config behavior changes,
`README.md` must document every field and constraint in
`schemas/config.schema.json`.

The schema is canonical.

## Example topic configs

`examples/expenses-config.json` (full) and
`examples/expenses-minimal-config.json` must resolve to the same
`ResolvedAppConfig`.

- Full file: include loader-defaulted fields at their default values as
  documentation.
- Minimal file: omit loader-defaulted fields.
- Specified fields must match.

Do not duplicate empty allow-lists that the schema rejects (`minItems: 1`).

Durable report memory is markdown in SQLite (`intelligence_memory`), one
document per named report id, edited on `#/reports/<id>/memory`.

Named reports live in config `reports[]` with an id, name, schedule, window,
prompt list, and optional delivery, model, or filter overrides. Singular
`report` stays as shared entry filters. See `specs/intelligence.md`.

Each report has a stable supported `language` (`en-US` or `pt-BR`, default `pt-BR`) which controls
prose, translated taxonomy names, dates, numbers, charts, and email period
formatting. `intelligence.suggestionConfidenceThreshold` defaults to `0.82`;
only pending suggestions at or above it participate as assumed classifications.
