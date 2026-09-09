# Classification trends

Status: report profiles are implemented. The interactive Trends view remains
deferred.

## Purpose

The Classification trends view explains how spending assigned to categories or
labels changes over time. It shows amounts, differences, recurrence patterns,
and the evidence behind each pattern. It does not replace the Transactions tab.

The same deterministic profile calculation can provide bounded context to
report agents. Reports receive only profiles that explain material candidates
in the current period.

## User workflow

The view has one dimension selector with two mutually exclusive values:
**Categories** and **Labels**. The user selects up to eight items from the
chosen hierarchy and then selects one horizon:

- 6 months, grouped by week.
- 1 year, grouped by week.
- 2 years, grouped by week.
- 10 years, grouped by year.

The chart draws one series per selected item. It includes zero-valued periods
so gaps remain visible. Each series has a profile summary with its pattern,
amount basis, average, standard deviation, median, minimum, maximum, sample
count, coverage, and date range.

Selecting a chart period opens the matching Transactions view with the exact
date, account, category, or label filters. Parent selection is explicit. The
view never substitutes a child selection with its parent.

Labels can overlap. The UI must not add selected label series or present their
sum as total household spending.

## Profile model

A profile belongs to one stable category or label ID and retains its full
`Parent > Child` display path. The calculation assigns one of these patterns:

- `undefined` means that the available history cannot support a pattern.
- `one-off` means sparse or irregular material events. A large amount alone
  does not establish this pattern.
- `monthly-recurring` means activity across a sustained share of complete
  calendar months.
- `yearly-recurring` means repeated activity in the same part of at least
  three years. Shorter histories remain `undefined` or `one-off`.
- `small-bursts` means transactions cluster into short episodes separated by
  quiet intervals. The pattern does not claim a trip or another purpose without
  supporting transaction evidence.

Each pattern chooses a comparison basis:

- `active-day` combines transactions from the same purchase date. This avoids
  treating installments for one purchase as separate events.
- `month` uses complete, zero-filled calendar months.
- `year` uses complete, zero-filled calendar years.
- `burst` combines events inside one detected episode.

The profile includes the observations that support the classification. Evidence
includes active months, total month span, monthly coverage, episode count,
clustered-event ratio, and a bounded set of representative transactions.

Period differences are available only when the report period matches the
profile basis. A weekly report must not compare a partial week with a monthly
average. Every published comparison includes both the signed currency change
and the percentage change.

## Transaction semantics

The query uses the same normalized facts as reports and the Transactions tab:

- Respect the selected accounts, dates, currency, and credit-card purchase
  date mode.
- Treat positive credit-card values as expenses and negative values as
  refunds.
- Resolve confirmed classifications first. Use a suggestion only when its
  confidence meets the configured threshold, and mark the result as assumed.
- Exclude linked internal transfers before calculating totals.
- Exclude taxonomies that the semantic internal-transfer policy identifies as
  transfers between the user's own accounts.
- Exclude credit-card bill payments and other settlements when the underlying
  transactions are already represented as expenses.
- Keep portfolio movements available for balance history, but exclude them from
  spending profiles and lifestyle totals.
- Keep category and label IDs for exact filtering. Send their localized full
  paths for display and model interpretation.

Changing a classification, suggestion threshold, internal-transfer policy,
account filter, timezone, or credit-card date mode changes the result.

## Report context

The report briefing calculates all profiles from normalized facts, ranks them
against the current candidates, and sends a bounded shared profile block once.
Each candidate references at most two taxonomy profiles and retains its party
history as separate evidence. The preferred correlation first maximizes the
amount explained among the candidate's main transactions, then favors the more
specific supported path. A payment processor must not displace a more useful
category or label profile.

The initial limits are 12 report candidates and 12 shared profiles. Read-only
tools can return additional profile evidence when the agent needs it.

Markdown memory stores durable user context. It does not store calculated
averages or deviations as the source of truth. The application recalculates
those values when facts or classifications change.

## Query and storage strategy

Start with live, set-based SQLite queries. The current reference database
groups complete category history in about 19 ms at p95, complete label history
in about 25 ms at p95, and two selected labels over two years in about 20 ms at
p95. These measurements are development evidence, not a permanent guarantee.

Use 150 ms at p95 as the initial server-processing budget for a Trends query on
the reference dataset. Measure the normalized end-to-end query before adding a
cache. Optimize per-row suggestion loading before persisting aggregates.

If live calculation exceeds the budget after query optimization, add an
optional replaceable cache for the canonical all-accounts scope. Key each cache
entry by the timezone, fact watermark, taxonomy revision, classification
policy, and internal-transfer policy. Replace a complete cache atomically.
Never persist arbitrary filter combinations or treat cached data as the source
of truth.

## API shape

The future read-only endpoint accepts:

- One dimension, `category` or `label`.
- Between one and eight stable IDs.
- One supported horizon.
- The account and transaction filters already supported by Transactions.

The response returns aligned buckets, localized display paths, profile
statistics, pattern evidence, currency, effective scope, and exact transaction
filter links. The endpoint rejects mixed-currency aggregation.

## Interface requirements

- Keep the dimension, item, and horizon controls visible above the chart.
- Show the selected full paths next to their series colors.
- Mark incomplete current periods and omit incompatible baseline differences.
- Provide axis units, ticks, accessible series labels, and a tabular alternative
  for the plotted values.
- Explain `undefined` as insufficient evidence, not as an application error.
- Show assumed suggestions and limited-history profiles without turning the
  page into a classification-quality report.
- Preserve the current filter selection in the URL.

## Delivery sequence

1. Extract the normalized fact loader and the pure profile classifier from the
   approved report implementation.
2. Add unit coverage for calendar windows, installment consolidation, internal
   exclusions, overlapping labels, and every pattern.
3. Add the read-only query and measure it against the reference database.
4. Add the endpoint and exact Transactions links.
5. Build the Trends view and verify every horizon with real data.
6. Add a cache only if the measured live query exceeds the performance budget.

## Acceptance criteria

- A category or label edit appears on the next query without a rebuild step.
- Empty periods appear as zero rather than disappearing from the chart.
- A partial month never compares itself with a complete monthly baseline.
- Installments that share one purchase date count as one active-day event.
- Internal transfers never affect profile statistics or plotted totals.
- Every chart point can open the exact contributing transaction set.
- Report prompts receive only relevant shared profiles, not the complete
  taxonomy history.
- The 6-month, 1-year, 2-year, and 10-year horizons remain within the measured
  performance budget or use a correctly invalidated optional cache.
