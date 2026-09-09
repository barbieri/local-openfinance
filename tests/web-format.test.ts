import { describe, expect, it } from 'vitest';
import {
  formatCurrencyAmount,
  formatLocalDate,
  formatLocalDateTime,
} from '../src/web/client/lib/format.js';

describe('web format helpers', () => {
  it('formats local dates like FormattedDate', () => {
    expect(formatLocalDate('2026-03-15', 'en-US')).toMatch(/Mar 15, 2026/);
    expect(formatLocalDate('2026-03-15', 'pt-BR')).toMatch(/15 de mar\. de 2026/);
    expect(formatLocalDate(null, 'en-US')).toBe('—');
  });

  it('formats local date-times from ISO timestamps', () => {
    expect(formatLocalDateTime('2026-03-15T14:30:00.000-03:00', 'en-US')).toMatch(/Mar 15, 2026/);
    expect(formatLocalDateTime('2026-03-15T14:30:00.000-03:00', 'en-US')).toMatch(/2:30/);
    expect(formatLocalDateTime(null, 'en-US')).toBe('—');
  });

  it('formats currency amounts with locale and optional sign', () => {
    expect(formatCurrencyAmount(12345, 'BRL', 'pt-BR')).toMatch(/123,45/);
    expect(formatCurrencyAmount(-500, 'BRL', 'en-US', { signed: true })).toMatch(/^-/);
    expect(formatCurrencyAmount(500, 'BRL', 'en-US', { signed: true })).toMatch(/^\+/);
  });
});
