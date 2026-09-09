import process from 'node:process';
import type { Argv, CommandModule } from 'yargs';
import { loadConfig } from '../config/load-config.js';
import { enrichAccountLinksListRows } from '../db/account-links.js';
import { openDatabase } from '../db/connection.js';
import { enrichListRows } from '../db/connection-labels.js';
import { parseFieldFiltersFromArgv } from '../db/list/filters.js';
import { runListQuery } from '../db/list/query.js';
import type { ListEntityDefinition } from '../db/list/types.js';
import { type ConfigArgv, withConfigOption } from './shared.js';

export type ListArgv = ConfigArgv & {
  readonly limit: number;
  readonly offset: number;
};

export function withListOptions(argv: Argv): Argv<ListArgv> {
  return argv
    .option('limit', {
      type: 'number',
      default: 50,
      describe: 'Maximum rows to return',
    })
    .option('offset', {
      type: 'number',
      default: 0,
      describe: 'Number of rows to skip',
    }) as Argv<ListArgv>;
}

export function createListCommand(
  command: string,
  describe: string,
  entity: ListEntityDefinition,
): CommandModule<object, ListArgv> {
  return {
    command,
    describe,
    builder: (argv) => withListOptions(withConfigOption(argv)),
    handler: async (argv) => {
      const resolved = await loadConfig(argv.config);
      const { db } = openDatabase(resolved);

      const result = runListQuery(db, {
        entity,
        filters: parseFieldFiltersFromArgv(process.argv),
        limit: argv.limit,
        offset: argv.offset,
      });

      process.stdout.write(
        `${JSON.stringify(
          {
            ...result,
            rows: enrichAccountLinksListRows(
              db,
              entity.name,
              enrichListRows(db, entity.name, result.rows),
            ),
          },
          null,
          2,
        )}\n`,
      );
    },
  };
}
