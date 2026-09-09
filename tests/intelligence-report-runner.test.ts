import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it, vi } from 'vitest';
import {
  getIntelligenceRun,
  getIntelligenceRunByDueKey,
  listIntelligenceRunChartNames,
  listIntelligenceRunModelCalls,
  listIntelligenceRuns,
  readIntelligenceMemory,
} from '../src/db/intelligence.js';
import { migrateDatabase } from '../src/db/migrate.js';
import {
  DueReportAlreadyRunError,
  executeReport,
  type GenerateReportWithAgent,
  previewReportRegeneration,
  ReportMemoryConflictError,
  saveReportRegeneration,
} from '../src/intelligence/report-runner.js';
import { defaultBaseInstructionsReference } from '../src/llm/default-prompts.js';
import type { ResolvedConfig, ResolvedReportConfig } from '../src/types.js';

const report: ResolvedReportConfig = {
  id: 'weekly',
  name: 'Weekly',
  schedule: { kind: 'weekly', weekday: 'monday', time: '08:00' },
  window: { kind: 'last-complete-week' },
  prompts: [defaultBaseInstructionsReference],
  language: 'pt-BR',
  send: 'never',
  model: {
    provider: 'openai',
    model: 'unused-test-model',
    pricing: { input: 1, cachedInput: 0.5, output: 2 },
  },
  agentBudget: { analystMaxSteps: 8, reviewerMaxSteps: 4, reviewerRounds: 2 },
  accountIds: [],
  includeUnannotated: true,
};

const resolved: ResolvedConfig = {
  configPath: '/tmp/report-runner-config.json',
  configHash: 'hash',
  topicId: 'report-runner',
  config: {
    storage: { databasePath: ':memory:' },
    sync: {
      forceBeforeFetch: false,
      forceUpsert: false,
      connections: [],
      lookbackDays: 7,
      pageSize: 100,
    },
    annotation: {
      embedding: undefined,
      classifier: undefined,
      similarityThreshold: 0.8,
      pushCategoriesUpstream: false,
    },
    report: {
      accountIds: [],
      includeUnannotated: true,
    },
    reports: [report],
    web: { publicBaseUrl: 'https://finance.example' },
    intelligence: {
      suggestionConfidenceThreshold: 0.82,
      minReportedItemAmountCents: 10_000,
      rareLookbackYears: 3,
    },
    chatModel: undefined,
    notify: { smtp: undefined },
    model: report.model,
  },
};

const generateReport: GenerateReportWithAgent = async () => ({
  subject: 'Weekly report',
  markdown: 'Finding Purchase Plain permalink Already qualified',
  html: '<section class="report-findings"><h2>Finding</h2><p><a href="#/transaction/tx-1">Purchase</a></p><p><a href="#/transaction/tx-2">Plain transaction</a></p><p>Already qualified: <a href="https://archive.example/#/transaction/tx-3">archive</a></p><script>alert(1)</script><img src="https://attacker.test/pixel"></section>',
  memoryAfter: '# Household\n\nStable.\n',
  modelCalls: [
    {
      provider: 'openai',
      model: 'unused-test-model',
      phase: 'analyst',
      reviewRound: null,
      stepNumber: 0,
      usage: {
        inputTokens: 100,
        cachedInputTokens: 20,
        outputTokens: 10,
        reasoningTokens: 5,
        totalTokens: 110,
      },
      durationMs: 12,
      reasoningEffort: 'low',
      maxOutputTokens: 8_000,
      finishReason: 'stop',
      toolNames: ['briefing'],
      providerMetadata: { openai: { responseId: 'response-test' } },
    },
  ],
});

function openDb(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  migrateDatabase(db);
  db.prepare(
    `INSERT INTO connections (item_id, connector_id, connector_name, status, raw_json, synced_at)
     VALUES ('item-1', '601', 'Bank', 'UPDATED', '{}', '2026-08-17T00:00:00.000Z')`,
  ).run();
  db.prepare(
    `INSERT INTO accounts (
       id, connection_item_id, type, name, balance_cents, currency, raw_json, synced_at
     ) VALUES (
       'acct-1', 'item-1', 'BANK', 'Checking', 100000, 'BRL', '{}',
       '2026-08-17T00:00:00.000Z'
     )`,
  ).run();
  db.prepare(
    `INSERT INTO transactions (
       id, account_id, occurred_at, amount_cents, currency, description, raw_json, synced_at
     ) VALUES (
       'tx-1', 'acct-1', '2026-08-12T12:00:00.000Z', -25000, 'BRL',
       'Purchase', '{}', '2026-08-17T00:00:00.000Z'
     )`,
  ).run();
  return db;
}

