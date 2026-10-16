import { createRequire } from 'node:module';
import type { DatabaseSync } from 'node:sqlite';
import { Resvg } from '@resvg/resvg-js';
import { buildAnnotationLabelIndex } from '../db/annotation-labels.js';
import type { TransactionChartDataset } from '../db/transaction-charts.js';
import { getDateTimeFormat, getNumberFormat } from '../utils/intl-formatters.js';
import { resolveCategoryTranslationEnabled } from '../utils/locale-resolve.js';
import { localText } from '../utils/locale-text.js';
import { CHART_FAMILIES, LIGHT_TOKENS } from './gustavo-style.js';
import type {
  InvestmentAllocationBucket,
  InvestmentReportSnapshot,
} from './investment-report-snapshot.js';
import { buildMonthlyComparisonModel, buildPeriodComparisonModel } from './monthly-comparison.js';
import type { ReportAnalysis } from './report-analysis-types.js';
import { buildReportCategoryIndex } from './report-taxonomy.js';

const WIDTH = 1_200;
const HEIGHT = 640;
const PLOT = { left: 145, top: 104, right: 1_040, bottom: 540 } as const;
const COST_COLORS = (['amber', 'orange', 'rose'] as const).flatMap((family) => {
  const shades = CHART_FAMILIES[family];
  return [shades[3], shades[4]];
});
const INVESTMENT_COLORS = (['indigo', 'blue', 'teal'] as const).flatMap((family) => {
  const shades = CHART_FAMILIES[family];
  return [shades[3], shades[4]];
});
const require = createRequire(import.meta.url);
const FONT_FILES = [
  require.resolve('dejavu-fonts-ttf/ttf/DejaVuSans.ttf'),
  require.resolve('dejavu-fonts-ttf/ttf/DejaVuSans-Bold.ttf'),
] as const;

export type IntelligenceChart = {
  readonly name:
    | 'cashflow'
    | 'monthly-comparison'
    | 'year-over-year'
    | 'categories'
    | 'labels'
    | 'investments-type'
    | 'investments-subtype'
    | 'investments-code';
  readonly filename: string;
  readonly cid: string;
  readonly mimeType: 'image/png';
  readonly bytes: Uint8Array;
  readonly altText: string;
};

export type IntelligenceChartLabels = {
  readonly categories?: Readonly<Record<string, string>> | undefined;
  readonly labels?: Readonly<Record<string, string>> | undefined;
};

export function loadIntelligenceChartLabels(
  db: DatabaseSync,
  language = 'pt-BR',
): IntelligenceChartLabels {
  const categories = Object.fromEntries(
    [
      ...buildReportCategoryIndex(db, {
        translateNames: resolveCategoryTranslationEnabled(language),
      }),
    ].map(([id, entry]) => [id, entry.path]),
  );
  const labels = Object.fromEntries(
    [...buildAnnotationLabelIndex(db)].map(([id, entry]) => [id, entry.path]),
  );
  return { categories, labels };
}

export function renderReportAnalysisCharts(
  dataset: TransactionChartDataset,
  analysis: ReportAnalysis,
  labels: IntelligenceChartLabels = {},
): readonly IntelligenceChart[] {
  const yearOverYear =
    analysis.period.cadence === 'monthly' &&
    analysis.yearOverYear?.months.some((month) => month.kind === 'comparable')
      ? [
          toChart(
            'year-over-year',
            'report-year-over-year.png',
            'report-year-over-year@local-openfinance',
            reportChartAltText('year-over-year', analysis.language),
            renderYearOverYearSvg(analysis),
          ),
        ]
      : [];
  return [
    toChart(
      analysis.period.cadence === 'monthly' ? 'monthly-comparison' : 'cashflow',
      analysis.period.cadence === 'monthly'
        ? 'report-monthly-comparison.png'
        : 'report-cashflow.png',
      analysis.period.cadence === 'monthly'
        ? 'report-monthly-comparison@local-openfinance'
        : 'report-cashflow@local-openfinance',
      reportChartAltText(
        analysis.period.cadence === 'monthly' ? 'monthly-comparison' : 'cashflow',
        analysis.language,
        analysis.period.cadence,
      ),
      analysis.period.cadence === 'monthly' || analysis.period.cadence === 'weekly'
        ? renderPeriodComparisonSvg(analysis, dataset)
        : renderCashflowSvg(dataset, analysis),
    ),
    ...yearOverYear,
    toChart(
      'categories',
      'report-categories.png',
      'report-categories@local-openfinance',
      reportChartAltText('categories', analysis.language),
      renderStackedAllocationSvg(analysis, 'category', labels.categories),
    ),
    toChart(
      'labels',
      'report-labels.png',
      'report-labels@local-openfinance',
      reportChartAltText('labels', analysis.language),
      renderStackedAllocationSvg(analysis, 'label', labels.labels),
    ),
  ];
}

