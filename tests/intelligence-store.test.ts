import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import {
  adoptLegacyIntelligenceReport,
  claimIntelligenceRunEmailDelivery,
  getIntelligenceMemory,
  getIntelligenceRun,
  getIntelligenceRunByDueKey,
  INTELLIGENCE_MEMORY_SEED,
  insertIntelligenceRun,
  intelligenceMemorySeed,
  listIntelligenceRunChartNames,
  listIntelligenceRunModelCalls,
  listIntelligenceRuns,
  readIntelligenceTaxonomyPolicy,
  releaseIntelligenceRunEmailDelivery,
  saveIntelligenceMemory,
  saveIntelligenceRunChart,
  saveIntelligenceRunModelCall,
  saveIntelligenceTaxonomyPolicy,
} from '../src/db/intelligence.js';
import { migrateDatabase } from '../src/db/migrate.js';

describe('intelligence store', () => {
  it('rolls back a failed migration together with its schema marker', () => {
    const db = new DatabaseSync(':memory:');
    db.exec(`
      CREATE TABLE schema_migrations (
        version INTEGER PRIMARY KEY,
        applied_at TEXT NOT NULL
      );
      CREATE TABLE intelligence_memory (
        id TEXT PRIMARY KEY CHECK (id = 'default'),
        markdown TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        updated_by TEXT NOT NULL
      );
      CREATE TABLE intelligence_runs (
        id TEXT PRIMARY KEY,
        period_start TEXT NOT NULL,
        period_end TEXT NOT NULL,
        created_at TEXT NOT NULL,
        subject TEXT NOT NULL,
        alert_count INTEGER NOT NULL,
        briefing_json TEXT NOT NULL,
        markdown TEXT NOT NULL,
        memory_before TEXT,
        memory_after TEXT,
        cited_transaction_ids_json TEXT NOT NULL
      );
      CREATE TABLE intelligence_run_charts (
        run_id TEXT NOT NULL REFERENCES intelligence_runs(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        mime_type TEXT NOT NULL,
        bytes BLOB NOT NULL,
        PRIMARY KEY (run_id, name)
      );
    `);
    const markApplied = db.prepare(
      `INSERT INTO schema_migrations (version, applied_at) VALUES (?, '2026-08-23T00:00:00Z')`,
    );
    for (let version = 1; version < 25; version += 1) {
      markApplied.run(version);
    }

    expect(() => migrateDatabase(db)).toThrow();
    const tables = db
      .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name`)
      .all()
      .map((row) => String(row['name']));
    expect(tables).toContain('intelligence_memory');
    expect(tables).toContain('intelligence_runs');
    expect(tables).toContain('intelligence_run_charts');
    expect(tables).not.toContain('intelligence_memory_legacy');
    expect(tables).not.toContain('intelligence_runs_legacy');
    expect(
      db.prepare('SELECT COUNT(*) AS count FROM schema_migrations WHERE version = 25').get()?.[
        'count'
      ],
    ).toBe(0);
  });

  it('applies intelligence migration and seeds memory on first read', () => {
    const db = new DatabaseSync(':memory:');
    expect(migrateDatabase(db)).toContain(25);
    expect(
      db.prepare('SELECT COUNT(*) AS count FROM schema_migrations WHERE version = 26').get()?.[
        'count'
      ],
    ).toBe(1);
    expect(
      db.prepare('SELECT COUNT(*) AS count FROM schema_migrations WHERE version = 27').get()?.[
        'count'
      ],
    ).toBe(1);
    expect(
      db.prepare('SELECT COUNT(*) AS count FROM schema_migrations WHERE version = 28').get()?.[
        'count'
      ],
    ).toBe(1);
    expect(
      db.prepare('SELECT COUNT(*) AS count FROM schema_migrations WHERE version = 29').get()?.[
        'count'
      ],
    ).toBe(1);
    expect(
      db.prepare('SELECT COUNT(*) AS count FROM schema_migrations WHERE version = 30').get()?.[
        'count'
      ],
    ).toBe(1);
    expect(
      db.prepare('SELECT COUNT(*) AS count FROM schema_migrations WHERE version = 31').get()?.[
        'count'
      ],
    ).toBe(1);
    expect(
      db.prepare('SELECT COUNT(*) AS count FROM schema_migrations WHERE version = 32').get()?.[
        'count'
      ],
    ).toBe(1);

    const first = getIntelligenceMemory(db, 'weekly');
    expect(first.markdown).toBe(INTELLIGENCE_MEMORY_SEED);
    expect(first.updatedBy).toBe('user');
    expect(first.markdown).not.toMatch(/Ubatuba/i);

    const saved = saveIntelligenceMemory(db, 'weekly', '# Household\n\nStable rent.\n', 'user');
    expect(saved.markdown).toContain('Stable rent');
    expect(getIntelligenceMemory(db, 'weekly').markdown).toBe(saved.markdown);
    expect(getIntelligenceMemory(db, 'daily').markdown).toBe(INTELLIGENCE_MEMORY_SEED);
    expect(getIntelligenceMemory(db, 'monthly', intelligenceMemorySeed('pt-BR')).markdown).toBe(
      '# Memória',
    );
  });

  it('replaces the bounded taxonomy policy for one report', () => {
    const db = new DatabaseSync(':memory:');
    migrateDatabase(db);
    expect(readIntelligenceTaxonomyPolicy(db, 'weekly')).toBeNull();

    saveIntelligenceTaxonomyPolicy(db, {
      reportId: 'weekly',
      taxonomyHash: 'first',
      policyJson: '{"decisions":[]}',
    });
    saveIntelligenceTaxonomyPolicy(db, {
      reportId: 'weekly',
      taxonomyHash: 'second',
      policyJson: '{"decisions":[{"id":"own"}]}',
    });

    expect(readIntelligenceTaxonomyPolicy(db, 'weekly')).toMatchObject({
      reportId: 'weekly',
      taxonomyHash: 'second',
      policyJson: '{"decisions":[{"id":"own"}]}',
    });
    expect(
      db.prepare('SELECT COUNT(*) AS count FROM intelligence_taxonomy_policies').get()?.['count'],
    ).toBe(1);
  });

  it('upgrades due-run databases that predate email delivery columns', () => {
    const db = new DatabaseSync(':memory:');
    db.exec(`
      CREATE TABLE schema_migrations (
        version INTEGER PRIMARY KEY,
        applied_at TEXT NOT NULL
      );
      CREATE TABLE intelligence_runs (
        id TEXT PRIMARY KEY,
        report_id TEXT NOT NULL,
        due_key TEXT,
        trigger_kind TEXT CHECK (trigger_kind IN ('manual', 'due'))
      );
      CREATE TABLE intelligence_memory (
        id TEXT PRIMARY KEY,
        markdown TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        updated_by TEXT NOT NULL
      );
      CREATE TABLE intelligence_run_charts (
        run_id TEXT NOT NULL,
        name TEXT NOT NULL,
        mime_type TEXT NOT NULL,
        bytes BLOB NOT NULL,
        PRIMARY KEY (run_id, name)
      );
      CREATE TABLE intelligence_chats (
        id TEXT PRIMARY KEY,
        report_id TEXT NOT NULL,
        seed_run_id TEXT,
        messages_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE annotation_embeddings (
        annotation_id TEXT PRIMARY KEY,
        model TEXT NOT NULL,
        dimensions INTEGER NOT NULL,
        vector BLOB NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE entry_embeddings (
        entry_type TEXT NOT NULL,
        entry_id TEXT NOT NULL,
        model TEXT NOT NULL,
        dimensions INTEGER NOT NULL,
        vector BLOB NOT NULL,
        feature_hash TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (entry_type, entry_id)
      );
    `);
    const markApplied = db.prepare(
      `INSERT INTO schema_migrations (version, applied_at) VALUES (?, '2026-08-23T00:00:00Z')`,
    );
    for (let version = 1; version <= 27; version += 1) {
      markApplied.run(version);
    }

    expect(migrateDatabase(db)).toEqual([28, 29, 30, 31, 32, 33]);
    const columns = db
      .prepare('PRAGMA table_info(intelligence_runs)')
      .all()
      .map((row) => String(row['name']));
    expect(columns).toEqual(
      expect.arrayContaining([
        'email_delivery_started_at',
        'email_delivery_token',
        'email_sent_at',
        'model_call_count',
        'estimated_cost_microusd',
      ]),
    );
  });

  it('clears superseded report artifacts once when migration 030 is applied', () => {
    const db = new DatabaseSync(':memory:');
    migrateDatabase(db);
    db.prepare(
      `INSERT INTO intelligence_memory (id, markdown, updated_at, updated_by)
       VALUES ('weekly', '# Legacy', '2026-08-23T00:00:00Z', 'user')`,
    ).run();
    const run = insertIntelligenceRun(db, {
      reportId: 'weekly',
      periodStart: '2026-08-10',
      periodEnd: '2026-08-16',
      subject: 'Legacy',
      alertCount: 1,
      briefingJson: '{}',
      markdown: 'Legacy',
      html: '<p>Legacy</p>',
      citedTransactionIdsJson: '[]',
      triggerKind: 'manual',
      dueKey: null,
    });
    saveIntelligenceRunChart(db, {
      runId: run.id,
      name: 'cashflow',
      mimeType: 'image/png',
      bytes: new Uint8Array([1]),
    });
    db.prepare('DELETE FROM schema_migrations WHERE version = 30').run();

    expect(migrateDatabase(db)).toEqual([30]);
    expect(db.prepare('SELECT COUNT(*) AS count FROM intelligence_memory').get()?.['count']).toBe(
      0,
    );
    expect(db.prepare('SELECT COUNT(*) AS count FROM intelligence_runs').get()?.['count']).toBe(0);
    expect(
      db.prepare('SELECT COUNT(*) AS count FROM intelligence_run_charts').get()?.['count'],
    ).toBe(0);
  });

  it('stores runs and chart blobs', () => {
    const db = new DatabaseSync(':memory:');
    migrateDatabase(db);

    const run = insertIntelligenceRun(db, {
      reportId: 'weekly',
      periodStart: '2026-08-10',
      periodEnd: '2026-08-16',
      subject: 'All clear — week 2026-08-10',
      alertCount: 0,
      briefingJson: '{}',
      markdown: 'Quiet week.',
      html: '<p>Quiet week.</p>',
      citedTransactionIdsJson: '[]',
    });

    expect(listIntelligenceRuns(db, 'weekly')).toHaveLength(1);
    expect(listIntelligenceRuns(db, 'daily')).toHaveLength(0);
    expect(getIntelligenceRun(db, 'weekly', run.id)?.markdown).toBe('Quiet week.');
    expect(getIntelligenceRun(db, 'daily', run.id)).toBeNull();

    saveIntelligenceRunModelCall(db, {
      runId: run.id,
      ordinal: 0,
      provider: 'openai',
      model: 'gpt-5.6-luna',
      phase: 'analyst',
      reviewRound: null,
      stepNumber: 0,
      inputTokens: 100,
      cachedInputTokens: 20,
      outputTokens: 10,
      reasoningTokens: 5,
      totalTokens: 110,
      reasoningEffort: 'low',
      maxOutputTokens: 8_000,
      durationMs: 12,
      finishReason: 'stop',
      toolNamesJson: '["briefing"]',
      rawUsageJson: null,
      providerMetadataJson: null,
      pricingSnapshotJson: '{"input":0.2,"cachedInput":0.02,"output":1.2}',
      estimatedCostMicrousd: 28,
    });
    expect(listIntelligenceRunModelCalls(db, run.id)).toMatchObject([
      { phase: 'analyst', inputTokens: 100, estimatedCostMicrousd: 28 },
    ]);

    saveIntelligenceRunChart(db, {
      runId: run.id,
      name: 'net-worth',
      mimeType: 'image/png',
      bytes: new Uint8Array([1, 2, 3]),
    });
    expect(listIntelligenceRunChartNames(db, run.id)).toEqual(['net-worth']);
  });

  it('allows manual reruns but enforces one run per report due key', () => {
    const db = new DatabaseSync(':memory:');
    migrateDatabase(db);
    const common = {
      reportId: 'weekly',
      periodStart: '2026-08-10',
      periodEnd: '2026-08-16',
      subject: 'Weekly',
      alertCount: 0,
      briefingJson: '{}',
      markdown: 'Quiet week.',
      html: '<p>Quiet week.</p>',
      citedTransactionIdsJson: '[]',
    } as const;

    insertIntelligenceRun(db, { ...common, triggerKind: 'manual' });
    insertIntelligenceRun(db, { ...common, triggerKind: 'manual' });
    const due = insertIntelligenceRun(db, {
      ...common,
      triggerKind: 'due',
      dueKey: 'weekly:2026-08-17',
    });

    expect(getIntelligenceRunByDueKey(db, 'weekly', 'weekly:2026-08-17')?.id).toBe(due.id);
    expect(due.emailSentAt).toBeNull();
    expect(due.emailDeliveryStartedAt).toBeNull();
    expect(() =>
      insertIntelligenceRun(db, {
        ...common,
        triggerKind: 'due',
        dueKey: 'weekly:2026-08-17',
      }),
    ).toThrow();

    const firstClaim = claimIntelligenceRunEmailDelivery(db, due.id, '2026-08-17T08:00:00.000Z');
    const takeoverClaim = claimIntelligenceRunEmailDelivery(db, due.id, '2026-08-17T08:16:00.000Z');
    expect(firstClaim).toEqual(expect.any(String));
    expect(takeoverClaim).toEqual(expect.any(String));
    expect(takeoverClaim).not.toBe(firstClaim);

    releaseIntelligenceRunEmailDelivery(db, due.id, firstClaim ?? '');
    expect(claimIntelligenceRunEmailDelivery(db, due.id, '2026-08-17T08:16:01.000Z')).toBeNull();
    releaseIntelligenceRunEmailDelivery(db, due.id, takeoverClaim ?? '');
    expect(claimIntelligenceRunEmailDelivery(db, due.id, '2026-08-17T08:16:02.000Z')).toEqual(
      expect.any(String),
    );
  });

  it('adopts the shipped implicit report as weekly without overwriting weekly memory', () => {
    const db = new DatabaseSync(':memory:');
    migrateDatabase(db);
    saveIntelligenceMemory(db, 'default', '# Legacy\n', 'report-agent');
    insertIntelligenceRun(db, {
      id: 'legacy-run',
      reportId: 'default',
      periodStart: '2026-08-10',
      periodEnd: '2026-08-16',
      subject: 'Legacy',
      alertCount: 0,
      briefingJson: '{}',
      markdown: 'Legacy',
      html: '<p>Legacy</p>',
      citedTransactionIdsJson: '[]',
    });

    adoptLegacyIntelligenceReport(db, ['weekly']);

    expect(getIntelligenceMemory(db, 'weekly').markdown).toBe('# Legacy\n');
    expect(listIntelligenceRuns(db, 'weekly').map((run) => run.id)).toEqual(['legacy-run']);

    saveIntelligenceMemory(db, 'default', '# Orphan\n', 'report-agent');
    saveIntelligenceMemory(db, 'weekly', '# Current\n', 'user');
    adoptLegacyIntelligenceReport(db, ['weekly']);
    expect(getIntelligenceMemory(db, 'weekly').markdown).toBe('# Current\n');
    expect(getIntelligenceMemory(db, 'default').markdown).toBe('# Orphan\n');
  });
});
