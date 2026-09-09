import { use, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { formatCurrencyAmount, formatLocalDate } from '../../lib/format.js';
import { rechartsModule } from './recharts-module.js';

type BillPoint = {
  readonly due_date: string;
  readonly total_amount_cents: number;
};

export function CreditCardBillsChart({ bills }: { readonly bills: readonly BillPoint[] }) {
  const {
    CartesianGrid,
    Line,
    LineChart,
    ReferenceLine,
    ResponsiveContainer,
    Tooltip,
    XAxis,
    YAxis,
  } = use(rechartsModule);
  const { t, i18n } = useTranslation();
  const currency = 'BRL';

  const { chartData, average } = useMemo(() => {
    const sorted = bills
      .toSorted((a, b) => String(a.due_date).localeCompare(String(b.due_date)))
      .slice(-12);
    const points = sorted.map((bill) => ({
      dueDate: String(bill.due_date).slice(0, 10),
      total: Number(bill.total_amount_cents ?? 0),
    }));
    const avg =
      points.length > 0 ? points.reduce((sum, point) => sum + point.total, 0) / points.length : 0;
    return { chartData: points, average: avg };
  }, [bills]);

  const formatAmount = (amountCents: number) =>
    formatCurrencyAmount(amountCents, currency, i18n.language);

  if (chartData.length === 0) {
    return null;
  }

  return (
    <section className="mb-3 rounded-md border border-border bg-muted/20 p-3">
      <h4 className="mb-2 text-sm font-medium">{t('charts.billHistory')}</h4>
      <ResponsiveContainer width="100%" height={200}>
        <LineChart data={chartData}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
          <XAxis
            dataKey="dueDate"
            tick={{ fontSize: 11 }}
            tickFormatter={(value) => formatLocalDate(String(value), i18n.language)}
          />
          <YAxis
            tick={{ fontSize: 11 }}
            width={72}
            tickFormatter={(value) => formatAmount(Number(value))}
          />
          <Tooltip
            labelFormatter={(label) => formatLocalDate(String(label), i18n.language)}
            formatter={(value) => {
              if (typeof value !== 'number') {
                return String(value ?? '');
              }
              return formatAmount(value);
            }}
          />
          <ReferenceLine
            y={average}
            stroke="var(--muted-foreground)"
            strokeDasharray="5 5"
            label={{ value: t('charts.average'), position: 'insideTopRight', fontSize: 11 }}
          />
          <Line type="monotone" dataKey="total" stroke="var(--primary)" strokeWidth={2} dot />
        </LineChart>
      </ResponsiveContainer>
    </section>
  );
}
