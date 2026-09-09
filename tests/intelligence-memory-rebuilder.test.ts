import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it, vi } from 'vitest';
import {
  intelligenceMemorySeed,
  readIntelligenceMemory,
  saveIntelligenceMemory,
} from '../src/db/intelligence.js';
import { migrateDatabase } from '../src/db/migrate.js';
import {
  createReportMemoryRebuilder,
  type GenerateMemory,
  parseRebuildMemoryQuantity,
  ReportMemoryConflictError,
  resolveRebuildMemoryPeriods,
} from '../src/intelligence/memory-rebuilder.js';
import { addDaysToLocalDateKey } from '../src/intelligence/period.js';
import { resolveReportQueryScope } from '../src/intelligence/report-scope.js';
import {
  createReportTaxonomyPolicyResolver,
  type TaxonomyPolicyDecision,
} from '../src/intelligence/report-taxonomy-policy.js';
import type { ResolvedConfig, ResolvedReportConfig } from '../src/types.js';

const report: ResolvedReportConfig = {
  id: 'weekly',
  name: 'Weekly',
  schedule: { kind: 'weekly', weekday: 'monday', time: '08:00' },
  window: { kind: 'last-complete-week' },
  prompts: [],
  language: 'pt-BR',
  send: 'never',
  model: { provider: 'openai', model: 'unused-test-model' },
  agentBudget: { analystMaxSteps: 8, reviewerMaxSteps: 4, reviewerRounds: 2 },
  accountIds: [],
  includeUnannotated: true,
};

const resolved: ResolvedConfig = {
  configPath: '/tmp/memory-rebuilder-config.json',
  configHash: 'hash',
  topicId: 'memory-rebuilder',
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
      similarityThreshold: 0.82,
      pushCategoriesUpstream: false,
    },
    report: { accountIds: [], includeUnannotated: true },
    reports: [report],
    web: { publicBaseUrl: undefined },
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

function openDb(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  migrateDatabase(db);
  db.prepare(
    `INSERT INTO connections (item_id, connector_id, connector_name, status, raw_json, synced_at)
     VALUES ('item-1', '601', 'Bank', 'UPDATED', '{}', '2026-08-24T00:00:00.000Z')`,
  ).run();
  db.prepare(
    `INSERT INTO accounts (
       id, connection_item_id, type, name, balance_cents, currency, raw_json, synced_at
     ) VALUES (
       'acct-1', 'item-1', 'BANK', 'Checking', 100000, 'BRL', '{}',
       '2026-08-24T00:00:00.000Z'
     )`,
  ).run();
  return db;
}

function insertTransaction(
  db: DatabaseSync,
  input: { readonly id: string; readonly date: string; readonly amountCents: number },
): void {
  db.prepare(
    `INSERT INTO transactions (
       id, account_id, occurred_at, amount_cents, currency, description, raw_json, synced_at
     ) VALUES (?, 'acct-1', ?, ?, 'BRL', 'Merchant', '{}', '2026-08-24T00:00:00.000Z')`,
  ).run(input.id, `${input.date}T12:00:00.000Z`, input.amountCents);
}

const rebuildInput = {
  resolved,
  reportId: 'weekly',
  quantity: 'all' as const,
  now: new Date('2026-08-24T12:00:00.000Z'),
  timeZone: 'UTC',
};