describe('report runner', () => {
  it('persists one atomic due run with scoped charts, sanitized HTML, citations, and memory', async () => {
    const db = openDb();
    const result = await executeReport(
      {
        db,
        resolved,
        reportId: 'weekly',
        period: { start: '2026-08-10', end: '2026-08-16' },
        timeZone: 'UTC',
        triggerKind: 'due',
        dueKey: 'weekly:2026-08-17',
        send: false,
        dryRun: false,
      },
      generateReport,
    );

    expect(result.run).toMatchObject({
      reportId: 'weekly',
      triggerKind: 'due',
      dueKey: 'weekly:2026-08-17',
      alertCount: result.alertCount,
    });
    expect(result.html).toContain('https://finance.example/#/transaction/tx-1');
    expect(result.html).toContain(
      '<a href="https://finance.example/#/transaction/tx-2">Plain transaction</a>',
    );
    expect(result.html).not.toContain('https://archive.example/#/transaction/tx-3');
    expect(result.html).toContain('<span>archive</span>');
    expect(result.html).not.toContain('https://archive.example/https://finance.example');
    expect(result.html).not.toContain('<script');
    expect(result.html).not.toContain('<img');
    expect(result.html).not.toContain('attacker.test');
    expect(JSON.parse(result.run?.citedTransactionIdsJson ?? '[]')).toContain('tx-1');
    expect(listIntelligenceRunChartNames(db, result.run?.id ?? '')).toEqual([
      'cashflow',
      'categories',
      'labels',
    ]);
    expect(readIntelligenceMemory(db, 'weekly').markdown).toContain('Stable');
    expect(getIntelligenceRunByDueKey(db, 'weekly', 'weekly:2026-08-17')?.id).toBe(result.run?.id);
    expect(result.usage).toEqual({
      callCount: 1,
      stepCount: 1,
      inputTokens: 100,
      cachedInputTokens: 20,
      outputTokens: 10,
      reasoningTokens: 5,
      totalTokens: 110,
      durationMs: 12,
      unpricedCallCount: 0,
      estimatedCostMicrousd: 110,
    });
    expect(listIntelligenceRunModelCalls(db, result.run?.id ?? '')).toMatchObject([
      {
        phase: 'analyst',
        finishReason: 'stop',
        toolNamesJson: '["briefing"]',
        estimatedCostMicrousd: 110,
      },
    ]);
  });

  it('does not write runs, charts, or memory during dry-run', async () => {
    const db = openDb();
    const result = await executeReport(
      {
        db,
        resolved,
        reportId: 'weekly',
        period: { start: '2026-08-10', end: '2026-08-16' },
        timeZone: 'UTC',
        triggerKind: 'manual',
        send: false,
        dryRun: true,
      },
      generateReport,
    );

    expect(result.run).toBeNull();
    expect(result.charts).toHaveLength(3);
    expect(listIntelligenceRuns(db, 'weekly')).toHaveLength(0);
    expect(
      db.prepare('SELECT COUNT(*) AS count FROM intelligence_run_model_calls').get()?.['count'],
    ).toBe(0);
    expect(db.prepare(`SELECT COUNT(*) AS count FROM intelligence_memory`).get()?.['count']).toBe(
      0,
    );
  });

  it('replaces a selected run from an ephemeral regeneration preview without changing memory', async () => {
    const db = openDb();
    const initial = await executeReport(
      {
        db,
        resolved,
        reportId: 'weekly',
        period: { start: '2026-08-10', end: '2026-08-16' },
        timeZone: 'UTC',
        triggerKind: 'manual',
        send: false,
        dryRun: false,
      },
      generateReport,
    );
    const stored = initial.run;
    expect(stored).not.toBeNull();
    if (!stored) {
      throw new Error('Expected initial report run');
    }

    const preview = await previewReportRegeneration(
      { db, resolved, reportId: 'weekly', run: stored },
      async ({ memoryBefore }) => ({
        subject: 'Regenerated report',
        markdown: 'Replacement report.',
        html: '<p>Replacement report.</p>',
        memoryAfter: `${memoryBefore}\n\nWould change only if a normal report run persisted it.`,
        modelCalls: [],
      }),
    );
    expect(listIntelligenceRuns(db, 'weekly')).toHaveLength(1);
    expect(readIntelligenceMemory(db, 'weekly').markdown).toContain('Stable');

    const replaced = saveReportRegeneration(db, preview);
    expect(replaced).toMatchObject({ id: stored.id, version: stored.version + 1 });
    expect(getIntelligenceRun(db, 'weekly', stored.id)?.subject).toBe('Regenerated report');
    expect(listIntelligenceRuns(db, 'weekly')).toHaveLength(1);
    expect(listIntelligenceRunModelCalls(db, stored.id)).toEqual([]);
    expect(readIntelligenceMemory(db, 'weekly').markdown).toContain('Stable');
    expect(readIntelligenceMemory(db, 'weekly').markdown).not.toContain('Would change');
  });

  it('removes terminal and header control bytes from the generated subject before persistence', async () => {
    const db = openDb();
    const result = await executeReport(
      {
        db,
        resolved,
        reportId: 'weekly',
        period: { start: '2026-08-10', end: '2026-08-16' },
        timeZone: 'UTC',
        triggerKind: 'manual',
        send: false,
        dryRun: false,
      },
      async () => ({
        subject: 'Weekly\u001B]8;;https://attacker.test\u0007 report\r\nInjected',
        markdown: '# Weekly',
        html: '<p>Weekly</p>',
        memoryAfter: '# Household\n',
        modelCalls: [],
      }),
    );

    expect(result.subject).toBe('Weekly report Injected');
    expect(result.run?.subject).toBe('Weekly report Injected');
  });

  it('rejects plain-text transaction permalinks before persistence', async () => {
    const db = openDb();

    await expect(
      executeReport(
        {
          db,
          resolved,
          reportId: 'weekly',
          period: { start: '2026-08-10', end: '2026-08-16' },
          timeZone: 'UTC',
          triggerKind: 'manual',
          send: false,
          dryRun: false,
        },
        async () => ({
          subject: 'Weekly report',
          markdown: '# Weekly',
          html: '<p>Plain permalink: #/transaction/tx-2</p>',
          memoryAfter: '# Household\n',
          modelCalls: [],
        }),
      ),
    ).rejects.toThrow('Report transaction permalinks must use semantic anchors.');
    expect(listIntelligenceRuns(db, 'weekly')).toHaveLength(0);
  });

  it('rejects a repeated due key before generating again', async () => {
    const db = openDb();
    const input = {
      db,
      resolved,
      reportId: 'weekly',
      period: { start: '2026-08-10', end: '2026-08-16' },
      timeZone: 'UTC',
      triggerKind: 'due' as const,
      dueKey: 'weekly:2026-08-17',
      send: false,
      dryRun: false,
    };
    await executeReport(input, generateReport);

    await expect(executeReport(input, generateReport)).rejects.toBeInstanceOf(
      DueReportAlreadyRunError,
    );
  });

  it('persists malformed encoded permalink ids without failing the completed report', async () => {
    const db = openDb();
    const result = await executeReport(
      {
        db,
        resolved,
        reportId: 'weekly',
        period: { start: '2026-08-10', end: '2026-08-16' },
        timeZone: 'UTC',
        triggerKind: 'manual',
        send: false,
        dryRun: false,
      },
      async () => ({
        subject: 'Weekly report',
        markdown: '[Purchase](#/transaction/bad%id)',
        html: '<p><a href="#/transaction/bad%id">Purchase</a></p>',
        memoryAfter: '# Household\n',
        modelCalls: [],
      }),
    );

    expect(JSON.parse(result.run?.citedTransactionIdsJson ?? '[]')).toContain('bad%id');
  });

  it('retries delivery from a persisted due run without regenerating the report', async () => {
    const db = openDb();
    const sendReport = { ...report, send: 'always' as const };
    const sendResolved = { ...resolved, config: { ...resolved.config, reports: [sendReport] } };
    const generator = vi.fn(generateReport);
    const failingDelivery = vi.fn(async () => {
      throw new Error('SMTP unavailable');
    });
    const input = {
      db,
      resolved: sendResolved,
      reportId: 'weekly',
      period: { start: '2026-08-10', end: '2026-08-16' },
      timeZone: 'UTC',
      triggerKind: 'due' as const,
      dueKey: 'weekly:2026-08-17',
      send: true,
      dryRun: false,
    };

    await expect(executeReport(input, generator, failingDelivery)).rejects.toThrow(
      'SMTP unavailable',
    );
    expect(listIntelligenceRuns(db, 'weekly')).toHaveLength(1);
    expect(getIntelligenceRunByDueKey(db, 'weekly', input.dueKey)).toMatchObject({
      emailDeliveryStartedAt: null,
      emailSentAt: null,
    });

    const successfulDelivery = vi.fn(async () => ({ sent: true, message: {} }));
    const retried = await executeReport(input, generator, successfulDelivery);

    expect(generator).toHaveBeenCalledOnce();
    expect(successfulDelivery).toHaveBeenCalledOnce();
    expect(retried.emailSent).toBe(true);
    expect(retried.run?.emailSentAt).not.toBeNull();
    expect(retried.usage).toMatchObject({
      callCount: 1,
      inputTokens: 100,
      estimatedCostMicrousd: 110,
    });
    expect(listIntelligenceRuns(db, 'weekly')).toHaveLength(1);
  });

  it('rejects a stale concurrent memory update instead of overwriting it', async () => {
    const db = openDb();
    let entered = 0;
    let releaseBarrier: () => void = () => undefined;
    const barrier = new Promise<void>((resolve) => {
      releaseBarrier = resolve;
    });
    const concurrentGenerator: GenerateReportWithAgent = async ({ memoryBefore }) => {
      entered += 1;
      const sequence = entered;
      if (entered === 2) {
        releaseBarrier();
      }
      await barrier;
      return {
        subject: `Concurrent ${sequence}`,
        markdown: `Run ${sequence}`,
        html: `<p>Run ${sequence}</p>`,
        memoryAfter: `${memoryBefore}\nRun ${sequence}`,
        modelCalls: [],
      };
    };
    const input = {
      db,
      resolved,
      reportId: 'weekly',
      period: { start: '2026-08-10', end: '2026-08-16' },
      timeZone: 'UTC',
      triggerKind: 'manual' as const,
      send: false,
      dryRun: false,
    };

    const results = await Promise.allSettled([
      executeReport(input, concurrentGenerator),
      executeReport(input, concurrentGenerator),
    ]);

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((result) => result.status === 'rejected');
    expect(rejected).toMatchObject({ reason: expect.any(ReportMemoryConflictError) });
    const [stored] = listIntelligenceRuns(db, 'weekly');
    expect(stored?.memoryBefore).toBe(
      readIntelligenceMemory(db, 'weekly').markdown.replace(/\nRun \d$/u, ''),
    );
    expect(stored?.memoryAfter).toBe(readIntelligenceMemory(db, 'weekly').markdown);
  });

  it('claims one persisted due delivery across overlapping retries', async () => {
    const db = openDb();
    const sendReport = { ...report, send: 'always' as const };
    const sendResolved = { ...resolved, config: { ...resolved.config, reports: [sendReport] } };
    const input = {
      db,
      resolved: sendResolved,
      reportId: 'weekly',
      period: { start: '2026-08-10', end: '2026-08-16' },
      timeZone: 'UTC',
      triggerKind: 'due' as const,
      dueKey: 'weekly:2026-08-17',
      send: false,
      dryRun: false,
    };
    await executeReport(input, generateReport);
    const delivery = vi.fn(async () => ({ sent: true, message: {} }));
    const shouldNotGenerate = vi.fn(generateReport);

    const results = await Promise.allSettled([
      executeReport({ ...input, send: true }, shouldNotGenerate, delivery),
      executeReport({ ...input, send: true }, shouldNotGenerate, delivery),
    ]);

    expect(delivery).toHaveBeenCalledOnce();
    expect(shouldNotGenerate).not.toHaveBeenCalled();
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.find((result) => result.status === 'rejected')).toMatchObject({
      reason: expect.any(DueReportAlreadyRunError),
    });
    expect(getIntelligenceRunByDueKey(db, 'weekly', input.dueKey)).toMatchObject({
      emailDeliveryStartedAt: null,
      emailSentAt: expect.any(String),
    });
  });
});
