import { describe, expect, it } from 'vitest';
import { resolveDueReports } from '../src/intelligence/schedule.js';
import type { ResolvedReportConfig } from '../src/types.js';

function report(id: string, schedule: ResolvedReportConfig['schedule']): ResolvedReportConfig {
  return {
    id,
    name: id,
    schedule,
    window: { kind: 'last-complete-day' },
    prompts: ['prompt.md'],
    language: 'pt-BR',
    send: 'never',
    model: { provider: 'openai', model: 'test' },
    agentBudget: { analystMaxSteps: 8, reviewerMaxSteps: 4, reviewerRounds: 2 },
    accountIds: [],
    includeUnannotated: true,
  };
}

describe('report due schedules', () => {
  it('waits for local time and excludes manual reports', () => {
    const reports = [
      report('daily', { kind: 'daily', time: '08:00' }),
      report('manual', { kind: 'manual' }),
    ];
    expect(
      resolveDueReports(reports, new Date('2026-08-23T10:59:00.000Z'), 'America/Sao_Paulo'),
    ).toHaveLength(0);
    expect(
      resolveDueReports(reports, new Date('2026-08-23T11:00:00.000Z'), 'America/Sao_Paulo'),
    ).toMatchObject([{ report: { id: 'daily' }, dueKey: 'daily:2026-08-23' }]);
  });

  it('matches weekly local weekdays and monthly last day', () => {
    const reports = [
      report('weekly', { kind: 'weekly', weekday: 'monday', time: '08:00' }),
      report('month-end', { kind: 'monthly', day: 'last', time: '07:00' }),
    ];
    expect(resolveDueReports(reports, new Date('2026-08-31T12:00:00.000Z'), 'UTC')).toEqual([
      { report: reports[0], dueKey: 'weekly:2026-08-31' },
      { report: reports[1], dueKey: 'monthly:2026-08-31' },
    ]);
  });

  it('does not backfill weekly or monthly schedules after their local date', () => {
    const reports = [
      report('weekly', { kind: 'weekly', weekday: 'monday', time: '08:00' }),
      report('month-end', { kind: 'monthly', day: 'last', time: '07:00' }),
    ];

    expect(resolveDueReports(reports, new Date('2026-09-01T12:00:00.000Z'), 'UTC')).toEqual([]);
  });
});
