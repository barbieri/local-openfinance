import { use, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { ChartBucket } from '../../../../chart/transaction-aggregates.js';
import { toPieData } from './allocation-chart-data.js';
import { ChartAmountTooltip } from './ChartAmountTooltip.js';
import { rechartsModule } from './recharts-module.js';

export function CategoryAllocationCharts({
  buckets,
  subBuckets,
  selectedCategoryId,
  selectedCategoryName,
  currency,
  onSelectCategory,
}: {
  readonly buckets: readonly ChartBucket[];
  readonly subBuckets: readonly ChartBucket[];
  readonly selectedCategoryId: string | null;
  readonly selectedCategoryName: string | null;
  readonly currency: string;
  readonly onSelectCategory: (categoryId: string | null) => void;
}) {
  const { Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip } = use(rechartsModule);
  const { t, i18n } = useTranslation();
  const pieData = useMemo(() => toPieData(buckets), [buckets]);
  const subPieData = useMemo(() => toPieData(subBuckets), [subBuckets]);

  if (pieData.length === 0) {
    return null;
  }

  return (
    <section className="space-y-2">
      <h4 className="text-sm font-medium">{t('charts.byCategory')}</h4>
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="min-h-[240px] rounded-md border border-border bg-background p-2">
          <ResponsiveContainer width="100%" height={240}>
            <PieChart>
              <Pie
                data={pieData}
                dataKey="value"
                nameKey="name"
                innerRadius={48}
                outerRadius={88}
                paddingAngle={1}
                onClick={(entry) => {
                  const id = String(entry?.payload?.id ?? '');
                  onSelectCategory(selectedCategoryId === id ? null : id);
                }}
              >
                {pieData.map((entry) => (
                  <Cell
                    key={entry.id}
                    fill={entry.color}
                    stroke="var(--background)"
                    strokeWidth={selectedCategoryId === entry.id ? 3 : 1}
                    opacity={selectedCategoryId && selectedCategoryId !== entry.id ? 0.45 : 1}
                  />
                ))}
              </Pie>
              <Tooltip
                content={<ChartAmountTooltip currency={currency} locale={i18n.language} />}
              />
              <Legend />
            </PieChart>
          </ResponsiveContainer>
        </div>

        {selectedCategoryId && subPieData.length > 0 ? (
          <div className="min-h-[240px] rounded-md border border-border bg-background p-2">
            <p className="mb-2 text-xs text-muted-foreground">
              {t('charts.subcategoryBreakdown', { category: selectedCategoryName ?? '' })}
            </p>
            <ResponsiveContainer width="100%" height={220}>
              <PieChart>
                <Pie data={subPieData} dataKey="value" nameKey="name" outerRadius={88}>
                  {subPieData.map((entry) => (
                    <Cell key={entry.id} fill={entry.color} stroke="var(--background)" />
                  ))}
                </Pie>
                <Tooltip
                  content={<ChartAmountTooltip currency={currency} locale={i18n.language} />}
                />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <div className="flex min-h-[240px] items-center justify-center rounded-md border border-dashed border-border px-4 text-sm text-muted-foreground">
            {t('charts.selectCategoryHint')}
          </div>
        )}
      </div>
    </section>
  );
}
