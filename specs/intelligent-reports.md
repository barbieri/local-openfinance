# Intelligent reports

## Purpose

Daily, weekly, and monthly reports explain what changed and what needs
attention. They do not reproduce the Transactions table. A quiet period can
produce no findings.

The report favors differences, recurrence, and exceptions over absolute
totals. Every comparison with a non-zero baseline includes both the signed
currency difference and the percentage difference.

Migration 030 clears report runs, report chats, charts, and report memory from
the superseded dump-oriented report format. Taxonomy policies remain separate
derived state. Back up an existing database before applying this migration.

## Configuration

Each `reports[]` item has a supported `language` locale (`en-US` or `pt-BR`). The default is `pt-BR`.
The locale controls report prose, taxonomy translations, dates, number and
currency formatting, chart text, and email period text. A report keeps the same
locale between runs.

`intelligence.suggestionConfidenceThreshold` controls when a pending
classification suggestion participates in analysis. The default is `0.82`.
The analysis marks a used pending suggestion as `assumed-suggestion`.

Each report has an agent budget. The default allows 8 analyst steps, 4 steps
per reviewer round, and 2 reviewer rounds. `maxOutputTokens` limits each call.
The agent budget limits the number of calls.

A configurable maximum context size remains future work. If a real report
exceeds a model limit, split the deterministic packet, generate partial
analyses, and review one bounded final report. Do not add segmentation before a
failing case establishes the required boundary.

## Analysis pipeline

The application normalizes transaction history before it calls the report
agent. One normalized fact has a purchase date, account-currency amount,
direction, account, counterparty, non-duplicated detail, installment metadata,
classification source, full category and label paths, stable taxonomy IDs, and
a transaction permalink.

Reports always analyze transactions. The config intentionally has no
`entryTypes` switch: investment positions, accounts, loans, and card bills are
bounded supporting tools, not alternate inputs to the transaction analysis.

Normalization follows these rules:

- A positive credit-card value is an expense. A negative credit-card value is
  a refund.
- A linked internal transfer never enters the analytical facts.
- A confirmed annotation takes precedence over a suggestion.
- An unconfirmed suggestion applies only at or above the configured threshold.
- A masked merchant does not displace an available unmasked payer or receiver.
- A description equal to the merchant is omitted. A useful description, such
  as the purchased item behind a payment processor, remains.
- Installment suffixes do not create a second description. One installment
  candidate includes the current charge and the complete purchase total when
  available.

The application builds category and label profiles at every hierarchy level.
Each profile keeps the stable ID and the localized `Parent > Child` path. The
pattern and amount basis follow `specs/classification-trends.md`.

The current report packet contains at most 12 candidate findings and 12 shared
profiles. A candidate references relevant profile keys and names one preferred
profile only when that profile supplies a compatible currency and percentage
comparison. Counterparty history remains separate evidence. A payment
processor must not replace a category or label correlation.

Candidate ranking favors the amount explained by visible drivers, then an
unusual supported profile, then taxonomy specificity. The packet includes a
small required-inspection set and a smaller required-report set. The reviewers
can merge overlapping findings or remove a required candidate only when the
evidence makes it immaterial.
An exact offset expense is not repeated as a transaction candidate, and an
offset-dominated aggregate is removed. A `within-range` transaction candidate
must explain at least 20% of period expenses; smaller normal recurring items do
not reach the model merely because they exceed the line-item floor.

## Semantic transaction treatment

Structural transfer links are authoritative. The semantic policy handles
transactions that were manually classified but not linked.

The configured report model classifies human-readable category and label paths
as one of these treatments:

- `internal-own-account`
- `portfolio-movement`
- `account-settlement`
- `reportable`
- `uncertain`

The prompt forbids inference from opaque IDs. Generic transfers to another
person remain reportable. Only a path that clearly describes movement between
the user's own accounts becomes `internal-own-account`.

The application stores one report-scoped semantic policy with a hash of the
policy version, configured report model, locale, and localized taxonomy. It
reuses the policy while that hash matches and replaces the whole policy when
one of those inputs changes. Decisions below 0.8 confidence remain uncertain.
The policy is not report memory and does not grow per run.

An explicit own-account classification wins at any hierarchy level. For other
treatments, the deepest available category or label decision overrides its
parent, so a reportable dividend child is not discarded merely because its
parent is an investment portfolio.

Spending findings, candidate profiles, and allocation charts exclude internal
own-account transfers, portfolio movements, and account settlements. Balance
history still reflects every account movement.

## Report output

The model returns one object with a plain-text `subject`, an HTML `bodyHtml`
fragment, and Markdown `memoryMarkdown`.

`bodyHtml` contains only the report body. It does not contain `html`, `head`,
`body`, `style`, `script`, `img`, remote content, event handlers, or inline
styles. The sanitizer accepts primitive report elements and these classes:

- `report-dashboard`
- `report-metrics`, `report-metric`, `report-metric-label`,
  `report-metric-value`, `report-metric-delta`
- `report-findings`, `report-finding`, `report-finding-attention`,
  `report-finding-positive`, `report-finding-neutral`, `report-finding-title`
- `report-evidence`, `report-note`, `report-citation`, `report-table`

The web client and email shell own the CSS. The model does not reproduce site
styles.

