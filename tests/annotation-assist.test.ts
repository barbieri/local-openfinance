import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_ASSIST_CANDIDATE_LIMIT,
  suggestAnnotationAssist,
} from '../src/annotation/assist.js';
import { loadTransactionEntry } from '../src/annotation/feature-text.js';
import { ensureAnnotationLabel, saveEntryAnnotation } from '../src/annotation/store.js';
import { migrateDatabase } from '../src/db/migrate.js';
import { upsertTransactionCategoryOverride } from '../src/db/transaction-category-overrides.js';
import { embedScoringText, proposeAnnotationFromExamples } from '../src/scoring/providers.js';
import type { ScoringModelConfig } from '../src/types.js';

vi.mock('../src/scoring/providers.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/scoring/providers.js')>();
  return {
    ...actual,
    embedScoringText: vi.fn(async () => ({
      vector: [1, 0, 0],
      dimensions: 3,
      model: 'test:mock',
      inputTokens: 25,
    })),
    proposeAnnotationFromExamples: vi.fn(async () => null),
  };
});

const scoringConfig: ScoringModelConfig = {
  provider: 'test',
  model: 'mock',
  pricing: { input: 0.02 },
};

function seedAccount(db: DatabaseSync): void {
  db.prepare(
    `INSERT INTO connections (item_id, connector_id, connector_name, status, raw_json, synced_at)
     VALUES ('item-1', '601', 'Itau', 'UPDATED', '{}', '2026-06-10T00:00:00.000Z')`,
  ).run();
  db.prepare(
    `INSERT INTO accounts (id, connection_item_id, type, name, currency, raw_json, synced_at)
     VALUES ('acct-1', 'item-1', 'BANK', 'Checking', 'BRL', '{}', '2026-06-10T00:00:00.000Z')`,
  ).run();
}

function seedCategories(db: DatabaseSync): void {
  db.prepare(
    `INSERT INTO categories (id, name, parent_id, parent_name, raw_json, synced_at)
     VALUES ('05000000', 'Food', NULL, NULL, '{}', '2026-06-10T00:00:00.000Z')`,
  ).run();
  db.prepare(
    `INSERT INTO categories (id, name, parent_id, parent_name, raw_json, synced_at)
     VALUES ('07000000', 'Services', NULL, NULL, '{}', '2026-06-10T00:00:00.000Z')`,
  ).run();
}

