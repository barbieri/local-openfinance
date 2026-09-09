import chalk from 'chalk';
import type { ConnectionGroupByField, EnrichedConnection } from '../connection-list-details.js';
import { resolveConnectionGroupKey } from '../connection-list-details.js';
import { renderGroupedList } from '../grouped-list.js';

export function renderConnectionsTree(
  connections: readonly EnrichedConnection[],
  groupBy: readonly ConnectionGroupByField[],
): string {
  return renderGroupedList({
    items: connections,
    groupBy,
    resolveGroupKey: (connection, field) =>
      resolveConnectionGroupKey(connection, field as ConnectionGroupByField),
    formatLabel: formatConnectionLabel,
    formatLine: formatConnectionLine,
    emptyMessage: chalk.dim('No connections matched the current filters.'),
  });
}

function formatConnectionLabel(connection: EnrichedConnection): string {
  return formatConnectionHeadline(connection);
}

function formatConnectionLine(connection: EnrichedConnection, nameWidth: number): string {
  const displayName = chalk.bold.white(formatConnectionHeadline(connection).padEnd(nameWidth, ' '));
  const branchAccount = formatConnectionBranchAccount(connection.branch, connection.account);
  const connector = formatUpstreamConnector(
    connection.upstream_connector_id,
    connection.upstream_connector_name,
  );
  const status = formatConnectionStatus(connection.status);
  const itemId = chalk.dim(connection.item_id);

  return `${displayName}  ${branchAccount}  ${connector}  ${status}  ${itemId}`;
}

function formatConnectionHeadline(connection: EnrichedConnection): string {
  if (connection.label_name) {
    return connection.label_name;
  }

  return connection.display_name ?? connection.item_id;
}

function formatConnectionBranchAccount(branch: string | null, account: string | null): string {
  const parts: string[] = [];
  if (branch) {
    parts.push(chalk.yellow(`ag ${branch}`));
  }
  if (account) {
    parts.push(chalk.yellow(`cc ${account}`));
  }

  if (parts.length > 0) {
    return parts.join(chalk.dim(' · '));
  }

  return chalk.dim('—');
}

function formatUpstreamConnector(connectorId: string | null, connectorName: string | null): string {
  if (connectorName && connectorId) {
    return chalk.cyan(`${connectorName} (${connectorId})`);
  }

  if (connectorName) {
    return chalk.cyan(connectorName);
  }

  if (connectorId) {
    return chalk.cyan(connectorId);
  }

  return chalk.dim('—');
}

function formatConnectionStatus(status: string | null): string {
  if (!status) {
    return chalk.dim('—');
  }

  if (status === 'UPDATED' || status === 'ACTIVE') {
    return chalk.green(status);
  }

  return chalk.yellow.bold(status);
}

export function serializeConnectionForJson(
  connection: EnrichedConnection,
): Record<string, unknown> {
  return {
    db: {
      item_id: connection.item_id,
      connector_id: connection.connector_id,
      connector_name: connection.connector_name,
      status: connection.status,
      synced_at: connection.synced_at,
    },
    parsed: {
      display_name: connection.display_name,
      label_name: connection.label_name,
      branch: connection.branch,
      account: connection.account,
      upstream_connector_id: connection.upstream_connector_id,
      upstream_connector_name: connection.upstream_connector_name,
    },
  };
}
