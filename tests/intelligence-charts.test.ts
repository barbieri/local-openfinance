import { describe, expect, it } from 'vitest';
import type { TransactionChartDataset } from '../src/db/transaction-charts.js';
import {
  formatMonthlyTrendDelta,
  renderInvestmentAllocationCharts,
  renderMonthlyComparisonSvg,
  renderReportAnalysisCharts,
} from '../src/intelligence/charts.js';
import type { InvestmentReportSnapshot } from '../src/intelligence/investment-report-snapshot.js';
import {
  buildMonthlyComparisonModel,
  linearRegression,
} from '../src/intelligence/monthly-comparison.js';
import type { ReportAnalysis } from '../src/intelligence/report-analysis-types.js';
import { sanitizeReportBodyHtml } from '../src/intelligence/report-document.js';
import { buildMonthlyComparisonTable } from '../src/intelligence/report-runner.js';

const dataset: TransactionChartDataset = {
  total: 4,
  currency: 'BRL',
  dailyBalance: [
    { date: '2026-08-10', credit: 0, debit: 10_000, balance: 100_000, isEstimated: false },
    { date: '2026-08-11', credit: 20_000, debit: 0, balance: 120_000, isEstimated: false },
    { date: '2026-08-12', credit: 0, debit: 40_000, balance: 80_000, isEstimated: false },
  ],
  categoryTotals: { groceries: 40_000, housing: 100_000 },
  labelTotals: { holiday: 30_000 },
};

const analysis: ReportAnalysis = {
  period: {
    start: '2026-08-10',
    end: '2026-08-16',
    cadence: 'weekly',
    comparisonBasis: 'equal-length',
  },
  language: 'pt-BR',
  currency: 'BRL',
  summary: {
    expense: 'R$ 1.400,00',
    income: 'R$ 200,00',
    refund: 'R$ 0,00',
    expenseDelta: '+R$ 400,00',
    expenseRatio: '+40%',
    incomeDelta: '+R$ 200,00',
    incomeRatio: null,
  },
  candidates: [],
  profiles: [],
  mustInspect: [],
  mustReport: [],
  classification: {
    confirmed: 4,
    'accepted-suggestion': 0,
    'assumed-suggestion': 0,
    unclassified: 0,
  },
  excluded: {
    internal: { structural: 0, semantic: 0 },
    portfolio: 0,
    settlements: 0,
  },
  chart: [
    {
      start: '2026-08-03',
      end: '2026-08-09',
      incomeCents: 10_000,
      expenseCents: 80_000,
      categoryTotals: { housing: 80_000 },
      labelTotals: {},
    },
    {
      start: '2026-08-10',
      end: '2026-08-16',
      incomeCents: 20_000,
      expenseCents: 140_000,
      categoryTotals: { groceries: 40_000, housing: 100_000 },
      labelTotals: { holiday: 30_000 },
    },
  ],
};

