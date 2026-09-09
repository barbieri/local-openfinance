import process from 'node:process';
import type { Argv, CommandModule } from 'yargs';
import { loadConfig } from '../config/load-config.js';
import { openDatabase } from '../db/connection.js';
import {
  listEnrichedCreditCardBills,
  parseCreditCardBillGroupBy,
} from '../db/credit-card-bill-details.js';
import {
  renderCreditCardBillsTree,
  serializeCreditCardBillForJson,
} from '../db/credit-card-bills/present.js';
import { parseFieldFiltersFromArgv } from '../db/list/filters.js';
import { type ListArgv, withListOptions } from './list-shared.js';
import { type ConfigArgv, withConfigOption } from './shared.js';

type ListCreditCardBillsArgv = ConfigArgv &
  ListArgv & {
    readonly 'group-by'?: string | undefined;
    readonly json?: boolean | undefined;
  };

export const listCreditCardBillsCommand: CommandModule<object, ListCreditCardBillsArgv> = {
  command: 'list-credit-card-bills',
  describe: 'list synced credit card bills grouped and formatted for the terminal',
  builder: (argv) =>
    withListOptions(
      withConfigOption(argv)
        .option('group-by', {
          type: 'string',
          describe:
            'Comma-separated grouping fields: account, payment_status, due_date (default: account,payment_status)',
        })
        .option('json', {
          type: 'boolean',
          default: false,
          describe: 'Print db columns, parsed fields, and raw_json (use to debug field mapping)',
        }),
    ) as Argv<ListCreditCardBillsArgv>,
  handler: async (argv) => {
    const resolved = await loadConfig(argv.config);
    const { db } = openDatabase(resolved);
    const groupBy = parseCreditCardBillGroupBy(argv['group-by']);
    const { query, bills } = listEnrichedCreditCardBills(db, {
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
            rows: bills.map((row) => serializeCreditCardBillForJson(row)),
          },
          null,
          2,
        )}\n`,
      );
      return;
    }

    process.stdout.write(renderCreditCardBillsTree(bills, groupBy));
  },
};
