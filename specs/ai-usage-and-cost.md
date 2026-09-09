# AI usage and estimated cost

The application records token usage and estimated cost for generated reports
and stored embeddings. Token counts come from the model provider. Cost is an
estimate based on the price snapshot configured for the call.

## Report call records

Each completed provider call in a report run has one
`intelligence_run_model_calls` row. Report calls use these phases:

- `taxonomy-policy`
- `analyst`
- `reviewer`

The row stores the provider, model, phase, review round, step number, token
counts, reasoning effort, configured limits, duration, raw usage metadata, the
price snapshot, and estimated cost in millionths of a US dollar. A cached or
empty taxonomy policy creates no call row.

`intelligence_runs` stores aggregate call, step, token, duration, unpriced-call,
and estimated-cost columns. The report runner derives these values from the
call records and writes the run, calls, charts, and memory in one transaction.
Reasoning tokens are part of output tokens and are not charged twice.

Existing runs keep zero token counts and a null cost. A null cost means that at
least one call had no applicable price snapshot. It does not mean zero cost.

Dry runs return and print the same metrics but do not write report, call, chart,
or memory rows. Email retries reuse the stored report and metrics without
calling a model.

## Report budgets

Each report resolves an agent budget with these limits:

- maximum analyst steps
- maximum reviewer steps per round
- number of reviewer rounds

An uncached, non-empty taxonomy policy may make one provider call before the
agent. The complete-run ceiling is therefore `1 + analystMaxSteps +
reviewerMaxSteps * reviewerRounds`; the default ceiling is 17. An empty or
cached policy removes that one-call allowance.

The first analyst and reviewer steps must request the deterministic briefing.
Each maximum is therefore at least two. The schema also sets hard upper bounds
so a configuration error cannot restore an unbounded agent loop.

`maxOutputTokens` limits each provider call. The agent budget limits the agent
loops, while the fixed taxonomy allowance makes the complete report ceiling
explicit. These controls solve different problems and both apply.

`reasoningEffort` is an OpenAI-only model option. The OpenAI adapter converts it
to `providerOptions.openai.reasoningEffort`. Config validation rejects the field
for other providers.

## Price snapshots

Model configuration can include prices in US dollars per million tokens for
input, cached input, and output. The application copies those rates into every
stored call record. Historical cost estimates therefore retain the rates used
when the application created them.

If cached-input usage is unavailable, the application prices all input tokens
at the normal input rate. If any required rate or token count is unavailable,
the call remains unpriced.

## Embeddings

`annotation_embeddings` and `entry_embeddings` store the input-token count,
the price snapshot, and the estimated cost for the provider call that created
the current vector. A cache hit does not change these fields or record a new
cost. Replacing a vector also replaces its usage and price snapshot.

These columns describe the current stored vector. They do not represent the
lifetime cost of embeddings that an upsert replaced.

## Model evaluation

A model comparison uses fixed report ids, periods, prompts, memory, timezone,
budgets, and reasoning effort. Each candidate reads an isolated copy of the
same database. The comparison records HTML, memory, call metrics, latency, and
estimated cost. It does not run scheduled reports or persist report state.

The report-model gate starts by comparing candidates on the same material
weekly period. A candidate that is both more expensive and worse on that gate
is eliminated before more paid calls. The winner is then checked on a material
monthly period and a quiet weekly period. The quality check covers factual
accuracy, useful correlations, internal-transfer exclusion, concise localized
HTML, semantic links, and restraint in a quiet period.

The August 2026 evaluation selected GPT-5.6 Luna with low reasoning effort and
an 8,000-token output limit. Luna produced the stronger material-week report at
about one eighth of Terra's estimated cost. It then passed the material-month
and quiet-week checks. Model prices remain configuration snapshots rather than
application constants.
