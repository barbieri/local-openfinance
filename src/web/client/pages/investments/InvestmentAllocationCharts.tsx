import { clsx } from 'clsx';
import { use } from 'react';
import { useTranslation } from 'react-i18next';
import { ChartAmountTooltip } from '../../components/charts/ChartAmountTooltip.js';
import { rechartsModule } from '../../components/charts/recharts-module.js';
import { formatCurrencyAmount } from '../../lib/format.js';
import type {
  InvestmentAllocationBucket,
  InvestmentAllocationCurrencyChart,
  InvestmentAllocationSelection,
} from './investment-allocation-chart-data.js';

type InvestmentAllocationChartsProps = {
  readonly charts: readonly InvestmentAllocationCurrencyChart[];
  readonly onSelect: (currency: string, selection: InvestmentAllocationSelection) => void;
};

export function InvestmentAllocationCharts({ charts, onSelect }: InvestmentAllocationChartsProps) {
  const { t } = useTranslation();

  if (charts.length === 0) {
    return <p className="text-sm text-muted-foreground">{t('investmentCharts.noData')}</p>;
  }

  return (
    <div className="space-y-4">
      {charts.map((chart) => (
        <InvestmentAllocationCurrencyChartView
          key={chart.currency}
          chart={chart}
          onSelect={onSelect}
        />
      ))}
    </div>
  );
}

function InvestmentAllocationCurrencyChartView({
  chart,
  onSelect,
}: {
  readonly chart: InvestmentAllocationCurrencyChart;
  readonly onSelect: (currency: string, selection: InvestmentAllocationSelection) => void;
}) {
  const { t, i18n } = useTranslation();
  const { selection } = chart;
  const selectType = (id: string | null) =>
    onSelect(chart.currency, { typeId: id, subtypeId: null, codeId: null });
  const selectSubtype = (id: string | null) =>
    onSelect(chart.currency, { typeId: selection.typeId, subtypeId: id, codeId: null });
  const selectCode = (id: string | null) =>
    onSelect(chart.currency, {
      typeId: selection.typeId,
      subtypeId: selection.subtypeId,
      codeId: id,
    });

  return (
    <section className="space-y-2">
      <h3 className="text-sm font-medium">
        {t('investmentCharts.currency', { currency: chart.currency })}
      </h3>
      <div className="grid gap-4 xl:grid-cols-3">
        {chart.types.length > 1 && (
          <InvestmentAllocationPie
            title={t('investmentCharts.byType')}
            buckets={chart.types}
            selectedId={selection.typeId}
            currency={chart.currency}
            locale={i18n.language}
            onSelect={selectType}
          />
        )}
        {selection.type && chart.subtypes.length > 1 && (
          <InvestmentAllocationPie
            title={t('investmentCharts.bySubtype', { type: selection.type.label })}
            buckets={chart.subtypes}
            selectedId={selection.subtypeId}
            currency={chart.currency}
            locale={i18n.language}
            onSelect={selectSubtype}
          />
        )}
        {selection.type && selection.subtype && chart.codes.length > 0 && (
          <InvestmentAllocationPie
            title={t('investmentCharts.byCode', { subtype: selection.subtype.label })}
            buckets={chart.codes}
            selectedId={selection.codeId}
            currency={chart.currency}
            locale={i18n.language}
            onSelect={selectCode}
          />
        )}
      </div>
      {chart.types.length > 1 && !selection.type && (
        <p className="text-sm text-muted-foreground">{t('investmentCharts.selectTypeHint')}</p>
      )}
      {selection.type && chart.subtypes.length > 1 && !selection.subtype && (
        <p className="text-sm text-muted-foreground">{t('investmentCharts.selectSubtypeHint')}</p>
      )}
    </section>
  );
}

function InvestmentAllocationPie({
  title,
  buckets,
  selectedId,
  currency,
  locale,
  onSelect,
}: {
  readonly title: string;
  readonly buckets: readonly InvestmentAllocationBucket[];
  readonly selectedId: string | null;
  readonly currency: string;
  readonly locale: string;
  readonly onSelect: (id: string | null) => void;
}) {
  const { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } = use(rechartsModule);
  const { t } = useTranslation();
  const toggle = (id: string) => onSelect(selectedId === id ? null : id);
  return (
    <div className="min-h-[240px] rounded-md border border-border bg-background p-2">
      <p className="mb-2 text-xs text-muted-foreground">{title}</p>
      <ResponsiveContainer width="100%" height={220}>
        <PieChart>
          <Pie
            data={buckets}
            dataKey="cents"
            nameKey="label"
            innerRadius={buckets.length > 1 ? 48 : 0}
            outerRadius={88}
            paddingAngle={buckets.length > 1 ? 1 : 0}
            onClick={(entry) => {
              const id = String(entry?.payload?.id ?? '');
              toggle(id);
            }}
          >
            {buckets.map((bucket) => (
              <Cell
                key={bucket.id}
                fill={bucket.color}
                stroke="var(--background)"
                strokeWidth={selectedId === bucket.id ? 3 : 1}
                opacity={selectedId && selectedId !== bucket.id ? 0.45 : 1}
              />
            ))}
          </Pie>
          <Tooltip content={<ChartAmountTooltip currency={currency} locale={locale} />} />
        </PieChart>
      </ResponsiveContainer>
      <InvestmentAllocationPieControls
        title={title}
        buckets={buckets}
        selectedId={selectedId}
        currency={currency}
        locale={locale}
        selectLabel={(bucket) =>
          t('investmentCharts.selectBucket', {
            label: bucket.label,
            amount: formatCurrencyAmount(bucket.cents, currency, locale),
          })
        }
        onSelect={toggle}
      />
    </div>
  );
}

export function InvestmentAllocationPieControls({
  title,
  buckets,
  selectedId,
  currency,
  locale,
  selectLabel,
  onSelect,
}: {
  readonly title: string;
  readonly buckets: readonly InvestmentAllocationBucket[];
  readonly selectedId: string | null;
  readonly currency: string;
  readonly locale: string;
  readonly selectLabel: (bucket: InvestmentAllocationBucket) => string;
  readonly onSelect: (id: string) => void;
}) {
  return (
    <ul aria-label={title} className="mt-2 flex flex-wrap gap-1">
      {buckets.map((bucket) => {
        const selected = selectedId === bucket.id;
        return (
          <li key={bucket.id}>
            <button
              type="button"
              aria-pressed={selected}
              aria-label={selectLabel(bucket)}
              className={clsx(
                'rounded border border-border px-2 py-1 text-left text-xs transition-opacity',
                selected ? 'border-primary bg-primary/10' : 'hover:bg-accent',
                selectedId && !selected && 'opacity-45',
              )}
              onClick={() => onSelect(bucket.id)}
            >
              <span
                aria-hidden
                className="mr-1 inline-block size-2 rounded-full"
                style={{ backgroundColor: bucket.color }}
              />
              <span>{bucket.label}</span>{' '}
              <span className="tabular-nums text-muted-foreground">
                {formatCurrencyAmount(bucket.cents, currency, locale)}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
