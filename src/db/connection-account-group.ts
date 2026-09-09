import type { DatabaseSync } from 'node:sqlite';
import { getConnectionLabel, resolveConnectionDisplayName } from './connection-labels.js';

export function resolveConnectionAccountGroup(
  db: DatabaseSync,
  connectionItemId: string,
): { readonly key: string; readonly label: string } {
  const label = getConnectionLabel(db, connectionItemId);
  const connection = db
    .prepare('SELECT connector_name FROM connections WHERE item_id = ?')
    .get(connectionItemId) as { readonly connector_name: string | null } | undefined;
  const connectorName = connection?.connector_name?.trim() || connectionItemId;
  const accountName =
    label?.name?.trim() || resolveConnectionDisplayName(db, connectionItemId) || connectorName;
  const title = accountName === connectorName ? accountName : `${accountName} (${connectorName})`;

  return {
    key: connectionItemId,
    label: title,
  };
}

export function parseListStatusFilter(value: string | undefined): readonly string[] | 'all' {
  if (!value || value.trim().length === 0) {
    return ['ACTIVE'];
  }

  if (value.trim().toLowerCase() === 'all') {
    return 'all';
  }

  return value
    .split(',')
    .map((part) => part.trim().toUpperCase())
    .filter((part) => part.length > 0);
}

export function matchesListStatusFilter(
  status: string | null,
  statusFilter: readonly string[] | 'all',
): boolean {
  if (statusFilter === 'all') {
    return true;
  }

  const normalized = status?.toUpperCase() ?? 'UNKNOWN';
  return statusFilter.includes(normalized);
}
