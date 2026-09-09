import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it, vi } from 'vitest';
import { upsertAssistSuggestion } from '../src/annotation/assist-suggestions.js';
import { ensureAnnotationCategory, ensureAnnotationLabel } from '../src/annotation/store.js';
import { migrateDatabase } from '../src/db/migrate.js';
import {
  createSyncSuggestionDigest,
  type SyncSuggestionDigestDelivery,
} from '../src/intelligence/sync-suggestion-digest.js';
import type { ResolvedConfig } from '../src/types.js';

const resolved: ResolvedConfig = {
  configPath: '/tmp/digest-config.json',
  configHash: 'digest-test-hash',
  topicId: 'digest-test',
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
    notify: {
      smtp: {
        host: 'smtp.example.test',
        port: 587,
        secure: false,
        from: 'finance@example.test',
        to: ['owner@example.test'],
        auth: undefined,
      },
    },
    model: { provider: 'openai', model: 'unused-test-model' },
  },
};

const deliverEmailMock = vi.fn<SyncSuggestionDigestDelivery>(async () => ({
  sent: true,
  message: {},
}));
const sendAssistSuggestionDigest = createSyncSuggestionDigest({
  deliverEmail: deliverEmailMock,
});

function openDb(): DatabaseSync {
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
    `INSERT INTO categories (id, name, parent_id, parent_name, raw_json, synced_at)
     VALUES ('05000000', 'Food', NULL, NULL, '{}', '2026-08-20T00:00:00.000Z')`,
  ).run();
  return db;
}

function seedSuggestion(db: DatabaseSync, entryId: string, description: string): void {
  db.prepare(
    `INSERT INTO transactions (
      id, account_id, occurred_at, amount_cents, currency, description, merchant_name,
      category_id, raw_json, synced_at
    ) VALUES (?, 'acct-1', '2026-08-20T12:00:00.000Z', -12345, 'BRL', ?, NULL, '05000000', '{}', '2026-08-20T00:00:00.000Z')`,
  ).run(entryId, description);

  const parent = ensureAnnotationCategory(db, 'Home');
  const child = ensureAnnotationCategory(db, 'Supplies', parent.id);
  const labelParent = ensureAnnotationLabel(db, 'Needs');
  const labelChild = ensureAnnotationLabel(db, 'Household', labelParent.id);
  upsertAssistSuggestion(db, {
    entryType: 'transaction',
    entryId,
    status: 'ok',
    proposal: {
      categoryOverrideId: null,
      categoryId: child.id,
      subCategoryId: null,
      labelIds: [labelChild.id],
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
}

describe('sync suggestion digest', () => {
  it('skips without pending suggestions and sends updated html rows with links and old/new category labels', async () => {
    const db = openDb();
    const empty = await sendAssistSuggestionDigest({
      db,
      resolved,
      previouslyPendingEntryIds: new Set(),
      timeZone: 'UTC',
    });
    expect(empty).toEqual({ kind: 'skipped', reason: 'no-pending-suggestions' });

    seedSuggestion(db, 'new-1', '<unsafe> & "quoted"');
    seedSuggestion(db, 'old-1', 'Previous');
    const result = await sendAssistSuggestionDigest({
      db,
      resolved,
      previouslyPendingEntryIds: new Set(['old-1']),
      timeZone: 'UTC',
    });

    expect(result).toEqual({ kind: 'sent', suggestionCount: 2 });
    expect(deliverEmailMock).toHaveBeenCalledTimes(1);
    const delivery = deliverEmailMock.mock.calls[0]?.[0];
    expect(delivery).toBeDefined();
    if (!delivery) {
      throw new Error('Expected the suggestion digest email to be delivered');
    }
    const content = delivery.content;
    expect(content.html).toContain('Novas sugestões desta rodada');
    expect(content.html).toContain('<h2>Sugestões pendentes anteriores</h2>');
    expect(content.html).toContain('Home &gt; Supplies');
    expect(content.html).toContain('Needs &gt; Household');
    expect(content.html).toContain('90%');
    expect(content.html).toContain('&lt;unsafe&gt; &amp; &quot;quoted&quot;');
    expect(content.html).toContain('Nova categoria');
    expect(content.html).toContain('Novas etiquetas');
    expect(content.html).toContain('Abrir triagem');
    expect(content.html).toContain('/#/transaction/new-1');
    expect(content.html).toContain('href="https://finance.example/#/triage"');
    expect(content.html).toContain('Food');
    expect(content.html).toContain('color: #16a34a');
  });

  it('returns failed for malformed pending proposal during preparation', async () => {
    deliverEmailMock.mockClear();
    const db = openDb();
    db.prepare(
      `INSERT INTO transactions (
        id, account_id, occurred_at, amount_cents, currency, description, raw_json, synced_at
      ) VALUES ('invalid-1', 'acct-1', '2026-08-20T12:00:00.000Z', -100, 'BRL', 'Invalid', '{}', '2026-08-20T00:00:00.000Z')`,
    ).run();
    db.prepare(
      `INSERT INTO annotation_assist_suggestions (
        entry_type, entry_id, status, proposal_json, examples_json, computed_at, review_status
      ) VALUES ('transaction', 'invalid-1', 'ok', 'not-json', '[]', '2026-08-20T00:00:00.000Z', 'pending')`,
    ).run();

    const result = await sendAssistSuggestionDigest({
      db,
      resolved,
      previouslyPendingEntryIds: new Set(),
      timeZone: 'UTC',
    });

    expect(result.kind).toBe('failed');
    expect(result).toMatchObject({ suggestionCount: 0 });
    expect(deliverEmailMock).not.toHaveBeenCalled();
  });
});
