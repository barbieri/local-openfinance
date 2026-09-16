import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { migrateDatabase } from '../src/db/migrate.js';
import { BackgroundJobManager } from '../src/web/server/background-jobs.js';
import { createWebApp } from '../src/web/server/server.js';

const TOKEN = 'investment-web-api-test-token';

afterEach(() => {
  delete process.env['LOCAL_OPENFINANCE_WEB_TOKEN'];
});

function createApp(): ReturnType<typeof createWebApp> {
  const db = new DatabaseSync(':memory:');
  migrateDatabase(db);
  db.prepare(
    `INSERT INTO connections (item_id, connector_id, connector_name, status, raw_json, synced_at)
     VALUES ('item-1', '601', 'Itaú', 'UPDATED', '{}', '2026-06-10T00:00:00.000Z')`,
  ).run();
  db.prepare(
    `INSERT INTO investments (
      id, connection_item_id, type, subtype, name, code, balance_cents, currency, raw_json, synced_at
    ) VALUES (
      'inv-1', 'item-1', 'FIXED_INCOME', 'CDB', 'CDB Test', 'CDBT11', 12345, 'BRL',
      '{"status":"ACTIVE","quantity":12,"amount":"123.45","issuer":"Issuer"}',
      '2026-06-10T00:00:00.000Z'
    )`,
  ).run();
  db.prepare(
    `INSERT INTO investments (
      id, connection_item_id, type, subtype, name, code, balance_cents, currency, raw_json, synced_at
    ) VALUES (
      'inv-2', 'item-1', 'FIXED_INCOME', 'CDB', 'CDB Active', 'CDBA11', 67890, 'BRL',
      '{"status":"ACTIVE","quantity":6,"amount":"678.90","issuer":"Issuer"}',
      '2026-06-10T00:00:00.000Z'
    )`,
  ).run();
  db.prepare(
    `INSERT INTO investment_transactions (
      id, investment_id, occurred_at, type, amount_cents, currency, raw_json, synced_at
    ) VALUES ('movement-1', 'inv-1', '2026-06-01T00:00:00.000Z', 'BUY', 12345, 'BRL', '{}', '2026-06-10T00:00:00.000Z')`,
  ).run();
  process.env['LOCAL_OPENFINANCE_WEB_TOKEN'] = TOKEN;
  return createWebApp({
    db,
    resolved: { config: { storage: { databasePath: ':memory:' }, annotation: {} } } as never,
    jobs: new BackgroundJobManager(),
  });
}

describe('investment detail web API', () => {
  it('returns a rich direct detail and preserves it after soft deletion', async () => {
    const app = createApp();
    const headers = { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' };

    const detail = await app.request('/api/investments/inv-1', { headers });
    expect(detail.status).toBe(200);
    await expect(detail.json()).resolves.toMatchObject({
      investment: {
        db: { id: 'inv-1', balance_cents: 12345, deleted_at: null },
        parsed: { status: 'ACTIVE', quantity: 12, issuer: 'Issuer' },
        raw_json: { amount: '123.45' },
      },
    });

    const deleted = await app.request('/api/investments/inv-1/delete', {
      method: 'POST',
      headers,
      body: JSON.stringify({ deleteReason: 'provider duplicate' }),
    });
    expect(deleted.status).toBe(200);
    await expect(deleted.json()).resolves.toMatchObject({
      requestedIds: ['inv-1'],
      newlyDeletedIds: ['inv-1'],
    });

    const deletedDetail = await app.request('/api/investments/inv-1', { headers });
    expect(deletedDetail.status).toBe(200);
    await expect(deletedDetail.json()).resolves.toMatchObject({
      investment: { db: { id: 'inv-1', delete_reason: 'provider duplicate' } },
    });
    const hidden = await app.request('/api/investments?status=all', { headers });
    await expect(hidden.json()).resolves.toMatchObject({ rows: [{ id: 'inv-2' }] });

    const invalid = await app.request('/api/investments?status=all&deleted=invalid', { headers });
    await expect(invalid.json()).resolves.toMatchObject({ rows: [{ id: 'inv-2' }] });

    const all = await app.request('/api/investments?status=ACTIVE&deleted=all', { headers });
    const allBody = (await all.json()) as { rows: unknown[] };
    expect(allBody.rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'inv-1',
          deleted_at: expect.any(String),
          delete_reason: 'provider duplicate',
        }),
        expect.objectContaining({ id: 'inv-2', deleted_at: null, delete_reason: null }),
      ]),
    );

    const only = await app.request('/api/investments?status=ACTIVE&deleted=only', { headers });
    await expect(only.json()).resolves.toMatchObject({ rows: [{ id: 'inv-1' }] });
  });

  it('validates the delete body and returns 404 for a missing investment', async () => {
    const app = createApp();
    const headers = { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' };

    const invalid = await app.request('/api/investments/inv-1/delete', {
      method: 'POST',
      headers,
      body: JSON.stringify({ deleteReason: 1 }),
    });
    expect(invalid.status).toBe(400);

    const missingDetail = await app.request('/api/investments/missing', { headers });
    expect(missingDetail.status).toBe(404);

    const missing = await app.request('/api/investments/missing/delete', {
      method: 'POST',
      headers,
      body: JSON.stringify({}),
    });
    expect(missing.status).toBe(404);
  });

  it('restores a deleted investment to normal views without changing its imported data', async () => {
    const app = createApp();
    const headers = { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' };
    const initialDetail = await app.request('/api/investments/inv-1', { headers });
    const initialBody = (await initialDetail.json()) as {
      readonly investment: { readonly raw_json: unknown };
    };

    const deleted = await app.request('/api/investments/inv-1/delete', {
      method: 'POST',
      headers,
      body: JSON.stringify({ deleteReason: 'provider duplicate' }),
    });
    expect(deleted.status).toBe(200);

    const restored = await app.request('/api/investments/inv-1/restore', {
      method: 'POST',
      headers,
    });
    expect(restored.status).toBe(200);
    await expect(restored.json()).resolves.toEqual({ investmentId: 'inv-1', restored: true });

    const restoredDetail = await app.request('/api/investments/inv-1', { headers });
    await expect(restoredDetail.json()).resolves.toMatchObject({
      investment: {
        db: { deleted_at: null, delete_reason: null },
        raw_json: initialBody.investment.raw_json,
      },
    });
    const visible = await app.request('/api/investments?status=all', { headers });
    const visibleBody = (await visible.json()) as { readonly rows: unknown[] };
    expect(visibleBody.rows).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 'inv-1' })]),
    );

    const retried = await app.request('/api/investments/inv-1/restore', {
      method: 'POST',
      headers,
    });
    await expect(retried.json()).resolves.toEqual({ investmentId: 'inv-1', restored: false });

    const missing = await app.request('/api/investments/missing/restore', {
      method: 'POST',
      headers,
    });
    expect(missing.status).toBe(404);
    await expect(missing.json()).resolves.toMatchObject({ error: 'Investment not found' });
  });
});
