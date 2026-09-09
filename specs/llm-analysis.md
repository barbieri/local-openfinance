# LLM Analysis

Weekly (and other cadence) reports are an investigating **agent** over a
deterministic briefing and tools. Named report behavior is specified in
`specs/intelligence.md`.

## What stays

- Reporting and analysis model calls omit configured `temperature` for known
  reasoning model families such as `gpt-5...` and `o1/o3/o4...`.
- OpenAI `reasoningEffort` maps to the provider-specific AI SDK option. Config
  validation rejects it for other providers.
- `maxOutputTokens` limits each call. Named reports also use their agent budget
  to limit tool-loop calls and reviewer rounds.
- Durable report memory is markdown in SQLite (`intelligence_memory`),
  scoped by report id.
- Entry dates in briefings and tools use local calendar days (`TZ`);
  timestamps in payloads stay ISO8601 with offset.

## Timezone

Briefing and query windows group entries by local calendar day.

Entry `occurredAt` values in report payloads use full ISO8601 with timezone
offset from `TZ`.

The CLI warns and falls back to the system timezone when `TZ` is unset.

## Providers

Built-in analysis and classifier providers:

- OpenAI
- Anthropic
- Google
- xAI
- OpenRouter
- OpenCode
- AI Gateway
- Ollama
- `openai-compatible`

`model.baseUrl` configures providers that support custom endpoints, such as:

- `openai-compatible`
- `ollama`

Scoring helper providers keep their own nested `baseUrl` fields.

Scoring helper embeddings also use AI SDK providers. Supported built-ins are
provider ids with embedding factories:

- `ollama`
- `openai`
- `openrouter`
- `google`
- `gateway`
- `openai-compatible`

Add new scoring or analysis providers in `src/providers.ts`.

Optional model pricing uses US dollars per million input, cached-input, and
output tokens. Report runs retain the applied price snapshot and estimated cost
in millionths of a US dollar. Stored embedding vectors retain input-token usage
and their input-price snapshot. Missing rates produce a null cost.

## Debugging

`LOG_LEVEL=debug` includes redacted model I/O while setting up prompts.
Prefer `LOG_LEVEL=warn` for real usage.

## Environment variables

| Variable | Purpose |
| --- | --- |
| `OPENFINANCE_API_KEY` | Banco MCP bearer token for sync |
| `OPENFINANCE_BASE_URL` | API base, default `https://api.mcp.ai/api/openfinance` |
| `OPENAI_API_KEY` | OpenAI analysis and embeddings |
| `ANTHROPIC_API_KEY` | Anthropic analysis |
| `GOOGLE_GENERATIVE_AI_API_KEY` | Google analysis and embeddings |
| `XAI_API_KEY` | xAI analysis |
| `OPENROUTER_API_KEY` | OpenRouter analysis and embeddings |
| `LOG_LEVEL` | Pino level, default `info` |
| `TZ` | Local timezone for dates/times in LLM state and reports |
| `LOCAL_OPENFINANCE_WEB_TOKEN` | Pre-shared token for `serve` |
| `LOCAL_OPENFINANCE_WEB_PORT` | Local web UI port, default `3847` |
| `LOCAL_OPENFINANCE_TAILSCALE_SERVICE` | Optional Tailscale Service name (`name` or `svc:name`) to advertise on `serve` |
| `LOCAL_OPENFINANCE_TAILSCALE_HTTPS_PORT` | Optional Tailscale Service HTTPS port, default `443` |

API keys and `LOG_LEVEL` are loaded from `.env` in the project root through
`src/env.ts`.

CLI entrypoints import `src/env.ts` first. Vitest uses `tests/setup-env.ts`.
