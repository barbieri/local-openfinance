import { describe, expect, it } from 'vitest';
import {
  assignInvestmentAllocationChartColors,
  buildInvestmentAllocationCurrencyCharts,
  buildInvestmentAllocationModel,
  clearInvestmentAllocationChartSelections,
  type InvestmentAllocationPosition,
  type InvestmentAllocationSelection,
  investmentAllocationChartColor,
  resolveInvestmentAllocationSelection,
  summarizeInvestmentAllocationGroup,
} from '../src/web/client/pages/investments/investment-allocation-chart-data.js';

const positions = [
  {
    id: 'brl-cdb',
    currency: 'BRL',
    type: 'FIXED_INCOME',
    subtype: 'CDB',
    code: 'CDB1',
    displayName: 'CDB1',
    totalCents: 10000,
    allocationCents: 10000,
  },
  {
    id: 'brl-lci',
    currency: 'BRL',
    type: 'FIXED_INCOME',
    subtype: 'LCI',
    code: 'LCI1',
    displayName: 'LCI1',
    totalCents: 20000,
    allocationCents: 20000,
  },
  {
    id: 'brl-etf',
    currency: 'BRL',
    type: 'VARIABLE_INCOME',
    subtype: 'ETF',
    code: 'ETF1',
    displayName: 'ETF1',
    totalCents: 50000,
    allocationCents: 50000,
  },
  {
    id: 'usd-etf',
    currency: 'USD',
    type: 'VARIABLE_INCOME',
    subtype: 'ETF',
    code: 'SPY',
    displayName: 'SPY',
    totalCents: 30000,
    allocationCents: 30000,
  },
  {
    id: 'zero',
    currency: 'BRL',
    type: 'FIXED_INCOME',
    subtype: 'CDB',
    code: 'ZERO',
    displayName: 'ZERO',
    totalCents: 0,
    allocationCents: 0,
  },
] satisfies readonly InvestmentAllocationPosition[];

function chartsFor(
  chartPositions: readonly InvestmentAllocationPosition[],
  selections: Readonly<Record<string, InvestmentAllocationSelection>> = {},
) {
  return buildInvestmentAllocationCurrencyCharts(
    buildInvestmentAllocationModel(chartPositions),
    selections,
  );
}