export function reportChartAltText(
  name: IntelligenceChart['name'],
  language: string,
  cadence?: ReportAnalysis['period']['cadence'],
): string {
  if (name === 'cashflow') {
    return localText(
      language,
      cadence === 'weekly' ? 'reports.chart.weeklyComparison.alt' : 'reports.chart.cashflow',
    );
  }
  if (name === 'monthly-comparison') {
    return localText(language, 'reports.chart.monthlyComparison.alt');
  }
  if (name === 'year-over-year') {
    return localText(language, 'reports.chart.yearOverYear.alt');
  }
  if (name === 'categories') {
    return localText(language, 'reports.chart.categories');
  }
  if (
    name === 'investments-type' ||
    name === 'investments-subtype' ||
    name === 'investments-code'
  ) {
    return localText(language, `reports.chart.${name}`);
  }
  return localText(language, 'reports.chart.labels');
}

export function renderInvestmentAllocationCharts(
  snapshot: InvestmentReportSnapshot,
  language: string,
): readonly IntelligenceChart[] {
  if (snapshot.availability === 'excluded') return [];
  const dimensions = ['type', 'subtype', 'code'] as const;
  return dimensions.flatMap((dimension) =>
    snapshot.currencies.some((currency) => currency[dimension].length > 1)
      ? [renderInvestmentAllocationChart(snapshot, dimension, language)]
      : [],
  );
}

function renderInvestmentAllocationChart(
  snapshot: Extract<InvestmentReportSnapshot, { readonly availability: 'included' }>,
  dimension: 'type' | 'subtype' | 'code',
  language: string,
): IntelligenceChart {
  const name = `investments-${dimension}` as const;
  const currencies = snapshot.currencies.filter((currency) => currency[dimension].length > 1);
  const panelHeight = Math.max(
    270,
    185 +
      Math.max(
        ...currencies.map(
          (currency) => compactInvestmentBuckets(currency[dimension], language).length,
        ),
      ) *
        18,
  );
  const panels = currencies
    .map((currency, panel) => {
      const column = panel % 3;
      const row = Math.floor(panel / 3);
      const x = 90 + column * 380;
      const y = 145 + row * panelHeight;
      const buckets = compactInvestmentBuckets(currency[dimension], language);
      const total = buckets.reduce((sum, bucket) => sum + bucket.cents, 0);
      // Resolve each holding to a distinct investment color so slices in one pie
      // (and its legend) never collide on the same hue.
      const assignedInvestmentColors = assignColors(
        buckets.map((bucket) => bucket.id),
        INVESTMENT_COLORS,
      );
      let angle = -Math.PI / 2;
      return [
        `<text x="${x}" y="${y}" class="section-title">${escapeXml(currency.currency)}</text>`,
        ...buckets.map((bucket, index) => {
          const next = angle + (bucket.cents / total) * Math.PI * 2;
          const path = pieSlice(x + 90, y + 85, 62, angle, next);
          angle = next;
          const legendY = y + 164 + index * 18;
          const color = stableColor(bucket.id, assignedInvestmentColors);
          return `<path d="${path}" fill="${color}"/><rect x="${x}" y="${legendY - 11}" width="10" height="10" fill="${color}"/><text x="${x + 15}" y="${legendY}" class="legend">${escapeXml(truncate(bucket.label, 24))} ${escapeXml(formatCompactMoneyLocale(bucket.cents, currency.currency, language))}</text>`;
        }),
      ].join('');
    })
    .join('');
  const title = localText(language, `reports.chart.investments.${dimension}.title`);
  return toChart(
    name,
    `report-${name}.png`,
    `report-${name}@local-openfinance`,
    reportChartAltText(name, language),
    svgDocument(
      `<text x="70" y="60" class="title">${escapeXml(title)}</text>${panels}`,
      120 + Math.ceil(currencies.length / 3) * panelHeight,
    ),
  );
}

function compactInvestmentBuckets(
  buckets: readonly InvestmentAllocationBucket[],
  language: string,
): readonly InvestmentAllocationBucket[] {
  const visible = buckets.slice(0, 6);
  const remainder = buckets.slice(6);
  const cents = remainder.reduce((sum, bucket) => sum + bucket.cents, 0);
  return cents > 0
    ? [
        ...visible,
        {
          id: 'other',
          label: localText(language, 'reports.chart.other'),
          cents,
          count: remainder.reduce((sum, bucket) => sum + bucket.count, 0),
        },
      ]
    : visible;
}

function pieSlice(cx: number, cy: number, radius: number, start: number, end: number): string {
  if (end - start >= Math.PI * 2 - 0.00001)
    return `M ${cx} ${cy} m -${radius} 0 a ${radius} ${radius} 0 1 0 ${radius * 2} 0 a ${radius} ${radius} 0 1 0 -${radius * 2} 0`;
  const startX = cx + Math.cos(start) * radius;
  const startY = cy + Math.sin(start) * radius;
  const endX = cx + Math.cos(end) * radius;
  const endY = cy + Math.sin(end) * radius;
  return `M ${cx} ${cy} L ${startX} ${startY} A ${radius} ${radius} 0 ${end - start > Math.PI ? 1 : 0} 1 ${endX} ${endY} Z`;
}

