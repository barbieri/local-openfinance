import type { TFunction } from 'i18next';
import { createElement } from 'react';

export type ReportChart = {
  readonly name: string;
  readonly mimeType: string;
  readonly dataUrl: string;
};

export function ReportCharts({
  charts,
  t,
}: {
  readonly charts: readonly ReportChart[];
  readonly t: TFunction;
}) {
  if (charts.length === 0) return null;
  return createElement(
    'div',
    { className: 'grid gap-3' },
    charts.map((chart) =>
      createElement('img', {
        key: chart.name,
        className: 'w-full rounded border border-border',
        src: chart.dataUrl,
        alt: t(`reports.chart.${chart.name}`),
      }),
    ),
  );
}
