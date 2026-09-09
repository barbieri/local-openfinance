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