Each cited transaction uses a semantic anchor such as
`<a href="...">saída em 10/08</a>`. A category or label period claim links to
the Transactions route with its exact date and taxonomy filters. The
`report_link` tool builds the same route for findings discovered during
investigation.
The model copies tool-provided `href` values without editing them. Sanitization
keeps only transaction permalinks and compressed `transactions/s=...` filter
links; invented local query formats and unrelated external links lose their
anchor target. Persistence rejects a transaction or filtered-period permalink
that appears as plain text outside an anchor.

The report has no generic summary, conclusion, transaction timeline, or
classification-quality section. It leads with a few findings that change the
user's understanding of the period. It mentions an assumed suggestion only
when a finding depends on that suggestion.

A transaction cited as a driver normally explains at least 5% of its finding;
a smaller transaction appears only when it changes the interpretation. A fully
cancelling exact offset cites the matched pair without padding the finding with
an irrelevant category baseline.

The analyst and both review rounds receive the same bounded briefing through
the `briefing` tool. All three can use scoped read-only tools. Every model output
passes the schema and HTML sanitizer before the next step or persistence.
Historical tools never return facts after the report period end, so a backdated
run cannot use later transactions as evidence. Ordinary within-range spending
is omitted even when its absolute amount is large. A material conflict between
the useful transaction description and its assigned taxonomy is called out as
a possible misclassification.

The report runner records every completed taxonomy, analyst, and reviewer call.
It derives aggregate token and estimated-cost fields from those call records.
Dry runs return the same metrics without persisting them.

## Charts

Each run stores three deterministic 1200 by 640 PNG charts:

- `cashflow` shows income, analytical expenses, and account balance. It uses a
  left currency axis for income and expenses and a right currency axis for
  balance. The blue line is the combined selected-account balance at the end of
  each bucket; it is not rebased to zero.
- `categories` shows stacked parent-category spending by report period.
- `labels` shows stacked parent-label spending by report period.

A daily report shows 30 days. A weekly report shows 8 weeks. A monthly report
shows 12 complete calendar months. Labels use `..` between range endpoints.
The current report period has a blue background. Every chart has localized
titles, legends, units, ticks, and axis labels.

Category and label charts select the largest parent series over the displayed
window and combine the remainder as `Others`. Child breakdowns belong in the
report only when a child materially explains its parent.

## Memory

Report memory is Markdown and remains one replacement document per report. It
stores durable relationships, recurrence knowledge, exceptional-event context,
unresolved questions, and user corrections. It does not copy report prose or
store calculated averages, standard deviations, minimums, and maximums as the
source of truth.
Each durable fact or question appears once in its best section.
Empty memory sections are removed after generation; if no durable fact remains,
the document keeps only a localized memory heading.

`rebuild-memory` recreates memory without generating or persisting reports. It
uses the configured report windows and scans periods from oldest to newest.
`--quantity` accepts a positive integer or `all`; `all` is the default. Omitting
`--report` rebuilds every configured report. The command writes a timestamped
SQLite backup before it changes memory.

The scan resolves the report taxonomy policy once before it processes periods.
It never resolves the policy inside the period loop. Each period contributes
only candidates named by deterministic `mustReport` and the profiles that those
candidates reference. Raw facts, report summaries, charts, net worth, tool
definitions, and existing memory do not enter rebuild evidence.

An empty or cached taxonomy policy uses no provider call. A missing or stale
policy uses one report-level generation and exposes its usage separately from
memory synthesis. The command result identifies the configured provider and
model and reports their combined call count, which is therefore at most two per
report.

A period with no material finding renders a concise localized status note in
the findings container. It does not substitute an absolute total, period
comparison, or generic summary merely to avoid an empty report. The runner
adds this status note when a model returns an empty body, so persisted web and
email reports always have readable text.

When a material acquisition or event is selected, the agent investigates
nearby smaller costs available through report tools that can change its
interpretation, such as accessories, documentation, insurance, delivery, or
setup. The configured line-item floor still applies. The agent includes only
relevant linked items and cites every included transaction.

Every transaction used as published evidence is bound to its semantic
transaction permalink. A bare date, amount, party, or description is not a
valid citation.

The evidence builder groups observations into durable threads. It reserves
eight deduplicated thread slots each for relationships, recurrence, and
exceptions. A thread keeps its earliest, highest-importance, and latest
observations. The complete JSON is at most 64 KiB in UTF-8 bytes. The builder
adds a candidate and all of its referenced profile cards as one unit, so the
byte limit cannot leave dangling profile references. The ordinary report packet
keeps its 12-profile limit, then adds any otherwise omitted profile referenced
by `mustReport` before rebuild evidence is selected.

Empty evidence writes only the localized memory heading and makes no memory
generation call. Non-empty evidence makes one direct structured generation per
report. The generation has no tools, agent loop, or review rounds. It returns a
strict `{ memoryMarkdown }` object and uses the report model's temperature and
output-token settings.

Rebuild output replaces memory from current evidence. The model does not
receive the previous document. The command reads the previous document only to
detect a concurrent edit before the final upsert. Evidence, generation,
validation, compaction, or conflict failures leave the stored memory unchanged.

## Storage and performance

The current report packet is stored in each run's existing
`briefing_json`. Candidate cards and profiles do not use append-only tables.
Each run has one bounded snapshot, and the next run recalculates the source of
truth from current transactions and classifications.

Aggregate profile results are not cached in SQLite. Live calculation keeps
classification edits visible on the next report and measured well below the
initial 150 ms profile-query budget on the reference database. The current
enriched transaction loader still performs per-row suggestion reads. Replace
those reads with a set-based loader before considering an aggregate cache.