describe('suggestAnnotationAssist', () => {
  it('reports missing scoring config', async () => {
    const db = new DatabaseSync(':memory:');
    migrateDatabase(db);
    seedAccount(db);
    db.prepare(
      `INSERT INTO transactions (
        id, account_id, occurred_at, amount_cents, currency, description, merchant_name, raw_json, synced_at
      ) VALUES (
        'tx-1', 'acct-1', '2026-06-10T12:00:00.000Z', -5000, 'BRL', 'Coffee', 'Cafe', '{}', '2026-06-10T00:00:00.000Z'
      )`,
    ).run();

    const entry = loadTransactionEntry(db, 'tx-1');
    if (!entry) {
      throw new Error('expected transaction');
    }

    await expect(
      suggestAnnotationAssist(db, entry, {
        classifier: scoringConfig,
      }),
    ).resolves.toEqual({
      status: 'missing_embedding_config',
      examples: [],
      proposal: null,
      usedClassifier: false,
      confidence: null,
    });
  });

  it('reuses recurring merchant labels from the same account', async () => {
    const db = new DatabaseSync(':memory:');
    migrateDatabase(db);
    seedAccount(db);
    seedCategories(db);

    db.prepare(
      `INSERT INTO transactions (
        id, account_id, occurred_at, amount_cents, currency, description, merchant_name, category_id, raw_json, synced_at
      ) VALUES (
        'tx-prev', 'acct-1', '2026-03-10T12:00:00.000Z', -4990, 'BRL', 'Streaming', 'NETFLIX.COM', '05000000',
        '{}', '2026-06-10T00:00:00.000Z'
      )`,
    ).run();
    db.prepare(
      `INSERT INTO transactions (
        id, account_id, occurred_at, amount_cents, currency, description, merchant_name, category_id, raw_json, synced_at
      ) VALUES (
        'tx-target', 'acct-1', '2026-06-10T12:00:00.000Z', -4990, 'BRL', 'Streaming', 'NETFLIX COM', '05000000',
        '{}', '2026-06-10T00:00:00.000Z'
      )`,
    ).run();

    upsertTransactionCategoryOverride(db, 'tx-prev', '07000000');
    const label = ensureAnnotationLabel(db, 'Subscription');
    await saveEntryAnnotation(db, {
      entryType: 'transaction',
      entryId: 'tx-prev',
      labelIds: [label.id],
      notes: 'Monthly streaming',
      source: 'manual',
    });

    const entry = loadTransactionEntry(db, 'tx-target');
    if (!entry) {
      throw new Error('expected transaction');
    }

    const result = await suggestAnnotationAssist(db, entry, {
      embedding: scoringConfig,
      classifier: scoringConfig,
    });

    expect(result.status).toBe('ok');
    expect(result.examples.length).toBeGreaterThan(0);
    expect(result.examples[0]?.matchKind).toBe('merchant');
    expect(result.proposal).toEqual({
      categoryOverrideId: '07000000',
      categoryId: null,
      subCategoryId: null,
      labelIds: [label.id],
      labelNames: ['Subscription'],
      notes: 'Monthly streaming',
      reasoning: 'Matched a recurring merchant on the same account.',
    });
  });

  it('finds an older recurring merchant beyond the recent candidate cap', async () => {
    const db = new DatabaseSync(':memory:');
    migrateDatabase(db);
    seedAccount(db);
    seedCategories(db);
    db.prepare(
      `INSERT INTO transactions (
        id, account_id, occurred_at, amount_cents, currency, description, merchant_name, category_id, raw_json, synced_at
      ) VALUES ('tx-merchant', 'acct-1', '2025-07-15T12:00:00.000Z', -4990, 'BRL', 'Charge',
        'NETFLIX.COM', '05000000', '{}', '2026-06-10T00:00:00.000Z')`,
    ).run();
    const label = ensureAnnotationLabel(db, 'Vacation');
    await saveEntryAnnotation(db, {
      entryType: 'transaction',
      entryId: 'tx-merchant',
      labelIds: [label.id],
      source: 'manual',
    });

    const insertRecent = db.prepare(
      `INSERT INTO transactions (
        id, account_id, occurred_at, amount_cents, currency, description, merchant_name, category_id, raw_json, synced_at
      ) VALUES (?, 'acct-1', ?, -1000, 'BRL', 'Unrelated', ?, '05000000', '{}', '2026-06-10T00:00:00.000Z')`,
    );
    for (let index = 0; index <= DEFAULT_ASSIST_CANDIDATE_LIMIT; index += 1) {
      const hour = String(Math.floor(index / 60)).padStart(2, '0');
      const minute = String(index % 60).padStart(2, '0');
      const id = `tx-recent-${index}`;
      insertRecent.run(id, `2026-06-10T${hour}:${minute}:00.000Z`, `STORE ${index}`);
      upsertTransactionCategoryOverride(db, id, '07000000');
    }
    db.prepare(
      `INSERT INTO transactions (
        id, account_id, occurred_at, amount_cents, currency, description, merchant_name, category_id, raw_json, synced_at
      ) VALUES ('tx-target', 'acct-1', '2026-07-13T12:00:00.000Z', -4990, 'BRL', 'Video',
        'Netflix Com123', '05000000', '{}', '2026-06-10T00:00:00.000Z')`,
    ).run();

    const entry = loadTransactionEntry(db, 'tx-target');
    if (!entry) {
      throw new Error('expected transaction');
    }
    const result = await suggestAnnotationAssist(db, entry, {
      embedding: scoringConfig,
      classifier: scoringConfig,
    });

    expect(result.examples[0]?.entryId).toBe('tx-merchant');
    expect(result.proposal?.labelIds).toEqual([label.id]);
  });

  it('ignores same-account transactions without labels, annotation, or category override', async () => {
    const db = new DatabaseSync(':memory:');
    migrateDatabase(db);
    seedAccount(db);
    seedCategories(db);

    db.prepare(
      `INSERT INTO transactions (
        id, account_id, occurred_at, amount_cents, currency, description, merchant_name, category_id, raw_json, synced_at
      ) VALUES (
        'tx-empty', 'acct-1', '2026-03-10T12:00:00.000Z', -4990, 'BRL', 'Streaming', 'NETFLIX.COM', '05000000',
        '{}', '2026-06-10T00:00:00.000Z'
      )`,
    ).run();
    db.prepare(
      `INSERT INTO transactions (
        id, account_id, occurred_at, amount_cents, currency, description, merchant_name, category_id, raw_json, synced_at
      ) VALUES (
        'tx-target', 'acct-1', '2026-06-10T12:00:00.000Z', -4990, 'BRL', 'Streaming', 'NETFLIX COM', '05000000',
        '{}', '2026-06-10T00:00:00.000Z'
      )`,
    ).run();
    db.prepare(
      `INSERT INTO entry_annotations (
        id, entry_type, entry_id, category_id, sub_category_id, notes, source, created_at, updated_at
      ) VALUES (
        'ea-empty', 'transaction', 'tx-empty', NULL, NULL, NULL, 'manual', '2026-06-10T00:00:00.000Z', '2026-06-10T00:00:00.000Z'
      )`,
    ).run();

    const entry = loadTransactionEntry(db, 'tx-target');
    if (!entry) {
      throw new Error('expected transaction');
    }

    await expect(
      suggestAnnotationAssist(db, entry, {
        embedding: scoringConfig,
        classifier: scoringConfig,
      }),
    ).resolves.toEqual({
      status: 'no_candidates',
      examples: [],
      proposal: null,
      usedClassifier: false,
      confidence: null,
    });
  });

  it('handles generic merchant text that has no FTS tokens', async () => {
    const db = new DatabaseSync(':memory:');
    migrateDatabase(db);
    seedAccount(db);
    seedCategories(db);
    const insert = db.prepare(
      `INSERT INTO transactions (
        id, account_id, occurred_at, amount_cents, currency, description, merchant_name, category_id, raw_json, synced_at
      ) VALUES (?, 'acct-1', ?, -1000, 'BRL', 'Pagamento', 'PIX', '05000000', '{}', '2026-06-10T00:00:00.000Z')`,
    );
    insert.run('tx-prev', '2026-03-10T12:00:00.000Z');
    insert.run('tx-target', '2026-06-10T12:00:00.000Z');
    const label = ensureAnnotationLabel(db, 'Transfer');
    await saveEntryAnnotation(db, {
      entryType: 'transaction',
      entryId: 'tx-prev',
      labelIds: [label.id],
      source: 'manual',
    });

    const entry = loadTransactionEntry(db, 'tx-target');
    if (!entry) {
      throw new Error('expected transaction');
    }
    const result = await suggestAnnotationAssist(db, entry, {
      embedding: scoringConfig,
      classifier: scoringConfig,
    });

    expect(result.status).toBe('no_suggestion');
    expect(
      db
        .prepare(
          `SELECT input_tokens, pricing_snapshot_json, estimated_cost_microusd
           FROM entry_embeddings WHERE entry_type = 'transaction' AND entry_id = 'tx-target'`,
        )
        .get(),
    ).toEqual({
      input_tokens: 25,
      pricing_snapshot_json: '{"input":0.02}',
      estimated_cost_microusd: 1,
    });

    vi.mocked(embedScoringText).mockResolvedValueOnce({
      vector: [0, 1, 0],
      dimensions: 3,
      model: 'test:mock',
      inputTokens: 75,
    });
    db.prepare(
      "UPDATE transactions SET description = 'Pagamento atualizado' WHERE id = 'tx-target'",
    ).run();
    const updatedEntry = loadTransactionEntry(db, 'tx-target');
    if (!updatedEntry) {
      throw new Error('expected updated transaction');
    }
    await suggestAnnotationAssist(db, updatedEntry, {
      embedding: { ...scoringConfig, pricing: { input: 0.03 } },
      classifier: scoringConfig,
    });

    expect(
      db
        .prepare(
          `SELECT input_tokens, pricing_snapshot_json, estimated_cost_microusd
           FROM entry_embeddings WHERE entry_type = 'transaction' AND entry_id = 'tx-target'`,
        )
        .get(),
    ).toEqual({
      input_tokens: 75,
      pricing_snapshot_json: '{"input":0.03}',
      estimated_cost_microusd: 2,
    });
  });

  it('accepts category override alone as an assist example', async () => {
    const db = new DatabaseSync(':memory:');
    migrateDatabase(db);
    seedAccount(db);
    seedCategories(db);

    db.prepare(
      `INSERT INTO transactions (
        id, account_id, occurred_at, amount_cents, currency, description, merchant_name, category_id, raw_json, synced_at
      ) VALUES (
        'tx-prev', 'acct-1', '2026-03-10T12:00:00.000Z', -4990, 'BRL', 'Streaming', 'NETFLIX.COM', '05000000',
        '{}', '2026-06-10T00:00:00.000Z'
      )`,
    ).run();
    db.prepare(
      `INSERT INTO transactions (
        id, account_id, occurred_at, amount_cents, currency, description, merchant_name, category_id, raw_json, synced_at
      ) VALUES (
        'tx-target', 'acct-1', '2026-06-10T12:00:00.000Z', -4990, 'BRL', 'Streaming', 'NETFLIX COM', '05000000',
        '{}', '2026-06-10T00:00:00.000Z'
      )`,
    ).run();
    upsertTransactionCategoryOverride(db, 'tx-prev', '07000000');

    const entry = loadTransactionEntry(db, 'tx-target');
    if (!entry) {
      throw new Error('expected transaction');
    }

    const result = await suggestAnnotationAssist(db, entry, {
      embedding: scoringConfig,
      classifier: scoringConfig,
    });

    expect(result.status).toBe('ok');
    expect(result.examples).toHaveLength(1);
    expect(result.proposal?.categoryOverrideId).toBe('07000000');
  });

  it('fills category override from examples when classifier only returns labels', async () => {
    const db = new DatabaseSync(':memory:');
    migrateDatabase(db);
    seedAccount(db);
    seedCategories(db);
    db.prepare(
      `INSERT INTO categories (id, name, parent_id, parent_name, raw_json, synced_at)
       VALUES ('07003000', 'Utilities', NULL, NULL, '{}', '2026-06-10T00:00:00.000Z')`,
    ).run();
    db.prepare(
      `INSERT INTO categories (id, name, parent_id, parent_name, raw_json, synced_at)
       VALUES ('07003001', 'Electricity', '07003000', 'Utilities', '{}', '2026-06-10T00:00:00.000Z')`,
    ).run();

    db.prepare(
      `INSERT INTO transactions (
        id, account_id, occurred_at, amount_cents, currency, description, merchant_name, category_id, raw_json, synced_at
      ) VALUES (
        'tx-prev', 'acct-1', '2026-03-10T12:00:00.000Z', -12000, 'BRL', 'Power bill', 'COPEL DIS', '07003000',
        '{}', '2026-06-10T00:00:00.000Z'
      )`,
    ).run();
    db.prepare(
      `INSERT INTO transactions (
        id, account_id, occurred_at, amount_cents, currency, description, merchant_name, category_id, raw_json, synced_at
      ) VALUES (
        'tx-target', 'acct-1', '2026-06-10T12:00:00.000Z', -12000, 'BRL', 'Power bill', 'COPEL DIS', '07003000',
        '{}', '2026-06-10T00:00:00.000Z'
      )`,
    ).run();

    upsertTransactionCategoryOverride(db, 'tx-prev', '07003001');
    const label = ensureAnnotationLabel(db, 'Home');
    await saveEntryAnnotation(db, {
      entryType: 'transaction',
      entryId: 'tx-prev',
      labelIds: [label.id],
      source: 'manual',
    });

    vi.mocked(proposeAnnotationFromExamples).mockResolvedValueOnce({
      categoryOverrideId: null,
      categoryId: null,
      subCategoryId: null,
      labelIds: [],
      labelNames: ['Home'],
      notes: '2026-03-10',
      reasoning: null,
    });

    const entry = loadTransactionEntry(db, 'tx-target');
    if (!entry) {
      throw new Error('expected transaction');
    }

    const result = await suggestAnnotationAssist(db, entry, {
      embedding: scoringConfig,
      classifier: scoringConfig,
    });

    expect(result.status).toBe('ok');
    expect(result.proposal?.labelIds).toEqual([label.id]);
    expect(result.proposal?.labelNames).toEqual(['Home']);
    expect(result.proposal?.categoryOverrideId).toBe('07003001');
    expect(result.proposal?.notes).toBeNull();
  });

  it('prefers same-account peer document matches over merchant text', async () => {
    const db = new DatabaseSync(':memory:');
    migrateDatabase(db);
    seedAccount(db);
    seedCategories(db);

    const peerRaw = JSON.stringify({
      description: 'Pix enviado SOLID',
      merchant: { cnpj: '11222333000181', businessName: 'SOLID EMPREENDIMENTOS' },
      paymentData: {
        payer: { documentNumber: { type: 'CPF', value: '390.533.447-05' } },
        receiver: { documentNumber: { type: 'CNPJ', value: '11.222.333/0001-81' } },
      },
    });

    db.prepare(
      `INSERT INTO transactions (
        id, account_id, occurred_at, amount_cents, currency, description, merchant_name, category_id,
        raw_json, synced_at, payer_document_key, receiver_document_key, merchant_document_key
      ) VALUES (
        'tx-prev', 'acct-1', '2024-07-10T12:00:00.000Z', -15000, 'BRL', 'Pix enviado SOLID', 'SOLID EMPREENDIMENTOS',
        '05000000', ?, '2026-06-10T00:00:00.000Z',
        'cpf:39053344705', 'cnpj:11222333000181', 'cnpj:11222333000181'
      )`,
    ).run(peerRaw);
    db.prepare(
      `INSERT INTO transactions (
        id, account_id, occurred_at, amount_cents, currency, description, merchant_name, category_id,
        raw_json, synced_at, payer_document_key, receiver_document_key, merchant_document_key
      ) VALUES (
        'tx-target', 'acct-1', '2026-06-10T12:00:00.000Z', -18000, 'BRL', 'Pix SOLID LTDA', 'SOLID LTDA',
        '05000000', ?, '2026-06-10T00:00:00.000Z',
        'cpf:39053344705', 'cnpj:11222333000181', 'cnpj:11222333000181'
      )`,
    ).run(peerRaw);

    upsertTransactionCategoryOverride(db, 'tx-prev', '07000000');
    const label = ensureAnnotationLabel(db, 'Aluguel');
    await saveEntryAnnotation(db, {
      entryType: 'transaction',
      entryId: 'tx-prev',
      labelIds: [label.id],
      notes: 'Monthly rent peer',
      source: 'manual',
    });

    const entry = loadTransactionEntry(db, 'tx-target');
    if (!entry) {
      throw new Error('expected transaction');
    }

    const result = await suggestAnnotationAssist(db, entry, {
      embedding: scoringConfig,
      classifier: scoringConfig,
    });

    expect(result.status).toBe('ok');
    expect(result.examples[0]?.matchKind).toBe('peer_account');
    expect(result.examples[0]?.peerDocumentKey).toBe('cnpj:11222333000181');
    expect(result.proposal).toEqual({
      categoryOverrideId: '07000000',
      categoryId: null,
      subCategoryId: null,
      labelIds: [label.id],
      labelNames: ['Aluguel'],
      notes: 'Monthly rent peer',
      reasoning:
        'Matched the same counterparty document (cnpj:11222333000181) on the same account.',
    });
  });

  it('asks the classifier to distinguish conflicting flows from the same merchant', async () => {
    vi.mocked(proposeAnnotationFromExamples).mockReset();
    vi.mocked(proposeAnnotationFromExamples).mockResolvedValue(null);
    const db = new DatabaseSync(':memory:');
    migrateDatabase(db);
    seedAccount(db);
    seedCategories(db);

    const raw = JSON.stringify({ merchant: { cnpj: '24917034000103' } });
    const insert = db.prepare(
      `INSERT INTO transactions (
        id, account_id, occurred_at, amount_cents, currency, description, merchant_name, category_id,
        raw_json, synced_at, merchant_document_key
      ) VALUES (?, 'acct-1', ?, -1000, 'BRL', ?, ?, '05000000', ?, '2026-06-10T00:00:00.000Z',
        'cnpj:24917034000103')`,
    );
    insert.run('tx-salary', '2026-01-10T12:00:00.000Z', 'Salary', 'PROFUSION', raw);
    insert.run('tx-dividend', '2026-02-10T12:00:00.000Z', 'Dividend', 'PIX PROFUSION', raw);
    insert.run('tx-target', '2026-06-10T12:00:00.000Z', 'Dividend', 'PIX PROFUSION', raw);

    const salary = ensureAnnotationLabel(db, 'Salary');
    const dividend = ensureAnnotationLabel(db, 'Dividend');
    await saveEntryAnnotation(db, {
      entryType: 'transaction',
      entryId: 'tx-salary',
      labelIds: [salary.id],
      source: 'manual',
    });
    await saveEntryAnnotation(db, {
      entryType: 'transaction',
      entryId: 'tx-dividend',
      labelIds: [dividend.id],
      source: 'manual',
    });

    const entry = loadTransactionEntry(db, 'tx-target');
    if (!entry) {
      throw new Error('expected transaction');
    }
    const result = await suggestAnnotationAssist(db, entry, {
      embedding: scoringConfig,
      classifier: scoringConfig,
    });

    expect(result.examples[0]?.entryId).toBe('tx-dividend');
    expect(result.status).toBe('no_suggestion');
    expect(result.usedClassifier).toBe(true);
    expect(result.proposal).toBeNull();
  });

  it('does not treat a shared description as an exact merchant match', async () => {
    const db = new DatabaseSync(':memory:');
    migrateDatabase(db);
    seedAccount(db);
    seedCategories(db);
    const raw = JSON.stringify({ merchant: { cnpj: '24917034000103' } });
    const insert = db.prepare(
      `INSERT INTO transactions (
        id, account_id, occurred_at, amount_cents, currency, description, merchant_name, category_id,
        raw_json, synced_at, merchant_document_key
      ) VALUES (?, 'acct-1', ?, -1000, 'BRL', 'Payment confirmation', ?, '05000000', ?,
        '2026-06-10T00:00:00.000Z', 'cnpj:24917034000103')`,
    );
    insert.run('tx-peer', '2026-01-10T12:00:00.000Z', 'SALARY PROVIDER', raw);
    insert.run('tx-target', '2026-06-10T12:00:00.000Z', 'DIVIDEND PROVIDER', raw);
    const label = ensureAnnotationLabel(db, 'Salary');
    await saveEntryAnnotation(db, {
      entryType: 'transaction',
      entryId: 'tx-peer',
      labelIds: [label.id],
      source: 'manual',
    });

    const entry = loadTransactionEntry(db, 'tx-target');
    if (!entry) {
      throw new Error('expected transaction');
    }
    const result = await suggestAnnotationAssist(db, entry, {
      embedding: scoringConfig,
      classifier: scoringConfig,
    });

    expect(result.examples[0]?.matchKind).toBe('peer_account');
    expect(result.proposal?.labelIds).toEqual([label.id]);
  });

  it('does not peer-match on the account holder payer CPF alone', async () => {
    const db = new DatabaseSync(':memory:');
    migrateDatabase(db);
    seedAccount(db);
    seedCategories(db);

    // Same self CPF as payer on both, but different counterparties (CNPJ + merchant).
    db.prepare(
      `INSERT INTO transactions (
        id, account_id, occurred_at, amount_cents, currency, description, merchant_name, category_id,
        raw_json, synced_at, payer_document_key, receiver_document_key, merchant_document_key
      ) VALUES (
        'tx-prev', 'acct-1', '2026-03-10T12:00:00.000Z', -400, 'BRL', 'Pix parking', 'PARKING LOT',
        '05000000', ?, '2026-06-10T00:00:00.000Z',
        'cpf:39053344705', 'cnpj:00000000000191', 'cnpj:00000000000191'
      )`,
    ).run(
      JSON.stringify({
        description: 'Pix parking',
        merchant: { cnpj: '00000000000191', businessName: 'PARKING LOT' },
        paymentData: {
          payer: { documentNumber: { type: 'CPF', value: '390.533.447-05' } },
          receiver: { documentNumber: { type: 'CNPJ', value: '27.488.003/0001-72' } },
        },
      }),
    );
    db.prepare(
      `INSERT INTO transactions (
        id, account_id, occurred_at, amount_cents, currency, description, merchant_name, category_id,
        raw_json, synced_at, payer_document_key, receiver_document_key, merchant_document_key
      ) VALUES (
        'tx-target', 'acct-1', '2026-06-10T12:00:00.000Z', -400, 'BRL',
        'Pagamento de Pix QR Code EMPRESA MUNICIPAL', 'EMDURB',
        '07000000', ?, '2026-06-10T00:00:00.000Z',
        'cpf:39053344705', 'cnpj:11444777000161', 'cnpj:11444777000161'
      )`,
    ).run(
      JSON.stringify({
        description: 'Pagamento de Pix QR Code EMPRESA MUNICIPAL',
        merchant: {
          cnpj: '11444777000161',
          businessName: 'EMPRESA MUNICIPAL DE DESENVOL URBANO DE UBATUBA EMDURB',
        },
        paymentData: {
          payer: { documentNumber: { type: 'CPF', value: '390.533.447-05' } },
          receiver: {
            documentNumber: { type: 'CNPJ', value: '50.443.985/0001-06' },
            name: 'EMPRESA MUNICIPAL DE DESENVOL URBANO DE UBATUBA EMDURB',
          },
        },
      }),
    );

    upsertTransactionCategoryOverride(db, 'tx-prev', '05000000');
    const label = ensureAnnotationLabel(db, 'Parking');
    await saveEntryAnnotation(db, {
      entryType: 'transaction',
      entryId: 'tx-prev',
      labelIds: [label.id],
      notes: 'Parking',
      source: 'manual',
    });

    const entry = loadTransactionEntry(db, 'tx-target');
    if (!entry) {
      throw new Error('expected transaction');
    }

    const result = await suggestAnnotationAssist(db, entry, {
      embedding: scoringConfig,
      classifier: scoringConfig,
    });

    // No counterparty overlap → must not copy the parking label via peer match.
    expect(result.examples.every((example) => example.matchKind !== 'peer_account')).toBe(true);
    expect(result.examples.every((example) => example.matchKind !== 'peer')).toBe(true);
    expect(result.proposal?.labelIds ?? []).not.toContain(label.id);
    expect(result.proposal?.reasoning ?? '').not.toMatch(/cpf:39053344705/i);
  });

  it('falls back to cross-account peer document matches', async () => {
    const db = new DatabaseSync(':memory:');
    migrateDatabase(db);
    seedAccount(db);
    seedCategories(db);
    db.prepare(
      `INSERT INTO accounts (id, connection_item_id, type, name, currency, raw_json, synced_at)
       VALUES ('acct-2', 'item-1', 'BANK', 'Savings', 'BRL', '{}', '2026-06-10T00:00:00.000Z')`,
    ).run();

    const peerRaw = JSON.stringify({
      merchant: { cnpj: '73042962000420', businessName: 'DISNEY' },
    });

    db.prepare(
      `INSERT INTO transactions (
        id, account_id, occurred_at, amount_cents, currency, description, merchant_name, category_id,
        raw_json, synced_at, merchant_document_key
      ) VALUES (
        'tx-prev', 'acct-2', '2025-01-10T12:00:00.000Z', -4990, 'BRL', 'Disney Plus', 'DISNEY',
        '05000000', ?, '2026-06-10T00:00:00.000Z', 'cnpj:73042962000420'
      )`,
    ).run(peerRaw);
    db.prepare(
      `INSERT INTO transactions (
        id, account_id, occurred_at, amount_cents, currency, description, merchant_name, category_id,
        raw_json, synced_at, merchant_document_key
      ) VALUES (
        'tx-target', 'acct-1', '2026-06-10T12:00:00.000Z', -4990, 'BRL', 'Disney', 'THE WALT DISNEY',
        '05000000', ?, '2026-06-10T00:00:00.000Z', 'cnpj:73042962000420'
      )`,
    ).run(peerRaw);

    upsertTransactionCategoryOverride(db, 'tx-prev', '07000000');
    const label = ensureAnnotationLabel(db, 'Streaming');
    await saveEntryAnnotation(db, {
      entryType: 'transaction',
      entryId: 'tx-prev',
      labelIds: [label.id],
      source: 'manual',
    });

    const entry = loadTransactionEntry(db, 'tx-target');
    if (!entry) {
      throw new Error('expected transaction');
    }

    const result = await suggestAnnotationAssist(db, entry, {
      embedding: scoringConfig,
      classifier: scoringConfig,
    });

    expect(result.status).toBe('ok');
    expect(result.examples[0]?.matchKind).toBe('peer');
    expect(result.examples[0]?.sameAccount).toBe(false);
    expect(result.proposal?.categoryOverrideId).toBe('07000000');
    expect(result.proposal?.labelIds).toEqual([label.id]);
  });

  it('does not copy an ambiguous proxy merchant classification by name alone', async () => {
    vi.mocked(proposeAnnotationFromExamples).mockReset();
    vi.mocked(proposeAnnotationFromExamples).mockResolvedValue(null);
    const db = new DatabaseSync(':memory:');
    migrateDatabase(db);
    seedAccount(db);
    seedCategories(db);
    const insert = db.prepare(
      `INSERT INTO transactions (
        id, account_id, occurred_at, amount_cents, currency, description, merchant_name, category_id, raw_json, synced_at
      ) VALUES (?, 'acct-1', ?, -4990, 'BRL', ?, 'MERCADOLIVRE', '05000000', '{}', '2026-06-10T00:00:00.000Z')`,
    );
    for (let index = 0; index < 6; index += 1) {
      insert.run(`tx-book-${index}`, `2026-0${index + 1}-10T12:00:00.000Z`, 'Charge');
    }
    // This seventh candidate is outside topK but still within the two-year recall window.
    insert.run('tx-phone', '2024-07-10T12:00:00.000Z', 'Charge');
    insert.run('tx-target', '2026-06-10T12:00:00.000Z', 'Charge');

    const books = ensureAnnotationLabel(db, 'Books');
    const electronics = ensureAnnotationLabel(db, 'Electronics');
    for (let index = 0; index < 6; index += 1) {
      await saveEntryAnnotation(db, {
        entryType: 'transaction',
        entryId: `tx-book-${index}`,
        labelIds: [books.id],
        source: 'manual',
      });
    }
    await saveEntryAnnotation(db, {
      entryType: 'transaction',
      entryId: 'tx-phone',
      labelIds: [electronics.id],
      source: 'manual',
    });

    const entry = loadTransactionEntry(db, 'tx-target');
    if (!entry) {
      throw new Error('expected transaction');
    }
    const result = await suggestAnnotationAssist(db, entry, {
      embedding: scoringConfig,
      classifier: scoringConfig,
    });

    expect(result.status).toBe('no_suggestion');
    expect(result.usedClassifier).toBe(true);
    expect(result.proposal).toBeNull();
    expect(result.examples.map((example) => example.entryId)).toContain('tx-phone');
  });
});
