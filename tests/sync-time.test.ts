import { describe, expect, it } from 'vitest';
import { formatRelativeOrAbsoluteDate } from '../src/web/client/lib/format-relative-date.js';

describe('formatRelativeOrAbsoluteDate', () => {
  const now = Date.parse('2026-06-10T12:00:00.000Z');

  it('returns relative labels within seven days', () => {
    expect(formatRelativeOrAbsoluteDate('2026-06-10T11:00:00.000Z', 'en-US', now)).toMatch(/hour/i);
  });

  it('returns an absolute date after seven days', () => {
    const formatted = formatRelativeOrAbsoluteDate('2026-05-01T12:00:00.000Z', 'en-US', now);
    expect(formatted).toContain('2026');
    expect(formatted).not.toMatch(/hour/i);
  });
});
