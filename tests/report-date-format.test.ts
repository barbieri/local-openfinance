import { describe, expect, it } from 'vitest';
import {
  formatReportDate,
  parseReportDate,
  reportDateStyleInstruction,
  resolveReportDateStyle,
} from '../src/intelligence/report-date-format.js';

describe('report date style', () => {
  it.each([
    ['last-complete-day', 'iso'],
    ['last-complete-week', 'weekly'],
    ['last-complete-month', 'monthly'],
  ] as const)('resolves %s to %s', (windowKind, expectedStyle) => {
    expect(resolveReportDateStyle(windowKind)).toBe(expectedStyle);
  });

  it('does not silently accept an unsupported window', () => {
    expect(() => resolveReportDateStyle('future-window' as never)).toThrow(
      'Unsupported report window: future-window',
    );
  });

  it.each([
    ['weekly', 'DD/MM (weekday)'],
    ['monthly', 'DD'],
    ['iso', 'ISO'],
  ] as const)('describes the %s style used by prompts and rendering', (style, text) => {
    expect(reportDateStyleInstruction(style)).toContain(text);
  });

  it.each(['2026-02-29', '18/08', '2026-8-18'])('rejects non-ISO report dates: %s', (date) => {
    expect(parseReportDate(date)).toBeNull();
  });

  it('parses a real ISO report date for shared validation and formatting', () => {
    expect(parseReportDate('2026-08-18')).toBeInstanceOf(Date);
    expect(formatReportDate('2026-08-18', 'weekly')).toBe('18/08 (ter)');
  });
});
