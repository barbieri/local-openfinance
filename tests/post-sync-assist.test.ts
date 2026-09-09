import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it, vi } from 'vitest';
import { upsertAssistSuggestion } from '../src/annotation/assist-suggestions.js';
import { listPendingAssistSuggestionEntryIds } from '../src/annotation/pending-assist-suggestions.js';
import { migrateDatabase } from '../src/db/migrate.js';
import {
  createPostSyncAssist,
  type PostSyncAssistDependencies,
} from '../src/intelligence/post-sync-assist.js';
import type { ResolvedConfig } from '../src/types.js';

const resolved: ResolvedConfig = {
  configPath: '/tmp/post-sync-config.json',
  configHash: 'post-sync-test-hash',
  topicId: 'post-sync-test',
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
    reports: [],
    web: { publicBaseUrl: 'https://finance.example' },
    intelligence: {
      suggestionConfidenceThreshold: 0.82,
      minReportedItemAmountCents: 10_000,
      rareLookbackYears: 3,
    },
    chatModel: undefined,
    notify: { smtp: undefined },
    model: { provider: 'openai', model: 'unused-test-model' },
  },
};

function openDbWithPendingSuggestion(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  migrateDatabase(db);
  db.prepare(
    `INSERT INTO connections (item_id, connector_id, connector_name, status, raw_json, synced_at)
     VALUES ('item-1', '601', 'Bank', 'UPDATED', '{}', '2026-08-20T00:00:00.000Z')`,
  ).run();
  db.prepare(
    `INSERT INTO accounts (id, connection_item_id, type, name, currency, raw_json, synced_at)
     VALUES ('acct-1', 'item-1', 'BANK', 'Checking', 'BRL', '{}', '2026-08-20T00:00:00.000Z')`,
  ).run();
  db.prepare(
    `INSERT INTO transactions (
       id, account_id, occurred_at, amount_cents, currency, description, raw_json, synced_at
     ) VALUES ('tx-old', 'acct-1', '2026-08-20T12:00:00.000Z', -100, 'BRL', 'Previous', '{}',
       '2026-08-20T00:00:00.000Z')`,
  ).run();
  upsertAssistSuggestion(db, {
    entryType: 'transaction',
    entryId: 'tx-old',
    status: 'ok',
    proposal: {
      categoryOverrideId: null,
      categoryId: null,
      subCategoryId: null,
      labelIds: [],
      labelNames: [],
      notes: null,
      reasoning: null,
    },
    examples: [],
    confidence: 0.9,
    usedClassifier: false,
    embeddingModel: 'test:mock',
    classifierModel: null,
    algorithmVersion: 2,
    computedAt: '2026-08-20T00:00:00.000Z',
    reviewStatus: 'pending',
    reviewedAt: null,
  });
  return db;
}

describe('post-sync assist delivery', () => {
  it('snapshots pending suggestions before CLI/background precompute', async () => {
    const precompute = vi.fn(async (db: DatabaseSync) => {
      db.prepare(`DELETE FROM annotation_assist_suggestions WHERE entry_id = 'tx-old'`).run();
      return {
        cleared: 0,
        backfilledEmbeddings: 0,
        total: 1,
        ok: 1,
        noSuggestion: 0,
        noCandidates: 0,
        skippedExisting: 0,
        skippedMissingConfig: false,
      };
    });
    const sendDigest = vi.fn<PostSyncAssistDependencies['sendDigest']>(async () => ({
      kind: 'sent' as const,
      suggestionCount: 1,
    }));
    const detectRecentTransfers = vi.fn<PostSyncAssistDependencies['detectRecentTransfers']>(
      async () => ({
        groupsCreated: 0,
        membersLinked: 0,
        candidatesScanned: 0,
        proposed: 0,
        skipped: 0,
      }),
    );
    const runPostSyncAssist = createPostSyncAssist({
      listPendingSuggestionEntryIds: listPendingAssistSuggestionEntryIds,
      runPrecompute: precompute,
      sendDigest,
      detectRecentTransfers,
    } satisfies PostSyncAssistDependencies);

    const cliDb = openDbWithPendingSuggestion();
    cliDb
      .prepare(
        `UPDATE annotation_assist_suggestions
         SET proposal_json = 'not-json', examples_json = 'not-json'
         WHERE entry_type = 'transaction' AND entry_id = 'tx-old'`,
      )
      .run();
    await runPostSyncAssist({
      db: cliDb,
      resolved,
    });
    const cliDigestInput = sendDigest.mock.calls[0]?.[0];
    expect(cliDigestInput).toBeDefined();
    if (!cliDigestInput) {
      throw new Error('Expected CLI digest input');
    }
    expect(cliDigestInput.previouslyPendingEntryIds).toEqual(new Set(['tx-old']));

    await runPostSyncAssist({
      db: openDbWithPendingSuggestion(),
      resolved,
      syncedAt: '2026-08-20T01:00:00.000Z',
    });
    expect(detectRecentTransfers).toHaveBeenCalledWith(
      expect.anything(),
      '2026-08-20T01:00:00.000Z',
    );
    expect(sendDigest).toHaveBeenCalledTimes(2);
  });
});
