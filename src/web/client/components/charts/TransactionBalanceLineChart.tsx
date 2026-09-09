import { use } from 'react';
import { useTranslation } from 'react-i18next';
import type {
  TransactionChartBalanceSection,
  TransactionChartBalanceWarning,
} from '../../../../db/transaction-charts.js';
import { formatCurrencyAmount, formatLocalDate } from '../../lib/format.js';
import { rechartsModule } from './recharts-module.js';

const balanceWarningClassName =
  'rounded-md border border-border bg-muted px-3 py-2 text-sm text-foreground';

function formatBalanceWarningMessage(
  warning: TransactionChartBalanceWarning,
  t: (key: string, options?: Record<string, unknown>) => string,
): string {
  switch (warning.code) {
    case 'limited_history': {
      const match = /before (\d{4}-\d{2}-\d{2})/u.exec(warning.message);
      const date = match?.[1] ?? warning.message;
      return t('charts.balanceWarningLimitedHistory', { date });
    }
    case 'no_bank_accounts':
      return t('charts.balanceWarningNoBankAccounts');
    case 'mixed_currencies':
      return t('charts.balanceWarningMixedCurrencies');
  }
}

export function TransactionBalanceLineChart({
  data,
  currency,
  ignoresNonScopeFilters = false,
}: {
  readonly data: TransactionChartBalanceSection;
  readonly currency: string;
  readonly ignoresNonScopeFilters?: boolean;
}) {
  const { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } = use(rechartsModule);
  const { t, i18n } = useTranslation();

  const formatAmount = (amountCents: number, signed = false) =>
    formatCurrencyAmount(amountCents, currency, i18n.language, { signed });

  const hasEstimatedPoints = data.dailyBalance.some((point) => point.isEstimated);
  const warnings = data.warnings ?? [];

  if (data.dailyBalance.length === 0) {
    return (
      <section className="space-y-2">
        {warnings.map((warning) => (
          <p key={warning.code} className={balanceWarningClassName}>
            {formatBalanceWarningMessage(warning, t)}
          </p>
        ))}
        {warnings.length === 0 && (
          <p className="text-sm text-muted-foreground">{t('charts.noData')}</p>
        )}
      </section>
    );
  }

  return (
    <section className="space-y-2">
      <p className="text-sm text-muted-foreground">{t('charts.dayCount', { count: data.total })}</p>
      {ignoresNonScopeFilters && (
        <p className="text-sm text-muted-foreground">{t('charts.balanceIgnoresFilters')}</p>
      )}
      {hasEstimatedPoints && (
        <p className={balanceWarningClassName}>{t('charts.balanceEstimated')}</p>
      )}
      {warnings.map((warning) => (
        <p key={warning.code} className={balanceWarningClassName}>
          {formatBalanceWarningMessage(warning, t)}
        </p>
      ))}
      <ResponsiveContainer width="100%" height={240}>
        <LineChart data={data.dailyBalance}>
          <XAxis
            dataKey="date"
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
              return formatAmount(value, true);
            }}
          />
          <Line
            type="monotone"
            dataKey="balance"
            name={t('charts.dailyBalance')}
            stroke="var(--primary)"
            dot={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </section>
  );
}
