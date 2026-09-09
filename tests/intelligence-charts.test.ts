import { describe, expect, it } from 'vitest';
import type { TransactionChartDataset } from '../src/db/transaction-charts.js';
import { renderReportAnalysisCharts } from '../src/intelligence/charts.js';
import type { ReportAnalysis } from '../src/intelligence/report-analysis-types.js';

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
  period: { start: '2026-08-10', end: '2026-08-16', cadence: 'weekly' },
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
      period: { start: '2026-08-10', end: '2026-08-10', cadence: 'daily' },
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