describe('investment allocation chart data', () => {
  it('keeps allocation totals and drilldowns separate for every currency', () => {
    const charts = chartsFor(positions);

    expect(charts.map((chart) => chart.currency)).toEqual(['BRL', 'USD']);
    expect(charts[0]?.types).toMatchObject([
      { label: 'VARIABLE_INCOME', cents: 50000 },
      { label: 'FIXED_INCOME', cents: 30000 },
    ]);
    expect(charts[1]?.types).toMatchObject([{ label: 'VARIABLE_INCOME', cents: 30000 }]);
    expect(charts[1]?.selection).toMatchObject({
      typeId: 'VARIABLE_INCOME',
      subtypeId: 'VARIABLE_INCOME / ETF',
      codeId: null,
    });
    expect(charts[1]?.codes).toMatchObject([{ label: 'SPY', cents: 30000 }]);
  });

  it('partitions row and grouped allocation percentages by currency', () => {
    const model = buildInvestmentAllocationModel(positions);
    const summary = summarizeInvestmentAllocationGroup(model, ['brl-cdb', 'usd-etf']);

    expect(model.allocationById.get('brl-cdb')).toBe(0.125);
    expect(model.allocationById.get('usd-etf')).toBe(1);
    expect(summary.currencies).toEqual([
      { currency: 'BRL', totalCents: 10000, allocationPercent: 0.125 },
      { currency: 'USD', totalCents: 30000, allocationPercent: 1 },
    ]);
  });

  it('resolves singleton levels and expands the selected hierarchy only', () => {
    const selectedType = chartsFor(positions, {
      BRL: { typeId: 'FIXED_INCOME', subtypeId: null, codeId: null },
    })[0];
    expect(selectedType?.subtypes).toMatchObject([
      { label: 'FIXED_INCOME / LCI', cents: 20000 },
      { label: 'FIXED_INCOME / CDB', cents: 10000 },
    ]);
    expect(selectedType?.codes).toEqual([]);

    const selectedSubtype = chartsFor(positions, {
      BRL: {
        typeId: 'FIXED_INCOME',
        subtypeId: 'FIXED_INCOME / CDB',
        codeId: null,
      },
    })[0];
    expect(selectedSubtype?.codes).toMatchObject([{ label: 'CDB1', cents: 10000 }]);
    expect(selectedSubtype?.selection.codeId).toBeNull();
  });

  it('clears stale selections after filtered rows remove their path', () => {
    const firstPosition = positions[0];
    if (!firstPosition) {
      throw new Error('fixture must include a BRL CDB');
    }
    const [chart] = chartsFor([firstPosition], {
      BRL: {
        typeId: 'VARIABLE_INCOME',
        subtypeId: 'VARIABLE_INCOME / ETF',
        codeId: 'VARIABLE_INCOME / ETF / code:ETF1',
      },
    });
    if (!chart) {
      throw new Error('chart should include the positive fixture row');
    }

    expect(chart.selection).toMatchObject({
      typeId: 'FIXED_INCOME',
      subtypeId: 'FIXED_INCOME / CDB',
      codeId: null,
    });
    expect(
      resolveInvestmentAllocationSelection({
        types: chart.types,
        subtypes: chart.subtypes,
        codes: chart.codes,
        selection: {
          typeId: 'missing',
          subtypeId: 'missing',
          codeId: 'missing',
        },
      }),
    ).toEqual(chart.selection);
  });

  it('keeps a singleton code unselected until the user selects it', () => {
    const firstPosition = positions[0];
    if (!firstPosition) {
      throw new Error('fixture must include a BRL CDB');
    }
    const [chart] = chartsFor([firstPosition]);
    if (!chart) {
      throw new Error('chart should include the positive fixture row');
    }
    const code = chart.codes[0];
    if (!code) {
      throw new Error('chart should include the code fixture');
    }

    expect(chart.selection.codeId).toBeNull();
    expect(
      resolveInvestmentAllocationSelection({
        types: chart.types,
        subtypes: chart.subtypes,
        codes: chart.codes,
        selection: { ...chart.selection, codeId: code.id },
      }).codeId,
    ).toBe(code.id);
    expect(
      resolveInvestmentAllocationSelection({
        types: chart.types,
        subtypes: chart.subtypes,
        codes: chart.codes,
        selection: { ...chart.selection, codeId: null },
      }).codeId,
    ).toBeNull();
  });

  it('clears requested drilldown selections when a row filter changes', () => {
    expect(
      clearInvestmentAllocationChartSelections({
        BRL: {
          typeId: 'FIXED_INCOME',
          subtypeId: 'FIXED_INCOME / CDB',
          codeId: 'FIXED_INCOME / CDB / code:CDB1',
        },
      }),
    ).toEqual({});
  });

  it('uses a stable color for a qualified bucket id', () => {
    const [original] = chartsFor(positions);
    const [reordered] = chartsFor([...positions].reverse());
    const [amountChanged] = chartsFor(
      positions.map((position) =>
        position.id === 'brl-cdb'
          ? { ...position, totalCents: 99999, allocationCents: 99999 }
          : position,
      ),
    );
    const [withoutCdb] = chartsFor(positions.filter((position) => position.id !== 'brl-cdb'));
    const colorsById = (chart: typeof original) =>
      Object.fromEntries(chart?.types.map(({ id, color }) => [id, color]) ?? []);
    expect(colorsById(original)).toEqual(colorsById(reordered));
    expect(colorsById(original)).toEqual(colorsById(amountChanged));
    expect(colorsById(withoutCdb)).toEqual(colorsById(original));
    const colors = assignInvestmentAllocationChartColors(['FIXED_INCOME', 'VARIABLE_INCOME']);
    expect(colors.get('FIXED_INCOME')).not.toBe(colors.get('VARIABLE_INCOME'));
    expect(investmentAllocationChartColor('FIXED_INCOME / CDB / code:CDB1')).toBe(
      investmentAllocationChartColor('FIXED_INCOME / CDB / code:CDB1'),
    );
  });

  it('assigns colors to more code buckets than a fixed palette can hold', () => {
    const [chart] = chartsFor(
      Array.from({ length: 20 }, (_, index) => ({
        id: `code-${index}`,
        currency: 'BRL',
        type: 'FIXED_INCOME',
        subtype: 'CDB',
        code: `CDB-${index}`,
        displayName: `CDB-${index}`,
        totalCents: 10000,
        allocationCents: 10000,
      })),
    );
    if (!chart) {
      throw new Error('chart should include code fixtures');
    }

    expect(chart.codes).toHaveLength(20);
    expect(new Set(chart.codes.map((bucket) => bucket.color)).size).toBe(20);
  });
});
