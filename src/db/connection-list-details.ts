import type { DatabaseSync } from 'node:sqlite';
import { readFieldString } from '../openfinance/money.js';
import { enrichListRows } from './connection-labels.js';
import { parseGroupByFields } from './grouped-list.js';
import { connectionsEntity } from './list/entities.js';
import { runListQuery } from './list/query.js';
import type { FieldFilter, ListQueryResult } from './list/types.js';

export const DEFAULT_CONNECTION_GROUP_BY = ['connector'] as const;

export const CONNECTION_GROUP_BY_FIELDS = ['connector', 'status'] as const;

export type ConnectionGroupByField = (typeof CONNECTION_GROUP_BY_FIELDS)[number];

export type ConnectionRow = {
  readonly item_id: string;
  readonly connector_id: string | null;
  readonly connector_name: string | null;
  readonly status: string | null;
  readonly synced_at: string;
};

export type EnrichedConnection = ConnectionRow & {
  readonly display_name: string | null;
  readonly label_name: string | null;
  readonly branch: string | null;
  readonly account: string | null;
  readonly upstream_connector_id: string | null;
  readonly upstream_connector_name: string | null;
};

export function parseConnectionGroupBy(value: string | undefined): ConnectionGroupByField[] {
  return parseGroupByFields(value, CONNECTION_GROUP_BY_FIELDS, DEFAULT_CONNECTION_GROUP_BY);
}

export function listEnrichedConnections(
  db: DatabaseSync,
  options: {
    readonly filters?: readonly FieldFilter[] | undefined;
    readonly limit?: number | undefined;
    readonly offset?: number | undefined;
  } = {},
): { readonly query: ListQueryResult; readonly connections: readonly EnrichedConnection[] } {
  const query = runListQuery(db, {
    entity: connectionsEntity,
    filters: options.filters ?? [],
    limit: options.limit ?? 50,
    offset: options.offset ?? 0,
  });

  return {
    query,
    connections: mapEnrichedConnectionRows(db, query.rows),
  };
}

export function mapEnrichedConnectionRows(
  db: DatabaseSync,
  rows: readonly Record<string, unknown>[],
): EnrichedConnection[] {
  return enrichListRows(db, connectionsEntity.name, rows).map((row) => toEnrichedConnection(row));
}

function toEnrichedConnection(row: Record<string, unknown>): EnrichedConnection {
  const connectionRow = readConnectionRow(row);

  return {
    ...connectionRow,
    display_name: typeof row['display_name'] === 'string' ? row['display_name'] : null,
    label_name: readFieldString(row, 'label_name'),
    branch: readFieldString(row, 'branch'),
    account: readFieldString(row, 'account'),
    upstream_connector_id:
      readFieldString(row, 'upstream_connector_id') ?? connectionRow.connector_id,
    upstream_connector_name:
      readFieldString(row, 'upstream_connector_name') ?? connectionRow.connector_name,
  };
}

function readConnectionRow(row: Record<string, unknown>): ConnectionRow {
  return {
    item_id: String(row['item_id']),
    connector_id: readFieldString(row, 'connector_id'),
    connector_name: readFieldString(row, 'connector_name'),
    status: readFieldString(row, 'status'),
    synced_at: String(row['synced_at'] ?? ''),
  };
}

export function resolveConnectionGroupKey(
  connection: EnrichedConnection,
  field: ConnectionGroupByField,
): { readonly key: string; readonly label: string } {
  switch (field) {
    case 'connector': {
      const connectorId = connection.upstream_connector_id ?? 'unknown';
      const connectorName = connection.upstream_connector_name ?? 'Unknown connector';
      return {
        key: `${connectorId}:${connectorName}`,
        label: connection.upstream_connector_id
          ? `${connectorName} (${connection.upstream_connector_id})`
          : connectorName,
      };
    }
    case 'status':
      return {
        key: connection.status ?? 'UNKNOWN',
        label: connection.status ?? 'UNKNOWN',
      };
    default:
      return { key: 'UNKNOWN', label: 'UNKNOWN' };
  }
}