function hashId(id: string): number {
  let hash = 0;
  for (const character of id) hash = (hash * 31 + (character.codePointAt(0) ?? 0)) >>> 0;
  return hash;
}

/**
 * Assign one distinct color per id.
 *
 * A plain hash modulo the palette length collides: two categories in the same
 * chart can land on the same color and merge visually. Instead, resolve
 * collisions by probing forward through the palette, so ids that hash to the
 * same index still receive different colors within one chart. The mapping
 * stays stable for a given id order, which is preserved across periods because
 * callers sort ids deterministically.
 */
function assignColors(ids: readonly string[], palette: readonly string[]): Map<string, string> {
  const assigned = new Map<string, string>();
  const used = new Set<string>();
  for (const id of ids) {
    const preferred = palette.length === 0 ? undefined : palette[hashId(id) % palette.length];
    let color = preferred;
    if (color === undefined || used.has(color)) {
      const start = palette.length === 0 ? 0 : hashId(id) % palette.length;
      color = palette.find((_candidate, offset) => {
        const index = (start + offset) % Math.max(palette.length, 1);
        return !used.has(palette[index] ?? '');
      });
    }
    if (color === undefined) {
      color = palette[0] ?? '#64748b';
    }
    used.add(color);
    assigned.set(id, color);
  }
  return assigned;
}

function costColor(id: string, assigned?: Map<string, string>): string {
  if (id === 'other') return CHART_FAMILIES.slate[3];
  return (
    assigned?.get(id) ?? COST_COLORS[hashId(id) % COST_COLORS.length] ?? CHART_FAMILIES.amber[3]
  );
}

function stableColor(id: string, assigned?: Map<string, string>): string {
  return (
    assigned?.get(id) ??
    INVESTMENT_COLORS[hashId(id) % INVESTMENT_COLORS.length] ??
    CHART_FAMILIES.indigo[3]
  );
}

export function renderMonthlyComparisonSvg(analysis: ReportAnalysis): string {
  return renderPeriodComparisonSvg(analysis, { dailyBalance: [] });
}

export function renderYearOverYearSvg(analysis: ReportAnalysis): string {
  const comparison = analysis.yearOverYear;
  if (!comparison) throw new Error('Year-over-year comparison is unavailable.');
  const comparable = comparison.months.filter((month) => month.kind === 'comparable');
  const plotLeft = 160;
  const plotRight = 1050;
  const x = (month: number) => {
    const index = comparable.findIndex((candidate) => candidate.month === month);
    if (index < 0) throw new Error(`Comparable month ${month} is unavailable.`);
    return comparable.length === 1
      ? (plotLeft + plotRight) / 2
      : plotLeft + (index / (comparable.length - 1)) * (plotRight - plotLeft);
  };
  const monthFormat = getDateTimeFormat(analysis.language, { month: 'short', timeZone: 'UTC' });
  const labels = comparable
    .map(
      (month) =>
        `<text x="${x(month.month)}" y="591" class="axis" text-anchor="middle">${escapeXml(monthFormat.format(new Date(Date.UTC(comparison.currentYear, month.month - 1, 1))))}</text>`,
    )
    .join('');
  const panel = (direction: 'expense' | 'income', top: number, bottom: number) => {
    const field = `${direction}Cents` as const;
    const values = comparable.flatMap((month) => [month.prior[field], month.current[field]]);
    const max = Math.max(1, ...values) * 1.1;
    const y = (value: number) => scale(value, 0, max, bottom, top);
    const grid = Array.from({ length: 3 }, (_, index) => {
      const value = (max * index) / 2;
      const py = y(value);
      return `<line x1="${plotLeft}" y1="${py}" x2="${plotRight}" y2="${py}" stroke="${LIGHT_TOKENS.border}"/><text x="${plotLeft - 12}" y="${py + 5}" class="axis" text-anchor="end">${escapeXml(formatCompactMoneyLocale(value, analysis.currency, analysis.language))}</text>`;
    }).join('');
    const series = (year: 'prior' | 'current', color: string, dashed: boolean) => {
      const runs: (typeof comparable)[] = [];
      for (const month of comparable) {
        const run = runs.at(-1);
        if (run && run.at(-1)?.month === month.month - 1) run.push(month);
        else runs.push([month]);
      }
      const lines = runs
        .filter((run) => run.length > 1)
        .map(
          (run) =>
            `<polyline class="yoy-line" data-year="${year}" points="${run.map((month) => `${x(month.month)},${y(month[year][field])}`).join(' ')}" fill="none" stroke="${color}" stroke-width="3"${dashed ? ' stroke-dasharray="8 6"' : ''}/>`,
        )
        .join('');
      const points = comparable
        .map(
          (month) =>
            `<circle class="yoy-point" data-year="${year}" cx="${x(month.month)}" cy="${y(month[year][field])}" r="5" fill="${color}" stroke="${LIGHT_TOKENS.surface}" stroke-width="2"/>`,
        )
        .join('');
      return lines + points;
    };
    const labelKey =
      direction === 'expense'
        ? 'reports.chart.yearOverYear.expenses'
        : 'reports.chart.yearOverYear.income';
    return `<text x="${plotLeft}" y="${top - 18}" class="section-title">${escapeXml(localText(analysis.language, labelKey))}</text>${grid}${series('prior', CHART_FAMILIES.slate[3], true)}${series('current', direction === 'expense' ? CHART_FAMILIES.amber[3] : CHART_FAMILIES.green[3], false)}`;
  };
  const subtitle = localText(analysis.language, 'reports.chart.yearOverYear.subtitle')
    .replace('{priorYear}', String(comparison.priorYear))
    .replace('{currentYear}', String(comparison.currentYear));
  // The legend must describe the series actually drawn: each panel plots the
  // prior year in slate and the current year in the panel's own series color
  // (expenses amber, income green), so name both per panel instead of a single
  // stale blue key that no panel contains.
  const legendEntry = (color: string, label: string, offset: number): string =>
    `<line x1="${plotLeft + offset}" y1="101" x2="${plotLeft + offset + 35}" y2="101" stroke="${color}" stroke-width="3"/><text x="${plotLeft + offset + 44}" y="106" class="legend">${escapeXml(label)}</text>`;
  const expenseLegend = `${legendEntry(CHART_FAMILIES.slate[3], String(comparison.priorYear), 0)}${legendEntry(CHART_FAMILIES.amber[3], String(comparison.currentYear), 300)}`;
  return svgDocument(`
    <text x="${plotLeft}" y="43" class="title">${escapeXml(localText(analysis.language, 'reports.chart.yearOverYear.title'))}</text>
    <text x="${plotLeft}" y="72" class="subtitle">${escapeXml(subtitle)}</text>
    ${expenseLegend}
    ${panel('expense', 164, 315)}${panel('income', 397, 548)}${labels}
  `);
}

