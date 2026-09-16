import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { migrateDatabase } from '../src/db/migrate.js';
import { BackgroundJobManager } from '../src/web/server/background-jobs.js';
import { createWebApp } from '../src/web/server/server.js';

function seedTriageTransaction(db: DatabaseSync): void {
  db.prepare(
    `INSERT INTO connections (item_id, connector_id, connector_name, status, raw_json, synced_at)
     VALUES ('item-1', '601', 'Itaú', 'UPDATED', '{}', '2026-06-10T00:00:00.000Z')`,
  ).run();
  db.prepare(
    `INSERT INTO accounts (id, connection_item_id, type, name, currency, raw_json, synced_at)
     VALUES ('acct-1', 'item-1', 'BANK', 'Checking', 'BRL', '{}', '2026-06-10T00:00:00.000Z')`,
  ).run();
  db.prepare(
    `INSERT INTO transactions (
       id, account_id, occurred_at, amount_cents, currency, description, raw_json, synced_at
     ) VALUES ('tx-1', 'acct-1', '2026-06-01T12:00:00.000Z', -1000, 'BRL', 'Test', '{}', '2026-06-10T00:00:00.000Z')`,
  ).run();
  db.prepare(
    `INSERT INTO annotation_assist_suggestions (
       entry_type, entry_id, status, proposal_json, examples_json, confidence,
       used_classifier, computed_at, review_status
     ) VALUES (
       'transaction', 'tx-1', 'ok',
       '{"categoryOverrideId":null,"categoryId":null,"subCategoryId":null,"labelIds":[],"labelNames":[],"notes":null,"reasoning":null}',
       '[]', 0.9, 0, '2026-06-10T00:00:00.000Z', 'pending'
     )`,
  ).run();
}

