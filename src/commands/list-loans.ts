import process from 'node:process';
import type { Argv, CommandModule } from 'yargs';
import { loadConfig } from '../config/load-config.js';
import { openDatabase } from '../db/connection.js';
import { listEnrichedLoans, parseLoanGroupBy } from '../db/loan-details.js';
import { renderLoansTree, serializeLoanForJson } from '../db/loans/present.js';
import { type ConfigArgv, withConfigOption } from './shared.js';

type ListLoansArgv = ConfigArgv & {
  readonly 'group-by'?: string | undefined;
  readonly json?: boolean | undefined;
};

export const listLoansCommand: CommandModule<object, ListLoansArgv> = {
  command: 'list-loans',
  describe: 'list synced loans grouped and formatted for the terminal',
  builder: (argv) =>
    withConfigOption(argv)
      .option('group-by', {
        type: 'string',
        describe:
          'Comma-separated grouping fields: account, type, name (default: account,type,name)',
      })
      .option('json', {
        type: 'boolean',
        default: false,
        describe: 'Print db columns, parsed fields, and raw_json (use to debug amount mapping)',
      }) as Argv<ListLoansArgv>,
  handler: async (argv) => {
    const resolved = await loadConfig(argv.config);
    const { db } = openDatabase(resolved);
    const groupBy = parseLoanGroupBy(argv['group-by']);
    const loans = listEnrichedLoans(db);

    if (argv.json) {
      process.stdout.write(
        `${JSON.stringify(
          {
            total: loans.length,
            group_by: groupBy,
            rows: loans.map((row) => serializeLoanForJson(row)),
          },
          null,
          2,
        )}\n`,
      );
      return;
    }

    process.stdout.write(renderLoansTree(loans, groupBy));
  },
};