export function renderWeeklyComparisonSvg(
  dataset: TransactionChartDataset,
  analysis: ReportAnalysis,
): string {
  return renderPeriodComparisonSvg(analysis, dataset);
}

function renderPeriodComparisonSvg(
  analysis: ReportAnalysis,
  dataset: Pick<TransactionChartDataset, 'dailyBalance'>,
): string {
  const cadence = analysis.period.cadence === 'weekly' ? 'weekly' : 'monthly';
  const { buckets, periodBalances, expenses, income, completeBuckets, trend } =
    buildPeriodComparisonModel(analysis.chart, cadence);
  const finalBucket = buckets.at(-1);
  const finalBalance =
    cadence === 'monthly'
      ? (buildMonthlyComparisonModel(analysis.chart).balances.at(-1) ?? 0)
      : finalBucket
        ? (dataset.dailyBalance.findLast((point) => point.date <= finalBucket.end)?.balance ?? 0)
        : 0;
  const domain = paddedDomain([
    ...expenses,
    ...income,
    ...periodBalances,
    ...(trend
      ? [
          trend.expense.intercept + trend.expense.slope * trend.startIndex,
          trend.expense.intercept + trend.expense.slope * trend.endIndex,
        ]
      : []),
    ...(trend
      ? [
          trend.income.intercept + trend.income.slope * trend.startIndex,
          trend.income.intercept + trend.income.slope * trend.endIndex,
        ]
      : []),
    0,
  ]);
  const slot = (PLOT.right - PLOT.left) / Math.max(buckets.length, 1);
  const x = (index: number) => PLOT.left + slot * (index + 0.5);
  const y = (value: number) => scale(value, domain.min, domain.max, PLOT.bottom, PLOT.top);
  const currentBand = buckets.length
    ? `<rect x="${PLOT.left + slot * (buckets.length - 1)}" y="${PLOT.top}" width="${slot}" height="${PLOT.bottom - PLOT.top}" fill="${CHART_FAMILIES.slate[0]}"/>`
    : '';
  const barWidth = Math.max(4, slot * 0.2);
  const bars = (series: readonly number[], offset: number, color: string) =>
    series
      .map((value, index) => {
        const zero = y(0);
        const valueY = y(value);
        return `<rect x="${x(index) + offset - barWidth / 2}" y="${Math.min(zero, valueY)}" width="${barWidth}" height="${Math.abs(zero - valueY)}" fill="${color}"/>`;
      })
      .join('');
  const trendLine = (series: 'expense' | 'income', color: string) => {
    if (!trend) return '';
    const regression = trend[series];
    return `<polyline class="period-trend" points="${x(trend.startIndex)},${y(regression.intercept + regression.slope * trend.startIndex)} ${x(trend.endIndex)},${y(regression.intercept + regression.slope * trend.endIndex)}" fill="none" stroke="${color}" stroke-width="2" stroke-dasharray="10 8" opacity="0.75"/>`;
  };
  const partial = finalBucket && !completeBuckets.at(-1);
  return svgDocument(`
    <text x="${PLOT.left}" y="42" class="title">${escapeXml(localText(analysis.language, cadence === 'monthly' ? 'reports.chart.monthlyComparison.title' : 'reports.chart.cashflow.title'))}</text>
    ${partial ? `<text x="${PLOT.right}" y="42" class="subtitle" text-anchor="end">${escapeXml(formatPartialPeriod(finalBucket.start, finalBucket.end, cadence, analysis.language))}</text>` : ''}
    ${renderPeriodComparisonLegend(analysis.language, cadence, trend !== null)}
    ${currentBand}${renderDualGrid(domain.min, domain.max, analysis.currency, analysis.language, 'left')}
    ${bars(expenses, -barWidth - 3, CHART_FAMILIES.amber[3])}${bars(income, 0, CHART_FAMILIES.green[3])}${bars(periodBalances, barWidth + 3, CHART_FAMILIES.blue[3])}
    ${trendLine('expense', CHART_FAMILIES.amber[3])}${trendLine('income', CHART_FAMILIES.green[3])}
    ${renderBucketLabels({ ...analysis, chart: buckets })}${renderPeriodComparisonAnnotations(analysis, cadence, trend?.expense.slope ?? null, trend?.income.slope ?? null, finalBalance)}
  `);
}

