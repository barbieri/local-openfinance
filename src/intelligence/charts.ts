import { createRequire } from 'node:module';
import type { DatabaseSync } from 'node:sqlite';
import { Resvg } from '@resvg/resvg-js';
import { buildAnnotationLabelIndex } from '../db/annotation-labels.js';
import type { TransactionChartDataset } from '../db/transaction-charts.js';
import { getNumberFormat } from '../utils/intl-formatters.js';
import { resolveCategoryTranslationEnabled } from '../utils/locale-resolve.js';
import type { ReportAnalysis } from './report-analysis-types.js';
import { buildReportCategoryIndex } from './report-taxonomy.js';

const WIDTH = 1_200;
const HEIGHT = 640;
const PLOT = { left: 145, top: 104, right: 1_040, bottom: 540 } as const;
const COLORS = ['#0f766e', '#2563eb', '#7c3aed', '#c2410c', '#be123c', '#4d7c0f'] as const;
const require = createRequire(import.meta.url);
const FONT_FILES = [
  require.resolve('dejavu-fonts-ttf/ttf/DejaVuSans.ttf'),
  require.resolve('dejavu-fonts-ttf/ttf/DejaVuSans-Bold.ttf'),
] as const;

export type IntelligenceChart = {
  readonly name: 'cashflow' | 'categories' | 'labels';
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
  return [
    toChart(
      'cashflow',
      'report-cashflow.png',
      'report-cashflow@local-openfinance',
      reportChartAltText('cashflow', analysis.language),
      renderCashflowSvg(dataset, analysis),
    ),
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

export function reportChartAltText(name: IntelligenceChart['name'], language: string): string {
  if (name === 'cashflow') {
    return localText(
      language,
      'Fluxo de caixa, saldo e período atual',
      'Cash flow, balance, and current period',
    );
  }
  if (name === 'categories') {
    return localText(
      language,
      'Gastos por categoria ao longo do tempo',
      'Spending by category over time',
    );
  }
  return localText(
    language,
    'Gastos por etiqueta ao longo do tempo',
    'Spending by label over time',
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
    ? `<rect x="${PLOT.left + slot * (buckets.length - 1)}" y="${PLOT.top}" width="${slot}" height="${PLOT.bottom - PLOT.top}" fill="#dbeafe" opacity="0.75"/>`
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
      return `<rect x="${center - barWidth - 2}" y="${incomeY}" width="${barWidth}" height="${PLOT.bottom - incomeY}" fill="#16a34a"/>
        <rect x="${center + 2}" y="${expenseY}" width="${barWidth}" height="${PLOT.bottom - expenseY}" fill="#dc2626"/>`;
    })
    .join('');
  const balancePath = balances
    .map((balance, index) => `${x(index)},${balanceY(balance)}`)
    .join(' ');
  return svgDocument(`
    <text x="${PLOT.left}" y="48" class="title">${escapeXml(localText(analysis.language, 'Saldo e fluxo de caixa', 'Balance and cash flow'))}</text>
    <text x="${PLOT.left}" y="76" class="subtitle">${escapeXml(localText(analysis.language, 'Gastos excluem transferências internas, investimentos e liquidações', 'Expenses exclude internal transfers, investments, and settlements'))}</text>
    ${currentBand}${cashGrid}${balanceGrid}${bars}
    ${balances.length ? `<polyline points="${balancePath}" fill="none" stroke="#2563eb" stroke-width="4" stroke-linejoin="round" stroke-linecap="round"/>` : ''}
    ${renderBucketLabels(analysis)}
    ${renderCashflowLegend(analysis.language)}
  `);
}

function renderStackedAllocationSvg(
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
  const rows = analysis.chart.map((bucket, index) => {
    const totals = source[index] ?? {};
    const visible = ids.map((id) => totals[id] ?? 0);
    const all = Object.values(totals).reduce((sum, value) => sum + value, 0);
    const other = Math.max(0, all - visible.reduce((sum, value) => sum + value, 0));
    return { bucket, values: [...visible, other] };
  });
  const max = Math.max(...rows.map((row) => row.values.reduce((sum, value) => sum + value, 0)), 1);
  const slot = (PLOT.right - PLOT.left) / Math.max(rows.length, 1);
  const bars = rows
    .map((row, index) => {
      let y = PLOT.bottom;
      return row.values
        .map((value, valueIndex) => {
          const height = (value / max) * (PLOT.bottom - PLOT.top);
          y -= height;
          return `<rect x="${PLOT.left + slot * index + slot * 0.18}" y="${y}" width="${slot * 0.64}" height="${height}" fill="${COLORS[valueIndex % COLORS.length]}"/>`;
        })
        .join('');
    })
    .join('');
  const title =
    kind === 'category'
      ? localText(analysis.language, 'Gastos por categoria', 'Spending by category')
      : localText(analysis.language, 'Gastos por etiqueta', 'Spending by label');
  const names = [
    ...ids.map((id) => displayNames?.[id] ?? id),
    localText(analysis.language, 'Outros', 'Others'),
  ];
  return svgDocument(`
    <text x="${PLOT.left}" y="48" class="title">${escapeXml(title)}</text>
    <text x="${PLOT.left}" y="76" class="subtitle">${escapeXml(
      kind === 'category'
        ? localText(
            analysis.language,
            'Categorias principais; o restante aparece como Outros',
            'Main categories; the remainder is Others',
          )
        : localText(
            analysis.language,
            'Etiquetas principais; o restante aparece como Outros',
            'Main labels; the remainder is Others',
          ),
    )}</text>
    ${renderDualGrid(0, max, analysis.currency, analysis.language, 'left')}
    ${bars}${renderBucketLabels(analysis)}${renderStackLegend(names)}
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
        ? `<line x1="${PLOT.left}" y1="${y}" x2="${PLOT.right}" y2="${y}" stroke="#e2e8f0" stroke-width="1"/>`
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
    ['#16a34a', localText(language, 'Receitas', 'Income')],
    ['#dc2626', localText(language, 'Gastos', 'Expenses')],
    ['#2563eb', localText(language, 'Saldo', 'Balance')],
    ['#dbeafe', localText(language, 'Período atual', 'Current period')],
  ] as const;
  return entries
    .map(
      ([color, label], index) =>
        `<rect x="${PLOT.left + index * 190}" y="590" width="22" height="12" fill="${color}"/><text x="${PLOT.left + 30 + index * 190}" y="601" class="legend">${escapeXml(label)}</text>`,
    )
    .join('');
}

function renderStackLegend(names: readonly string[]): string {
  return names
    .map(
      (name, index) =>
        `<rect x="${PLOT.left + (index % 3) * 340}" y="${582 + Math.floor(index / 3) * 24}" width="16" height="12" fill="${COLORS[index % COLORS.length]}"/><text x="${PLOT.left + 24 + (index % 3) * 340}" y="${593 + Math.floor(index / 3) * 24}" class="legend">${escapeXml(truncate(name, 32))}</text>`,
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

function localText(language: string, pt: string, en: string): string {
  return language.toLowerCase().startsWith('pt') ? pt : en;
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
    background: '#ffffff',
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

function svgDocument(content: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">
    <style>
      text { font-family: 'DejaVu Sans'; fill: #0f172a; }
      .title { font-size: 30px; font-weight: 700; }
      .subtitle { font-size: 16px; fill: #64748b; }
      .section-title { font-size: 22px; font-weight: 700; }
      .axis { font-size: 14px; fill: #64748b; }
      .legend { font-size: 15px; fill: #334155; }
      .empty { font-size: 18px; fill: #94a3b8; }
      .bar-label { font-size: 15px; font-weight: 600; }
      .bar-value { font-size: 14px; fill: #475569; }
    </style>
    <rect width="${WIDTH}" height="${HEIGHT}" fill="#ffffff"/>
    ${content}
  </svg>`;
}
