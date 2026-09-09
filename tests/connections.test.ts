import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { upsertConnectionLabel } from '../src/db/connection-labels.js';
import {
  listEnrichedConnections,
  parseConnectionGroupBy,
} from '../src/db/connection-list-details.js';
import {
  renderConnectionsTree,
  serializeConnectionForJson,
} from '../src/db/connections/present.js';
import { migrateDatabase } from '../src/db/migrate.js';

function seedConnection(
  db: DatabaseSync,
  input: {
    readonly itemId: string;
    readonly connectorId?: string | undefined;
    readonly connectorName?: string | undefined;
    readonly status?: string | undefined;
  },
): void {
  db.prepare(
    `INSERT INTO connections (item_id, connector_id, connector_name, status, raw_json, synced_at)
     VALUES (?, ?, ?, ?, '{}', '2026-06-10T00:00:00.000Z')`,
  ).run(
    input.itemId,
    input.connectorId ?? '601',
    input.connectorName ?? 'Itaú',
    input.status ?? 'UPDATED',
  );
}

describe('connection list details', () => {
  it('defaults group-by to connector', () => {
    expect(parseConnectionGroupBy(undefined)).toEqual(['connector']);
  });

  it('renders display name, branch/account, connector, and status prominently', () => {
    const db = new DatabaseSync(':memory:');
    migrateDatabase(db);

    seedConnection(db, { itemId: 'item-1' });
    seedConnection(db, { itemId: 'item-2', status: 'OUTDATED' });

    upsertConnectionLabel(db, 'item-1', {
      branch: '1234',
      account: '56789-0',
      name: 'Itaú Personal',
    });

    const { connections } = listEnrichedConnections(db, { limit: 10, offset: 0 });
    const output = renderConnectionsTree(connections, parseConnectionGroupBy(undefined));

    expect(output).toContain('Itaú Personal');
    expect(output).toContain('ag 1234');
    expect(output).toContain('cc 56789-0');
    expect(output).toContain('Itaú (601)');
    expect(output).toContain('UPDATED');
    expect(output).toContain('OUTDATED');
    expect(output).toContain('item-1');
  });

  it('serializes db and parsed sections for debugging', () => {
    const db = new DatabaseSync(':memory:');
    migrateDatabase(db);

    seedConnection(db, { itemId: 'item-1' });
    upsertConnectionLabel(db, 'item-1', {
      branch: '1234',
      account: '56789-0',
      name: 'Itaú Personal',
    });

    const { connections } = listEnrichedConnections(db, { limit: 10, offset: 0 });
    const [connection] = connections;
    if (!connection) {
      throw new Error('expected seeded connection');
    }

    const json = serializeConnectionForJson(connection);
    expect(json['db']).toMatchObject({
      item_id: 'item-1',
      connector_id: '601',
      connector_name: 'Itaú Personal',
      status: 'UPDATED',
    });
    expect(json['parsed']).toMatchObject({
      label_name: 'Itaú Personal',
      branch: '1234',
      account: '56789-0',
      upstream_connector_id: '601',
      upstream_connector_name: 'Itaú',
    });
  });
});