function renderPeriodComparisonLegend(
  language: string,
  cadence: 'weekly' | 'monthly',
  showTrends: boolean,
): string {
  const entries = [
    [
      CHART_FAMILIES.amber[3],
      false,
      localText(language, 'reports.chart.monthlyComparison.legend.expenses'),
    ],
    [
      CHART_FAMILIES.amber[3],
      true,
      localText(language, 'reports.chart.monthlyComparison.legend.expensesTrend'),
    ],
    [
      CHART_FAMILIES.green[3],
      false,
      localText(language, 'reports.chart.monthlyComparison.legend.income'),
    ],
    [
      CHART_FAMILIES.green[3],
      true,
      localText(language, 'reports.chart.monthlyComparison.legend.incomeTrend'),
    ],
    [
      CHART_FAMILIES.blue[3],
      false,
      localText(
        language,
        cadence === 'monthly'
          ? 'reports.chart.monthlyComparison.legend.balance'
          : 'reports.chart.weeklyComparison.legend.balance',
      ),
    ],
    [CHART_FAMILIES.slate[0], false, localText(language, 'reports.chart.legend.currentPeriod')],
  ] as const;
  const widths = [125, 165, 175, 215, 180, 0];
  let offset = 0;
  return entries
    .map(([color, dashed, label], index) => ({ color, dashed, label, width: widths[index] ?? 180 }))
    .filter(({ dashed }) => showTrends || !dashed)
    .map(({ color, dashed, label, width }) => {
      const x = PLOT.left + offset;
      offset += width;
      return `<line x1="${x}" y1="76" x2="${x + 22}" y2="76" stroke="${color}" stroke-width="4"${dashed ? ' stroke-dasharray="7 5"' : ''}/><text x="${x + 30}" y="81" class="legend">${escapeXml(label)}</text>`;
    })
    .join('');
}

export function formatMonthlyTrendDelta(cents: number, currency: string, language: string): string {
  return `${getNumberFormat(language, {
    style: 'currency',
    currency,
    notation: 'compact',
    maximumFractionDigits: 1,
    signDisplay: 'always',
  }).format(cents / 100)}/${localText(language, 'reports.chart.monthlyComparison.perMonth')}`;
}

function formatPeriodTrendDelta(
  cents: number,
  currency: string,
  cadence: 'weekly' | 'monthly',
  language: string,
): string {
  return `${getNumberFormat(language, {
    style: 'currency',
    currency,
    notation: 'compact',
    maximumFractionDigits: 1,
    signDisplay: 'always',
  }).format(
    cents / 100,
  )}/${localText(language, cadence === 'monthly' ? 'reports.chart.monthlyComparison.perMonth' : 'reports.chart.monthlyComparison.perWeek')}`;
}

