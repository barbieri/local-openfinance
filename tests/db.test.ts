import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { connectionsEntity } from '../src/db/list/entities.js';
import { parseFieldFiltersFromArgv } from '../src/db/list/filters.js';
import { runListQuery } from '../src/db/list/query.js';
import { migrateDatabase } from '../src/db/migrate.js';
import { parseAmountToCents } from '../src/openfinance/money.js';

describe('money helpers', () => {
  it('parses decimal strings into cents', () => {
    expect(parseAmountToCents('-12000.00')).toBe(-1_200_000);
    expect(parseAmountToCents('24.00')).toBe(2400);
  });
});

describe('list filters', () => {
  it('parses field operator flags from argv', () => {
    expect(
      parseFieldFiltersFromArgv([
        'node',
        'local-openfinance',
        'list-accounts',
        '--config',
        'x.json',
        '--connector_name.contains=Ita',
        '--balance_cents.gt=1000',
      ]),
    ).toEqual([
      { field: 'connector_name', operator: 'contains', value: 'Ita' },
      { field: 'balance_cents', operator: 'gt', value: '1000' },
    ]);
  });
});

describe('sqlite migrations and list queries', () => {
  it('applies core migration and supports filtered listing', () => {
    const db = new DatabaseSync(':memory:');
    const applied = migrateDatabase(db);
    expect(applied[0]).toBe(1);

    db.prepare(
      `INSERT INTO connections (item_id, connector_id, connector_name, status, raw_json, synced_at)
       VALUES ('item-1', '601', 'Itau', 'UPDATED', '{}', '2026-06-10T00:00:00.000Z')`,
    ).run();

    const result = runListQuery(db, {
      entity: connectionsEntity,
      filters: [{ field: 'connector_name', operator: 'contains', value: 'Ita' }],
      limit: 10,
      offset: 0,
    });

    expect(result.total).toBe(1);
    expect(result.rows[0]?.['connector_name']).toBe('Itau');
  });
});