describe('intelligence PNG charts', () => {
  it('renders deterministic currency-separated investment pies only for multi-bucket dimensions', () => {
    const snapshot: InvestmentReportSnapshot = {
      version: 2,
      scopeFingerprint: 'scope',
      availability: 'included',
      previousPeriodEnd: null,
      materialChanges: [],
      currencies: ['BRL', 'USD'].map((currency) => ({
        currency,
        totalCents: 36_000,
        count: 8,
        type: [
          { id: 'a', label: 'A', cents: 20_000, count: 1 },
          { id: 'b', label: 'B', cents: 16_000, count: 1 },
        ],
        subtype: [{ id: 'a / one', label: 'A / one', cents: 36_000, count: 2 }],
        code: Array.from({ length: 8 }, (_, index) => ({
          id: `a / code-${index}`,
          label: `Code ${index}`,
          cents: 4_500,
          count: 1,
        })),
      })),
    };
    const first = renderInvestmentAllocationCharts(snapshot, 'pt-BR');
    const second = renderInvestmentAllocationCharts(snapshot, 'pt-BR');
    expect(first.map((chart) => chart.name)).toEqual(['investments-type', 'investments-code']);
    expect(first.map((chart) => chart.altText)).toEqual([
      'Alocação de investimentos por tipo',
      'Alocação de investimentos por código',
    ]);
    expect(first.map((chart) => Buffer.from(chart.bytes))).toEqual(
      second.map((chart) => Buffer.from(chart.bytes)),
    );
    for (const chart of first) {
      expect(Buffer.from(chart.bytes).subarray(0, 8)).toEqual(
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      );
      expect(Buffer.from(chart.bytes).readUInt32BE(20)).toBeGreaterThanOrEqual(390);
    }
    expect(
      renderInvestmentAllocationCharts(
        { ...snapshot, availability: 'excluded', previousPeriodEnd: null, currencies: [] },
        'pt-BR',
      ),
    ).toEqual([]);
  });

  it('renders the three current report artifacts as 1200x640 PNGs', () => {
    const charts = renderReportAnalysisCharts(dataset, analysis, {
      categories: { groceries: 'Mercado', housing: 'Casa' },
      labels: { holiday: 'Viagem' },
    });

    expect(charts.map((chart) => chart.name)).toEqual(['cashflow', 'categories', 'labels']);
    for (const chart of charts) {
      const bytes = Buffer.from(chart.bytes);
      expect(bytes.subarray(0, 8)).toEqual(
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      );
      expect(bytes.readUInt32BE(16)).toBe(1_200);
      expect(bytes.readUInt32BE(20)).toBe(640);
      expect(bytes.length).toBeGreaterThan(5_000);
    }
  });

  it('renders a single-axis monthly comparison from 12 analysis buckets', () => {
    const monthly: ReportAnalysis = {
      ...analysis,
      period: {
        start: '2026-08-01',
        end: '2026-08-31',
        cadence: 'monthly',
        comparisonBasis: 'calendar-month',
      },
      chart: Array.from({ length: 13 }, (_, index) => {
        const start = new Date(Date.UTC(2025, 7 + index, 1));
        const end = new Date(Date.UTC(2025, 8 + index, 0));
        return {
          start: start.toISOString().slice(0, 10),
          end: end.toISOString().slice(0, 10),
          incomeCents: (index + 2) * 10_000,
          expenseCents: (index + 1) * 5_000,
          categoryTotals: {},
          labelTotals: {},
        };
      }),
    };
    const model = buildMonthlyComparisonModel(monthly.chart);
    expect(model.buckets).toHaveLength(12);
    expect(model.buckets[0]?.start).toBe('2025-09-01');
    expect(model.balances).toEqual(
      model.buckets.reduce<number[]>((values, bucket) => {
        values.push((values.at(-1) ?? 0) + bucket.incomeCents - bucket.expenseCents);
        return values;
      }, []),
    );

    expect(linearRegression([3, 5, 7, 9])).toEqual({ slope: 2, intercept: 3 });
    expect(formatMonthlyTrendDelta(125_000, 'BRL', 'pt-BR')).toBe('+R$ 1,3 mil/mês');
    expect(formatMonthlyTrendDelta(-125_000, 'BRL', 'en-US')).toBe('-R$1.3K/month');

    const svg = renderMonthlyComparisonSvg(monthly);
    const dashedLines = [
      ...svg.matchAll(/<polyline class="monthly-trend" points="([^"]+)"[^>]+stroke-dasharray/g),
    ];
    expect(dashedLines).toHaveLength(2);
    expect(dashedLines.every((match) => match[1]?.trim().split(' ').length === 2)).toBe(true);
    expect(dashedLines.every((match) => match[1]?.startsWith('182.29166666666666,'))).toBe(true);
    expect(dashedLines.every((match) => match[1]?.includes('1002.7083333333333,'))).toBe(true);
    expect(svg).toContain('stroke="#dc2626"');
    expect(svg).toContain('stroke="#2563eb"');
    expect(svg).toContain('stroke="#d25f31"');
    expect(svg).not.toContain('text-anchor="start"');

    const charts = renderReportAnalysisCharts(dataset, monthly);
    expect(charts.map((chart) => chart.name)).toEqual([
      'monthly-comparison',
      'categories',
      'labels',
    ]);

    const table = buildMonthlyComparisonTable(monthly);
    expect(table).toContain('<table class="report-table">');
    expect(table).toContain('<td class="report-table-value">');
    expect(table.match(/<thead><tr><th>/g)).toHaveLength(1);
    expect(table.match(/<th>/g)).toHaveLength(20);
    expect(table).toContain('<th>Gastos</th>');
    expect(table).toContain('<th>Rendimentos</th>');
    expect(table).toContain('<th>Balanço do mês</th>');
    expect(table).toContain('<th>Balanço acumulado</th>');
    expect(table).toContain('<tr class="report-table-section"><th>Variação mensal (MoM)</th>');
    expect(table).toContain('<th>Rendimentos MoM</th>');
    expect(table).toContain('<th>Gastos MoM</th>');
    expect(sanitizeReportBodyHtml(table)).toContain('<table class="report-table">');
  });

  it('renders signed monthly balances and month-over-month changes', () => {
    const monthly: ReportAnalysis = {
      ...analysis,
      period: {
        start: '2026-03-01',
        end: '2026-03-31',
        cadence: 'monthly',
        comparisonBasis: 'calendar-month',
      },
      chart: [
        {
          start: '2026-01-01',
          end: '2026-01-31',
          incomeCents: 10_000,
          expenseCents: 8_000,
          categoryTotals: {},
          labelTotals: {},
        },
        {
          start: '2026-02-01',
          end: '2026-02-28',
          incomeCents: 12_000,
          expenseCents: 10_000,
          categoryTotals: {},
          labelTotals: {},
        },
        {
          start: '2026-03-01',
          end: '2026-03-31',
          incomeCents: 4_000,
          expenseCents: 5_000,
          categoryTotals: {},
          labelTotals: {},
        },
      ],
    };

    const table = buildMonthlyComparisonTable(monthly);

    expect(table).toContain(
      '<th>Balanço do mês</th><td class="report-table-value report-table-positive">R$ 20,00</td><td class="report-table-value report-table-positive">R$ 20,00</td><td class="report-table-value report-table-negative">-R$ 10,00</td>',
    );
    expect(table).toContain(
      '<th>Rendimentos MoM</th><td class="report-table-value">—</td><td class="report-table-value report-table-positive">+20,0%</td><td class="report-table-value report-table-negative">-66,7%</td>',
    );
    expect(table).toContain(
      '<th>Gastos MoM</th><td class="report-table-value">—</td><td class="report-table-value report-table-negative">+25,0%</td><td class="report-table-value report-table-positive">-50,0%</td>',
    );
    const sanitized = sanitizeReportBodyHtml(table);
    expect(sanitized).toContain('report-table-positive');
    expect(sanitized).toContain('report-table-negative');
    expect(sanitized).toContain('report-table-value');
  });

  it('marks a partial month and excludes it from MoM and trend comparisons', () => {
    const monthly: ReportAnalysis = {
      ...analysis,
      period: {
        start: '2026-03-10',
        end: '2026-03-20',
        cadence: 'monthly',
        comparisonBasis: 'equal-length',
      },
      chart: [
        {
          start: '2026-01-01',
          end: '2026-01-31',
          incomeCents: 20_000,
          expenseCents: 10_000,
          categoryTotals: {},
          labelTotals: {},
        },
        {
          start: '2026-02-01',
          end: '2026-02-28',
          incomeCents: 30_000,
          expenseCents: 20_000,
          categoryTotals: {},
          labelTotals: {},
        },
        {
          start: '2026-03-01',
          end: '2026-03-20',
          incomeCents: 400_000,
          expenseCents: 100_000,
          categoryTotals: {},
          labelTotals: {},
        },
      ],
    };

    const model = buildMonthlyComparisonModel(monthly.chart);
    const table = buildMonthlyComparisonTable(monthly);
    const svg = renderMonthlyComparisonSvg(monthly);
    const trendLines = [
      ...svg.matchAll(/<polyline class="monthly-trend" points="([^"]+)"[^>]+stroke-dasharray/g),
    ];

    expect(model.completeMonths).toEqual([true, true, false]);
    expect(model.expenseMom).toEqual([null, 1, null]);
    expect(model.incomeMom).toEqual([null, 0.5, null]);
    expect(model.trend?.expense.slope).toBe(10_000);
    expect(model.trend?.startIndex).toBe(0);
    expect(model.trend?.endIndex).toBe(1);
    expect(table).toContain('<th>2026-03 parcial</th>');
    expect(table).toContain(
      '<th>Gastos MoM</th><td class="report-table-value">—</td><td class="report-table-value report-table-negative">+100,0%</td><td class="report-table-value">—</td>',
    );
    expect(svg).toContain('parcial');
    expect(trendLines).toHaveLength(2);
    expect(
      trendLines.every((line) => Number(line[1]?.split(' ')[1]?.split(',')[0]) === 592.5),
    ).toBe(true);
  });

  it('regresses complete months at their original positions between partial boundaries', () => {
    const monthly: ReportAnalysis = {
      ...analysis,
      period: {
        start: '2026-04-15',
        end: '2026-07-15',
        cadence: 'monthly',
        comparisonBasis: 'equal-length',
      },
      chart: [
        {
          start: '2026-04-15',
          end: '2026-04-30',
          incomeCents: 0,
          expenseCents: 100_000,
          categoryTotals: {},
          labelTotals: {},
        },
        {
          start: '2026-05-01',
          end: '2026-05-31',
          incomeCents: 0,
          expenseCents: 10_000,
          categoryTotals: {},
          labelTotals: {},
        },
        {
          start: '2026-06-01',
          end: '2026-06-30',
          incomeCents: 0,
          expenseCents: 20_000,
          categoryTotals: {},
          labelTotals: {},
        },
        {
          start: '2026-07-01',
          end: '2026-07-15',
          incomeCents: 0,
          expenseCents: 100_000,
          categoryTotals: {},
          labelTotals: {},
        },
      ],
    };

    const model = buildMonthlyComparisonModel(monthly.chart);
    const svg = renderMonthlyComparisonSvg(monthly);
    const trendLines = [
      ...svg.matchAll(/<polyline class="monthly-trend" points="([^"]+)"[^>]+stroke-dasharray/g),
    ];

    expect(model.completeMonths).toEqual([false, true, true, false]);
    expect(model.expenseMom).toEqual([null, null, 1, null]);
    expect(model.trend?.startIndex).toBe(1);
    expect(model.trend?.endIndex).toBe(2);
    expect(model.trend?.expense.slope).toBe(10_000);
    expect(trendLines).toHaveLength(2);
    expect(
      trendLines.map((line) => line[1]?.split(' ').map((point) => Number(point.split(',')[0]))),
    ).toEqual([
      [480.625, 704.375],
      [480.625, 704.375],
    ]);
  });

  it('renders stable bytes for identical inputs', () => {
    const first = renderReportAnalysisCharts(dataset, analysis);
    const second = renderReportAnalysisCharts(dataset, analysis);
    expect(second.map((chart) => Buffer.from(chart.bytes))).toEqual(
      first.map((chart) => Buffer.from(chart.bytes)),
    );
  });

  it('renders a one-day current period', () => {
    const oneDayAnalysis: ReportAnalysis = {
      ...analysis,
      period: {
        start: '2026-08-10',
        end: '2026-08-10',
        cadence: 'daily',
        comparisonBasis: 'equal-length',
      },
      chart: [
        {
          start: '2026-08-10',
          end: '2026-08-10',
          incomeCents: 0,
          expenseCents: 10_000,
          categoryTotals: { groceries: 10_000 },
          labelTotals: {},
        },
      ],
    };

    const cashflow = renderReportAnalysisCharts(dataset, oneDayAnalysis)[0];
    expect(cashflow?.name).toBe('cashflow');
    expect(cashflow?.bytes.length).toBeGreaterThan(5_000);
  });
});