function renderPeriodComparisonAnnotations(
  analysis: ReportAnalysis,
  cadence: 'weekly' | 'monthly',
  expenseSlope: number | null,
  incomeSlope: number | null,
  finalBalance: number,
): string {
  const rows: { readonly color: string; readonly label: string; readonly value: string }[] = [];
  if (expenseSlope !== null) {
    rows.push({
      color: CHART_FAMILIES.amber[3],
      label: localText(analysis.language, 'reports.chart.monthlyComparison.delta.expenses'),
      value: formatPeriodTrendDelta(expenseSlope, analysis.currency, cadence, analysis.language),
    });
  }
  if (incomeSlope !== null) {
    rows.push({
      color: CHART_FAMILIES.green[3],
      label: localText(analysis.language, 'reports.chart.monthlyComparison.delta.income'),
      value: formatPeriodTrendDelta(incomeSlope, analysis.currency, cadence, analysis.language),
    });
  }
  rows.push({
    color: CHART_FAMILIES.blue[3],
    label: localText(
      analysis.language,
      cadence === 'monthly'
        ? 'reports.chart.monthlyComparison.finalBalance'
        : 'reports.chart.monthlyComparison.finalAccountBalance',
    ),
    value: formatCompactMoneyLocale(finalBalance, analysis.currency, analysis.language),
  });
  return rows
    .map(
      ({ color, label, value }, index) =>
        `<text x="${PLOT.left}" y="${584 + index * 20}" class="legend" style="fill:${color}">${escapeXml(label)} = ${escapeXml(value)}</text>`,
    )
    .join('');
}

function formatPartialPeriod(
  start: string,
  end: string,
  cadence: 'weekly' | 'monthly',
  language: string,
): string {
  if (cadence === 'weekly') {
    const formatDate = (date: string) =>
      getDateTimeFormat(language, {
        month: 'short',
        day: 'numeric',
        timeZone: 'UTC',
      })
        .format(new Date(`${date}T12:00:00.000Z`))
        .replace('.', '');
    return localText(language, 'reports.chart.monthlyComparison.partialWeek').replace(
      '{range}',
      `${formatDate(start)}..${formatDate(end)}`,
    );
  }
  const month = getDateTimeFormat(language, {
    month: 'short',
    year: '2-digit',
    timeZone: 'UTC',
  })
    .format(new Date(`${start}T12:00:00.000Z`))
    .replace('.', '');
  return localText(language, 'reports.chart.monthlyComparison.partialMonth').replace(
    '{month}',
    month,
  );
}

function renderCashflowSvg(dataset: TransactionChartDataset, analysis: ReportAnalysis): string {
  const buckets = analysis.chart;
  const balances = buckets.map(
    (bucket) => dataset.dailyBalance.findLast((point) => point.date <= bucket.end)?.balance ?? 0,
  );
  const cashMax = Math.max(
    ...buckets.flatMap((bucket) => [bucket.incomeCents, bucket.expenseCents]),
    1,
  );
  const balanceDomain = paddedDomain(balances);
  const slot = (PLOT.right - PLOT.left) / Math.max(buckets.length, 1);
  const barWidth = Math.max(5, slot * 0.25);
  const cashY = (value: number) => scale(value, 0, cashMax, PLOT.bottom, PLOT.top);
  const balanceY = (value: number) =>
    scale(value, balanceDomain.min, balanceDomain.max, PLOT.bottom, PLOT.top);
  const x = (index: number) => PLOT.left + slot * (index + 0.5);
  const currentBand = buckets.length
    ? `<rect x="${PLOT.left + slot * (buckets.length - 1)}" y="${PLOT.top}" width="${slot}" height="${PLOT.bottom - PLOT.top}" fill="${CHART_FAMILIES.slate[0]}"/>`
    : '';
  const cashGrid = renderDualGrid(0, cashMax, analysis.currency, analysis.language, 'left');
  const balanceGrid = renderDualGrid(
    balanceDomain.min,
    balanceDomain.max,
    analysis.currency,
    analysis.language,
    'right',
  );
  const bars = buckets
    .map((bucket, index) => {
      const center = x(index);
      const incomeY = cashY(bucket.incomeCents);
      const expenseY = cashY(bucket.expenseCents);
      return `<rect x="${center - barWidth - 2}" y="${incomeY}" width="${barWidth}" height="${PLOT.bottom - incomeY}" fill="${CHART_FAMILIES.green[3]}"/>
        <rect x="${center + 2}" y="${expenseY}" width="${barWidth}" height="${PLOT.bottom - expenseY}" fill="${CHART_FAMILIES.amber[3]}"/>`;
    })
    .join('');
  const balancePath = balances
    .map((balance, index) => `${x(index)},${balanceY(balance)}`)
    .join(' ');
  return svgDocument(`
    <text x="${PLOT.left}" y="48" class="title">${escapeXml(localText(analysis.language, 'reports.chart.cashflow.title'))}</text>
    <text x="${PLOT.left}" y="76" class="subtitle">${escapeXml(localText(analysis.language, 'reports.chart.cashflow.subtitle'))}</text>
    ${currentBand}${cashGrid}${balanceGrid}${bars}
    ${balances.length ? `<polyline points="${balancePath}" fill="none" stroke="${CHART_FAMILIES.blue[3]}" stroke-width="4" stroke-linejoin="round" stroke-linecap="round"/>` : ''}
    ${renderBucketLabels(analysis)}
    ${renderCashflowLegend(analysis.language)}
  `);
}

