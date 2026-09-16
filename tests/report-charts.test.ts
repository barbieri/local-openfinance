import type { TFunction } from 'i18next';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { type ReportChart, ReportCharts } from '../src/web/client/components/ReportCharts.js';

const t = ((key: string) => key) as TFunction;

describe('report charts UI', () => {
  it('renders investment chart data URLs as localized images', () => {
    const charts: readonly ReportChart[] = [
      {
        name: 'investments-type',
        mimeType: 'image/png',
        dataUrl: 'data:image/png;base64,type-chart',
      },
      {
        name: 'investments-code',
        mimeType: 'image/png',
        dataUrl: 'data:image/png;base64,code-chart',
      },
    ];

    const html = renderToStaticMarkup(createElement(ReportCharts, { charts, t }));

    expect(html).toContain('<img');
    expect(html).toContain('src="data:image/png;base64,type-chart"');
    expect(html).toContain('alt="reports.chart.investments-type"');
    expect(html).toContain('src="data:image/png;base64,code-chart"');
    expect(html).toContain('alt="reports.chart.investments-code"');
  });

  it('renders no markup when there are no charts', () => {
    expect(renderToStaticMarkup(createElement(ReportCharts, { charts: [], t }))).toBe('');
  });
});