describe('classify triage web API', () => {
  it('returns JSON for triage queue and stats', async () => {
    const db = new DatabaseSync(':memory:');
    migrateDatabase(db);
    seedTriageTransaction(db);

    process.env['LOCAL_OPENFINANCE_WEB_TOKEN'] = 'test-token';
    const app = createWebApp({
      db,
      resolved: {
        config: { storage: { databasePath: ':memory:' }, annotation: {} },
      } as never,
      jobs: new BackgroundJobManager(),
    });

    const auth = { Authorization: 'Bearer test-token' };

    const statsRes = await app.request('/api/classify/triage/stats', { headers: auth });
    expect(statsRes.status).toBe(200);
    expect(statsRes.headers.get('content-type')).toContain('application/json');
    await expect(statsRes.json()).resolves.toEqual({ pending: 1 });

    const queueRes = await app.request('/api/classify/triage?limit=1&offset=0', { headers: auth });
    expect(queueRes.status).toBe(200);
    expect(queueRes.headers.get('content-type')).toContain('application/json');
    const queue = (await queueRes.json()) as { pending: number; items: { entryId: string }[] };
    expect(queue.pending).toBe(1);
    expect(queue.items).toHaveLength(1);
    expect(queue.items[0]?.entryId).toBe('tx-1');

    const detailRes = await app.request('/api/transactions/tx-1', { headers: auth });
    expect(detailRes.status).toBe(200);
    const detail = (await detailRes.json()) as { transaction: { id: string } };
    expect(detail.transaction.id).toBe('tx-1');
  });

  it('soft deletes only explicit transaction ids and keeps a deleted detail permalink readable', async () => {
    const db = new DatabaseSync(':memory:');
    migrateDatabase(db);
    seedTriageTransaction(db);
    db.prepare(
      `INSERT INTO transactions (id, account_id, occurred_at, amount_cents, currency, description, raw_json, synced_at)
       VALUES ('tx-2', 'acct-1', '2026-06-02T12:00:00.000Z', -2000, 'BRL', 'Second', '{}', '2026-06-10T00:00:00.000Z')`,
    ).run();
    process.env['LOCAL_OPENFINANCE_WEB_TOKEN'] = 'test-token';
    const app = createWebApp({
      db,
      resolved: { config: { storage: { databasePath: ':memory:' }, annotation: {} } } as never,
      jobs: new BackgroundJobManager(),
    });
    const headers = { Authorization: 'Bearer test-token', 'Content-Type': 'application/json' };

    const deleted = await app.request('/api/transactions/tx-1/delete', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        additionalTransactionIds: ['tx-2'],
        deleteReason: 'provider duplicate',
      }),
    });
    expect(deleted.status).toBe(200);
    await expect(deleted.json()).resolves.toMatchObject({
      requestedIds: ['tx-1', 'tx-2'],
      newlyDeletedIds: ['tx-1', 'tx-2'],
    });
    expect(
      db.prepare('SELECT deleted_at, delete_reason FROM transactions WHERE id = ?').get('tx-2'),
    ).toMatchObject({ delete_reason: 'provider duplicate' });

    const detail = await app.request('/api/transactions/tx-1', { headers });
    expect(detail.status).toBe(200);
    await expect(detail.json()).resolves.toMatchObject({
      transaction: { id: 'tx-1', delete_reason: 'provider duplicate' },
    });
    const queue = await app.request('/api/classify/triage?limit=1&offset=0', { headers });
    await expect(queue.json()).resolves.toEqual({ pending: 0, items: [] });

    const assist = await app.request('/api/classify/assist', {
      method: 'POST',
      headers,
      body: JSON.stringify({ entryType: 'transaction', entryId: 'tx-1' }),
    });
    expect(assist.status).toBe(404);

    const classification = await app.request('/api/transactions/tx-1/classification', {
      method: 'POST',
      headers,
      body: JSON.stringify({}),
    });
    expect(classification.status).toBe(404);
  });

  it('rejects an atomic delete when an explicit selected id is missing', async () => {
    const db = new DatabaseSync(':memory:');
    migrateDatabase(db);
    seedTriageTransaction(db);
    process.env['LOCAL_OPENFINANCE_WEB_TOKEN'] = 'test-token';
    const app = createWebApp({
      db,
      resolved: { config: { storage: { databasePath: ':memory:' }, annotation: {} } } as never,
      jobs: new BackgroundJobManager(),
    });
    const response = await app.request('/api/transactions/tx-1/delete', {
      method: 'POST',
      headers: { Authorization: 'Bearer test-token', 'Content-Type': 'application/json' },
      body: JSON.stringify({ additionalTransactionIds: ['missing'] }),
    });
    expect(response.status).toBe(404);
    expect(db.prepare('SELECT deleted_at FROM transactions WHERE id = ?').get('tx-1')).toEqual({
      deleted_at: null,
    });
  });

  it('does not expose transfer suggestions with a deleted leg', async () => {
    const db = new DatabaseSync(':memory:');
    migrateDatabase(db);
    seedTriageTransaction(db);
    db.prepare(
      `INSERT INTO transactions (id, account_id, occurred_at, amount_cents, currency, description, raw_json, synced_at)
       VALUES ('tx-2', 'acct-1', '2026-06-02T12:00:00.000Z', 1000, 'BRL', 'Other', '{}', '2026-06-10T00:00:00.000Z')`,
    ).run();
    db.prepare(
      `INSERT INTO transfer_link_suggestions (
         source_entry_id, destination_entry_id, kind, confidence, amount_confidence, time_confidence, created_at
       ) VALUES ('tx-1', 'tx-2', 'internal_transfer', 0.9, 1, 1, '2026-06-10T00:00:00.000Z')`,
    ).run();
    db.prepare(
      "UPDATE transactions SET deleted_at = '2026-09-15T12:00:00.000Z' WHERE id = 'tx-2'",
    ).run();
    process.env['LOCAL_OPENFINANCE_WEB_TOKEN'] = 'test-token';
    const app = createWebApp({
      db,
      resolved: { config: { storage: { databasePath: ':memory:' }, annotation: {} } } as never,
      jobs: new BackgroundJobManager(),
    });

    const response = await app.request('/api/transfers/suggestions/tx-1', {
      headers: { Authorization: 'Bearer test-token' },
    });
    await expect(response.json()).resolves.toEqual({ suggestion: null });
  });

  it('rejects every mutation endpoint after a transaction is deleted', async () => {
    const db = new DatabaseSync(':memory:');
    migrateDatabase(db);
    seedTriageTransaction(db);
    db.prepare(
      `INSERT INTO categories (id, name, name_translated, parent_id, raw_json, synced_at)
       VALUES ('cat-1', 'Category 1', 'Category 1', NULL, '{}', '2026-06-10T00:00:00.000Z'),
              ('cat-2', 'Category 2', 'Category 2', NULL, '{}', '2026-06-10T00:00:00.000Z')`,
    ).run();
    db.prepare(
      `INSERT INTO transaction_category_overrides (transaction_id, category_id, updated_at)
       VALUES ('tx-1', 'cat-1', '2026-06-10T00:00:00.000Z')`,
    ).run();
    db.prepare(
      `INSERT INTO credit_card_bills (
         id, account_id, due_date, total_amount_cents, minimum_payment_cents,
         payment_status, currency, raw_json, synced_at
       ) VALUES (
         'bill-1', 'acct-1', '2026-06-15', 10000, 500,
         'OPEN', 'BRL', '{}', '2026-06-10T00:00:00.000Z'
       )`,
    ).run();
    db.prepare(
      "UPDATE transactions SET deleted_at = '2026-09-15T12:00:00.000Z' WHERE id = 'tx-1'",
    ).run();
    process.env['LOCAL_OPENFINANCE_WEB_TOKEN'] = 'test-token';
    const app = createWebApp({
      db,
      resolved: { config: { storage: { databasePath: ':memory:' }, annotation: {} } } as never,
      jobs: new BackgroundJobManager(),
    });
    const headers = { Authorization: 'Bearer test-token', 'Content-Type': 'application/json' };

    const category = await app.request('/api/transactions/tx-1/category-override', {
      method: 'PUT',
      headers,
      body: JSON.stringify({ categoryId: 'cat-2' }),
    });
    const clearCategory = await app.request('/api/transactions/tx-1/category-override', {
      method: 'DELETE',
      headers,
    });
    const billLink = await app.request('/api/transactions/tx-1/bill-link', {
      method: 'POST',
      headers,
      body: JSON.stringify({ billId: 'bill-1' }),
    });
    const triage = await app.request('/api/classify/triage/tx-1/apply', {
      method: 'POST',
      headers,
      body: JSON.stringify({}),
    });
    const annotation = await app.request('/api/classify', {
      method: 'POST',
      headers,
      body: JSON.stringify({ entryType: 'transaction', entryId: 'tx-1', notes: 'Deleted' }),
    });

    expect(category.status).toBe(404);
    expect(clearCategory.status).toBe(404);
    expect(billLink.status).toBe(404);
    expect(triage.status).toBe(404);
    expect(annotation.status).toBe(404);
    expect(
      db
        .prepare(
          `SELECT transaction_id, category_id
           FROM transaction_category_overrides WHERE transaction_id = 'tx-1'`,
        )
        .get(),
    ).toEqual({ transaction_id: 'tx-1', category_id: 'cat-1' });
    expect(db.prepare('SELECT * FROM credit_card_bill_transactions').all()).toEqual([]);
    expect(db.prepare('SELECT * FROM entry_annotations').all()).toEqual([]);
    expect(
      db
        .prepare(
          `SELECT review_status FROM annotation_assist_suggestions
           WHERE entry_type = 'transaction' AND entry_id = 'tx-1'`,
        )
        .get(),
    ).toEqual({ review_status: 'pending' });
  });

  it('normalizes legacy proposals missing labelIds', async () => {
    const db = new DatabaseSync(':memory:');
    migrateDatabase(db);
    seedTriageTransaction(db);
    db.prepare(
      `UPDATE annotation_assist_suggestions SET proposal_json = '{"labelNames":["Old"]}' WHERE entry_id = 'tx-1'`,
    ).run();

    process.env['LOCAL_OPENFINANCE_WEB_TOKEN'] = 'test-token';
    const app = createWebApp({
      db,
      resolved: {
        config: { storage: { databasePath: ':memory:' }, annotation: {} },
      } as never,
      jobs: new BackgroundJobManager(),
    });

    const res = await app.request('/api/classify/triage?limit=1&offset=0', {
      headers: { Authorization: 'Bearer test-token' },
    });
    expect(res.status).toBe(200);
    const queue = (await res.json()) as {
      items: { proposal: { labelIds: string[]; labelNames: string[] } | null }[];
    };
    expect(queue.items[0]?.proposal).toEqual({
      categoryOverrideId: null,
      categoryId: null,
      subCategoryId: null,
      labelIds: [],
      labelNames: ['Old'],
      notes: null,
      reasoning: null,
    });
  });

  it('returns JSON error when proposal_json is malformed', async () => {
    const db = new DatabaseSync(':memory:');
    migrateDatabase(db);
    seedTriageTransaction(db);
    db.prepare(
      `UPDATE annotation_assist_suggestions SET proposal_json = 'not-json' WHERE entry_id = 'tx-1'`,
    ).run();

    process.env['LOCAL_OPENFINANCE_WEB_TOKEN'] = 'test-token';
    const app = createWebApp({
      db,
      resolved: {
        config: { storage: { databasePath: ':memory:' }, annotation: {} },
      } as never,
      jobs: new BackgroundJobManager(),
    });

    const res = await app.request('/api/classify/triage?limit=1&offset=0', {
      headers: { Authorization: 'Bearer test-token' },
    });
    expect(res.status).toBe(500);
    expect(res.headers.get('content-type')).toContain('application/json');
    const body = (await res.json()) as { error: string };
    expect(body.error).toBeTruthy();
  });

  it('does not serve SPA HTML for unknown API routes', async () => {
    process.env['LOCAL_OPENFINANCE_WEB_TOKEN'] = 'test-token';
    const db = new DatabaseSync(':memory:');
    migrateDatabase(db);
    const app = createWebApp({
      db,
      resolved: {
        config: { storage: { databasePath: ':memory:' }, annotation: {} },
      } as never,
      jobs: new BackgroundJobManager(),
    });

    const res = await app.request('/api/this-route-does-not-exist', {
      headers: { Authorization: 'Bearer test-token' },
    });
    expect(res.status).toBe(404);
    expect(res.headers.get('content-type')).toContain('application/json');
    await expect(res.json()).resolves.toEqual({ error: 'Not found' });
  });
});
