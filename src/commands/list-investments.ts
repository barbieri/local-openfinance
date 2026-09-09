import process from 'node:process';
import type { Argv, CommandModule } from 'yargs';
import { loadConfig } from '../config/load-config.js';
import { openDatabase } from '../db/connection.js';
import {
  listEnrichedInvestments,
  parseInvestmentGroupBy,
  parseInvestmentStatusFilter,
} from '../db/investment-details.js';
import { renderInvestmentsTree, serializeInvestmentForJson } from '../db/investments/present.js';
import { type ConfigArgv, withConfigOption } from './shared.js';

type ListInvestmentsArgv = ConfigArgv & {
  readonly 'group-by'?: string | undefined;
  readonly status?: string | undefined;
  readonly json?: boolean | undefined;
};

export const listInvestmentsCommand: CommandModule<object, ListInvestmentsArgv> = {
  command: 'list-investments',
  describe: 'list synced investments grouped and formatted for the terminal',
  builder: (argv) =>
    withConfigOption(argv)
      .option('group-by', {
        type: 'string',
        describe:
          'Comma-separated grouping fields: account, type, subtype, name (default: account,type,subtype,name)',
      })
      .option('status', {
        type: 'string',
        describe:
          'Status filter: default ACTIVE; use all or comma-separated values such as ACTIVE,TOTAL_WITHDRAWAL',
      })
      .option('json', {
        type: 'boolean',
        default: false,
        describe: 'Print db columns, parsed fields, and raw_json (use to debug amount mapping)',
      }) as Argv<ListInvestmentsArgv>,
  handler: async (argv) => {
    const resolved = await loadConfig(argv.config);
    const { db } = openDatabase(resolved);
    const groupBy = parseInvestmentGroupBy(argv['group-by']);
    const statusFilter = parseInvestmentStatusFilter(argv.status);
    const investments = listEnrichedInvestments(db, statusFilter);

    if (argv.json) {
      process.stdout.write(
        `${JSON.stringify(
          {
            total: investments.length,
            group_by: groupBy,
            status: statusFilter,
            rows: investments.map((row) => serializeInvestmentForJson(row)),
          },
          null,
          2,
        )}\n`,
      );
      return;
    }

    process.stdout.write(renderInvestmentsTree(investments, groupBy));
  },
};