export function renderStackedAllocationSvg(
  analysis: ReportAnalysis,
  kind: 'category' | 'label',
  displayNames: Readonly<Record<string, string>> | undefined,
): string {
  const source = analysis.chart.map((bucket) =>
    kind === 'category' ? bucket.categoryTotals : bucket.labelTotals,
  );
  const grand = new Map<string, number>();
  for (const totals of source) {
    for (const [id, amount] of Object.entries(totals)) {
      grand.set(id, (grand.get(id) ?? 0) + amount);
    }
  }
  const ids = [...grand.entries()]
    .toSorted((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, 5)
    .map(([id]) => id);
  // Resolve each id to a distinct cost color once, so bars and legend agree and
  // categories that hash to the same palette slot stay distinguishable.
  const assignedCostColors = assignColors(ids, COST_COLORS);
  const rows = analysis.chart.map((bucket, index) => {
    const totals = source[index] ?? {};
    const visible = ids.map((id) => totals[id] ?? 0);
    const all = Object.values(totals).reduce((sum, value) => sum + value, 0);
    const other = Math.max(0, all - visible.reduce((sum, value) => sum + value, 0));
    return { bucket, values: [...visible, other] };
  });
  const max = Math.max(...rows.map((row) => row.values.reduce((sum, value) => sum + value, 0)), 1);
  const slot = (PLOT.right - PLOT.left) / Math.max(rows.length, 1);
  const currentBand = rows.length
    ? `<rect x="${PLOT.left + slot * (rows.length - 1)}" y="${PLOT.top}" width="${slot}" height="${PLOT.bottom - PLOT.top}" fill="${CHART_FAMILIES.slate[0]}"/>`
    : '';
  const bars = rows
    .map((row, index) => {
      let y = PLOT.bottom;
      return row.values
        .map((value, valueIndex) => {
          const height = (value / max) * (PLOT.bottom - PLOT.top);
          y -= height;
          return `<rect x="${PLOT.left + slot * index + slot * 0.18}" y="${y}" width="${slot * 0.64}" height="${height}" fill="${costColor(ids[valueIndex] ?? 'other', assignedCostColors)}"/>`;
        })
        .join('');
    })
    .join('');
  const title =
    kind === 'category'
      ? localText(analysis.language, 'reports.chart.categories.title')
      : localText(analysis.language, 'reports.chart.labels.title');
  const names = [
    ...ids.map((id) => displayNames?.[id] ?? id),
    localText(analysis.language, 'reports.chart.others'),
  ];
  return svgDocument(`
    <text x="${PLOT.left}" y="48" class="title">${escapeXml(title)}</text>
    <text x="${PLOT.left}" y="76" class="subtitle">${escapeXml(
      kind === 'category'
        ? localText(analysis.language, 'reports.chart.categories.subtitle')
        : localText(analysis.language, 'reports.chart.labels.subtitle'),
    )}</text>
    ${currentBand}${renderDualGrid(0, max, analysis.currency, analysis.language, 'left')}
    ${bars}${renderBucketLabels(analysis)}${renderStackLegend(names, ids, assignedCostColors)}
  `);
}

function renderDualGrid(
  min: number,
  max: number,
  currency: string,
  language: string,
  side: 'left' | 'right',
): string {
  return Array.from({ length: 5 }, (_, index) => {
    const ratio = index / 4;
    const y = PLOT.bottom - ratio * (PLOT.bottom - PLOT.top);
    const value = min + ratio * (max - min);
    const x = side === 'left' ? PLOT.left - 14 : PLOT.right + 14;
    const anchor = side === 'left' ? 'end' : 'start';
    const line =
      side === 'left'
        ? `<line x1="${PLOT.left}" y1="${y}" x2="${PLOT.right}" y2="${y}" stroke="${LIGHT_TOKENS.border}" stroke-width="1"/>`
        : '';
    return `${line}<line x1="${side === 'left' ? PLOT.left - 5 : PLOT.right}" y1="${y}" x2="${side === 'left' ? PLOT.left : PLOT.right + 5}" y2="${y}" stroke="#64748b"/><text x="${x}" y="${y + 5}" class="axis" text-anchor="${anchor}">${escapeXml(formatCompactMoneyLocale(value, currency, language))}</text>`;
  }).join('');
}

function renderBucketLabels(analysis: ReportAnalysis): string {
  const slot = (PLOT.right - PLOT.left) / Math.max(analysis.chart.length, 1);
  return analysis.chart
    .map((bucket, index) => {
      if (!shouldLabelBucket(analysis.chart, index)) return '';
      const x = PLOT.left + slot * (index + 0.5);
      return `<text x="${x}" y="558" class="axis" text-anchor="middle">${escapeXml(formatChartRange(bucket.start, bucket.end, analysis.period.cadence, analysis.language))}</text>`;
    })
    .join('');
}

function renderCashflowLegend(language: string): string {
  const entries = [
    [CHART_FAMILIES.green[3], localText(language, 'reports.chart.legend.income')],
    [CHART_FAMILIES.amber[3], localText(language, 'reports.chart.legend.expenses')],
    [CHART_FAMILIES.blue[3], localText(language, 'reports.chart.legend.balance')],
    [CHART_FAMILIES.slate[0], localText(language, 'reports.chart.legend.currentPeriod')],
  ] as const;
  return entries
    .map(
      ([color, label], index) =>
        `<rect x="${PLOT.left + index * 190}" y="590" width="22" height="12" fill="${color}"/><text x="${PLOT.left + 30 + index * 190}" y="601" class="legend">${escapeXml(label)}</text>`,
    )
    .join('');
}

function renderStackLegend(
  names: readonly string[],
  ids: readonly string[],
  assigned: Map<string, string>,
): string {
  return names
    .map(
      (name, index) =>
        `<rect x="${PLOT.left + (index % 3) * 340}" y="${582 + Math.floor(index / 3) * 24}" width="16" height="12" fill="${costColor(ids[index] ?? 'other', assigned)}"/><text x="${PLOT.left + 24 + (index % 3) * 340}" y="${593 + Math.floor(index / 3) * 24}" class="legend">${escapeXml(truncate(name, 32))}</text>`,
    )
    .join('');
}

function formatChartRange(
  start: string,
  end: string,
  cadence: ReportAnalysis['period']['cadence'],
  language: string,
): string {
  if (cadence === 'monthly') return start.slice(0, 7);
  const options: Intl.DateTimeFormatOptions = { month: '2-digit', day: '2-digit', timeZone: 'UTC' };
  const formatter = new Intl.DateTimeFormat(language, options);
  const first = formatter.format(new Date(`${start}T12:00:00.000Z`));
  if (start === end) return first;
  return `${first}..${formatter.format(new Date(`${end}T12:00:00.000Z`))}`;
}

function formatCompactMoneyLocale(cents: number, currency: string, language: string): string {
  return getNumberFormat(language, {
    style: 'currency',
    currency,
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(cents / 100);
}

function shouldLabelBucket(values: readonly unknown[], index: number): boolean {
  if (values.length <= 8) return true;
  return index === 0 || index === values.length - 1 || index % 2 === 0;
}

function toChart(
  name: IntelligenceChart['name'],
  filename: string,
  cid: string,
  altText: string,
  svg: string,
): IntelligenceChart {
  const image = new Resvg(svg, {
    background: LIGHT_TOKENS.surface,
    fitTo: { mode: 'original' },
    font: {
      loadSystemFonts: false,
      fontFiles: [...FONT_FILES],
      defaultFontFamily: 'DejaVu Sans',
    },
  }).render();
  return { name, filename, cid, mimeType: 'image/png', bytes: image.asPng(), altText };
}

function paddedDomain(values: readonly number[]): { readonly min: number; readonly max: number } {
  if (values.length === 0) {
    return { min: 0, max: 1 };
  }
  const min = Math.min(...values);
  const max = Math.max(...values);
  const padding = Math.max((max - min) * 0.1, Math.abs(max || min) * 0.05, 1);
  return { min: min - padding, max: max + padding };
}

function scale(
  value: number,
  sourceMin: number,
  sourceMax: number,
  targetMin: number,
  targetMax: number,
): number {
  if (sourceMax === sourceMin) {
    return (targetMin + targetMax) / 2;
  }
  return targetMin + ((value - sourceMin) / (sourceMax - sourceMin)) * (targetMax - targetMin);
}

function truncate(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength - 1)}…`;
}

function escapeXml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function svgDocument(content: string, height = HEIGHT): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${height}" viewBox="0 0 ${WIDTH} ${height}">
    <style>
      text { font-family: Roboto, 'Open Sans', 'Helvetica Neue', Arial, sans-serif; fill: ${LIGHT_TOKENS.text}; }
      .title { font-size: 30px; font-weight: 700; }
      .subtitle { font-size: 16px; fill: ${LIGHT_TOKENS['text-muted']}; }
      .section-title { font-size: 22px; font-weight: 700; }
      .axis { font-size: 14px; fill: ${LIGHT_TOKENS['text-muted']}; }
      .legend { font-size: 15px; fill: ${LIGHT_TOKENS.text}; }
      .empty { font-size: 18px; fill: ${LIGHT_TOKENS['text-muted']}; }
      .bar-label { font-size: 15px; font-weight: 600; }
      .bar-value { font-size: 14px; fill: ${LIGHT_TOKENS['text-muted']}; }
    </style>
    <rect width="${WIDTH}" height="${height}" fill="${LIGHT_TOKENS.surface}"/>
    ${content}
  </svg>`;
}
