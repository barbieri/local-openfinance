import process from 'node:process';
import type { Argv, CommandModule } from 'yargs';
import { loadConfig } from '../config/load-config.js';
import { openDatabase } from '../db/connection.js';
import { listEnrichedConnections, parseConnectionGroupBy } from '../db/connection-list-details.js';
import { renderConnectionsTree, serializeConnectionForJson } from '../db/connections/present.js';
import { parseFieldFiltersFromArgv } from '../db/list/filters.js';
import { type ListArgv, withListOptions } from './list-shared.js';
import { type ConfigArgv, withConfigOption } from './shared.js';

type ListConnectionsArgv = ConfigArgv &
  ListArgv & {
    readonly 'group-by'?: string | undefined;
    readonly json?: boolean | undefined;
  };

export const listConnectionsCommand: CommandModule<object, ListConnectionsArgv> = {
  command: 'list-connections',
  describe: 'list synced bank connections grouped and formatted for the terminal',
  builder: (argv) =>
    withListOptions(
      withConfigOption(argv)
        .option('group-by', {
          type: 'string',
          describe: 'Comma-separated grouping fields: connector, status (default: connector)',
        })
        .option('json', {
          type: 'boolean',
          default: false,
          describe: 'Print db columns, parsed fields, and label metadata',
        }),
    ) as Argv<ListConnectionsArgv>,
  handler: async (argv) => {
    const resolved = await loadConfig(argv.config);
    const { db } = openDatabase(resolved);
    const groupBy = parseConnectionGroupBy(argv['group-by']);
    const { query, connections } = listEnrichedConnections(db, {
      filters: parseFieldFiltersFromArgv(process.argv),
      limit: argv.limit,
      offset: argv.offset,
    });

    if (argv.json) {
      process.stdout.write(
        `${JSON.stringify(
          {
            total: query.total,
            limit: query.limit,
            offset: query.offset,
            group_by: groupBy,
            rows: connections.map((row) => serializeConnectionForJson(row)),
          },
          null,
          2,
        )}\n`,
      );
      return;
    }

    process.stdout.write(renderConnectionsTree(connections, groupBy));
  },
};