describe('report memory rebuilding', () => {
  it('uses all historical calendar months by default and processes them oldest first', () => {
    expect(
      resolveRebuildMemoryPeriods(
        { start: '2026-07-01', end: '2026-07-31' },
        'last-complete-month',
        '2026-05-20',
        'all',
      ),
    ).toEqual([
      { start: '2026-05-01', end: '2026-05-31' },
      { start: '2026-06-01', end: '2026-06-30' },
      { start: '2026-07-01', end: '2026-07-31' },
    ]);
  });

  it('limits to the most recent quantity without changing chronological processing', () => {
    expect(
      resolveRebuildMemoryPeriods(
        { start: '2026-08-10', end: '2026-08-16' },
        'last-complete-week',
        '2026-01-01',
        2,
      ),
    ).toEqual([
      { start: '2026-08-03', end: '2026-08-09' },
      { start: '2026-08-10', end: '2026-08-16' },
    ]);
  });

  it('accepts all or a positive integer quantity', () => {
    expect(parseRebuildMemoryQuantity('all')).toBe('all');
    expect(parseRebuildMemoryQuantity('12')).toBe(12);
    expect(() => parseRebuildMemoryQuantity('0')).toThrow('positive integer');
  });

  it('uses at most one injected memory generation for 104 weekly periods', async () => {
    const db = openDb();
    const currentStart = '2026-08-17';
    for (let index = 0; index < 104; index += 1) {
      insertTransaction(db, {
        id: `expense-${index}`,
        date: addDaysToLocalDateKey(currentStart, index * -7),
        amountCents: -25_000,
      });
    }
    saveIntelligenceMemory(db, 'weekly', '# Old private memory', 'user');
    const generateMemory = vi.fn<GenerateMemory>(async () => ({
      memoryMarkdown: '# Memória\n\nRelação durável.',
      usage: { inputTokens: 50, outputTokens: 10, totalTokens: 60 },
    }));
    const rebuild = createReportMemoryRebuilder({
      generateMemory,
      resolveTaxonomyPolicy: async () => ({
        policy: { decisions: [] },
        source: 'generated',
        generation: {
          calls: 1,
          usage: { inputTokens: 20, outputTokens: 5, totalTokens: 25 },
        },
      }),
    });

    const result = await rebuild({ db, ...rebuildInput });

    expect(result.periods).toBe(104);
    expect(result.model).toEqual({ provider: 'openai', model: 'unused-test-model' });
    expect(result.providerCalls).toBe(2);
    expect(result.taxonomyPolicy).toEqual({
      source: 'generated',
      calls: 1,
      usage: { inputTokens: 20, outputTokens: 5, totalTokens: 25 },
    });
    expect(result.memoryGeneration).toEqual({
      calls: 1,
      usage: { inputTokens: 50, outputTokens: 10, totalTokens: 60 },
    });
    expect(result.evidence.candidateInputs).toBe(104);
    expect(generateMemory).toHaveBeenCalledOnce();
    expect(JSON.stringify(generateMemory.mock.calls[0]?.[0])).not.toContain('Old private memory');
    expect(readIntelligenceMemory(db, 'weekly').markdown).toContain('Relação durável');
  }, 15_000);

  it('writes the localized seed with zero memory generation calls when evidence is empty', async () => {
    const db = openDb();
    insertTransaction(db, { id: 'income', date: '2026-08-18', amountCents: 25_000 });
    saveIntelligenceMemory(db, 'weekly', '# Memória\n\nStale.', 'user');
    const generateMemory = vi.fn(async () => ({ memoryMarkdown: '# Unexpected' }));
    const rebuild = createReportMemoryRebuilder({ generateMemory });

    const result = await rebuild({ db, ...rebuildInput });

    expect(result.periods).toBe(1);
    expect(result.evidence.candidateInputs).toBe(0);
    expect(result.providerCalls).toBe(0);
    expect(result.taxonomyPolicy).toEqual({ source: 'empty', calls: 0 });
    expect(result.memoryGeneration).toEqual({ calls: 0 });
    expect(generateMemory).not.toHaveBeenCalled();
    expect(result.markdown).toBe(intelligenceMemorySeed('pt-BR'));
    expect(readIntelligenceMemory(db, 'weekly').markdown).toBe('# Memória');
  });

  it('preserves stored memory when generation fails', async () => {
    const db = openDb();
    insertTransaction(db, { id: 'expense', date: '2026-08-18', amountCents: -25_000 });
    saveIntelligenceMemory(db, 'weekly', '# Existing memory', 'user');
    const rebuild = createReportMemoryRebuilder({
      generateMemory: async () => {
        throw new Error('provider unavailable');
      },
    });

    await expect(rebuild({ db, ...rebuildInput })).rejects.toThrow('provider unavailable');
    expect(readIntelligenceMemory(db, 'weekly').markdown).toBe('# Existing memory');
  });

  it('preserves stored memory when generated memory fails validation', async () => {
    const db = openDb();
    insertTransaction(db, { id: 'expense', date: '2026-08-18', amountCents: -25_000 });
    saveIntelligenceMemory(db, 'weekly', '# Existing memory', 'user');
    const rebuild = createReportMemoryRebuilder({
      generateMemory: async () => ({ memoryMarkdown: '' }),
    });

    await expect(rebuild({ db, ...rebuildInput })).rejects.toThrow();
    expect(readIntelligenceMemory(db, 'weekly').markdown).toBe('# Existing memory');
  });

  it('rejects a concurrent memory edit without overwriting it', async () => {
    const db = openDb();
    insertTransaction(db, { id: 'expense', date: '2026-08-18', amountCents: -25_000 });
    saveIntelligenceMemory(db, 'weekly', '# Existing memory', 'user');
    const rebuild = createReportMemoryRebuilder({
      generateMemory: async () => {
        saveIntelligenceMemory(db, 'weekly', '# Concurrent edit', 'user');
        return { memoryMarkdown: '# Generated memory' };
      },
    });

    await expect(rebuild({ db, ...rebuildInput })).rejects.toBeInstanceOf(
      ReportMemoryConflictError,
    );
    expect(readIntelligenceMemory(db, 'weekly').markdown).toBe('# Concurrent edit');
  });

  it('reports one cold taxonomy generation and then a cache hit', async () => {
    const db = openDb();
    db.prepare(
      `INSERT INTO annotation_categories (id, name, parent_id, created_at)
       VALUES ('expenses', 'Expenses', NULL, '2026-01-01T00:00:00.000Z')`,
    ).run();
    const scope = resolveReportQueryScope(resolved, 'weekly', {
      timeZone: 'UTC',
      period: { start: '2026-08-17', end: '2026-08-23' },
    });
    const generatePolicy = vi.fn(
      async ({
        items,
      }: {
        readonly items: readonly Pick<TaxonomyPolicyDecision, 'kind' | 'id' | 'path'>[];
      }) => ({
        decisions: items.map((item) => ({
          kind: item.kind,
          id: item.id,
          treatment: 'reportable' as const,
          confidence: 1,
          reason: 'Test policy.',
        })),
        usage: { inputTokens: 30, outputTokens: 10, totalTokens: 40 },
      }),
    );
    const resolvePolicy = createReportTaxonomyPolicyResolver({ generatePolicy });

    const generated = await resolvePolicy({ db, scope, persist: true });
    const cached = await resolvePolicy({ db, scope, persist: true });

    expect(generated).toMatchObject({
      source: 'generated',
      generation: {
        calls: 1,
        usage: { inputTokens: 30, outputTokens: 10, totalTokens: 40 },
      },
    });
    expect(cached).toMatchObject({ source: 'cache', generation: { calls: 0 } });
    expect(generatePolicy).toHaveBeenCalledOnce();
  });
});
