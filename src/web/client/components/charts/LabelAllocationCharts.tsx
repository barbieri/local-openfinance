import { use, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { ChartBucket } from '../../../../chart/transaction-aggregates.js';
import { toBarData, useChartCurrencyFormatter } from './allocation-chart-data.js';
import { ChartAmountTooltip } from './ChartAmountTooltip.js';
import { rechartsModule } from './recharts-module.js';

export function LabelAllocationCharts({
  buckets,
  subBuckets,
  selectedLabelId,
  selectedLabelName,
  currency,
  onSelectLabel,
}: {
  readonly buckets: readonly ChartBucket[];
  readonly subBuckets: readonly ChartBucket[];
  readonly selectedLabelId: string | null;
  readonly selectedLabelName: string | null;
  readonly currency: string;
  readonly onSelectLabel: (labelId: string | null) => void;
}) {
  const { Bar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } = use(rechartsModule);
  const { t, i18n } = useTranslation();
  const barData = useMemo(() => toBarData(buckets), [buckets]);
  const subBarData = useMemo(() => toBarData(subBuckets), [subBuckets]);
  const formatAmount = useChartCurrencyFormatter(currency, i18n.language);

  if (barData.length === 0) {
    return null;
  }

  return (
    <section className="space-y-3">
      <h4 className="text-sm font-medium">{t('charts.byLabel')}</h4>
      <div className="min-h-[260px] rounded-md border border-border bg-background p-2">
        <ResponsiveContainer width="100%" height={260}>
          <BarChart data={barData} margin={{ top: 8, right: 8, left: 8, bottom: 48 }}>
            <XAxis
              dataKey="name"
              tick={{ fontSize: 11 }}
              interval={0}
              angle={-25}
              textAnchor="end"
              height={60}
            />
            <YAxis tick={{ fontSize: 11 }} width={72} tickFormatter={formatAmount} />
            <Tooltip content={<ChartAmountTooltip currency={currency} locale={i18n.language} />} />
            <Bar
              dataKey="total"
              radius={[4, 4, 0, 0]}
              onClick={(entry) => {
                const id = String(entry?.payload?.id ?? '');
                onSelectLabel(selectedLabelId === id ? null : id);
              }}
            >
              {barData.map((entry) => (
                <Cell
                  key={entry.id}
                  fill={entry.color}
                  opacity={selectedLabelId && selectedLabelId !== entry.id ? 0.45 : 1}
                  stroke={selectedLabelId === entry.id ? 'var(--foreground)' : undefined}
                  strokeWidth={selectedLabelId === entry.id ? 1 : 0}
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      {selectedLabelId && subBarData.length > 0 ? (
        <div className="min-h-[240px] rounded-md border border-border bg-background p-2">
          <p className="mb-2 text-xs text-muted-foreground">
            {t('charts.subLabelBreakdown', { label: selectedLabelName ?? '' })}
          </p>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={subBarData} margin={{ top: 8, right: 8, left: 8, bottom: 48 }}>
              <XAxis
                dataKey="name"
                tick={{ fontSize: 11 }}
                interval={0}
                angle={-25}
                textAnchor="end"
                height={60}
              />
              <YAxis tick={{ fontSize: 11 }} width={72} tickFormatter={formatAmount} />
              <Tooltip
                content={<ChartAmountTooltip currency={currency} locale={i18n.language} />}
              />
              <Bar dataKey="total" radius={[4, 4, 0, 0]}>
                {subBarData.map((entry) => (
                  <Cell key={entry.id} fill={entry.color} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      ) : null}
    </section>
  );
}
