import process from 'node:process';
import type { Argv, CommandModule } from 'yargs';
import { loadConfig } from '../config/load-config.js';
import { listEnrichedCreditCards, parseCreditCardGroupBy } from '../db/account-list-details.js';
import { openDatabase } from '../db/connection.js';
import { renderCreditCardsTree, serializeCreditCardForJson } from '../db/credit-cards/present.js';
import { parseFieldFiltersFromArgv } from '../db/list/filters.js';
import { type ListArgv, withListOptions } from './list-shared.js';
import { type ConfigArgv, withConfigOption } from './shared.js';

type ListCreditCardsArgv = ConfigArgv &
  ListArgv & {
    readonly 'group-by'?: string | undefined;
    readonly json?: boolean | undefined;
  };

export const listCreditCardsCommand: CommandModule<object, ListCreditCardsArgv> = {
  command: 'list-credit-cards',
  describe: 'list synced credit card accounts grouped and formatted for the terminal',
  builder: (argv) =>
    withListOptions(
      withConfigOption(argv)
        .option('group-by', {
          type: 'string',
          describe: 'Comma-separated grouping fields: account, subtype (default: account,subtype)',
        })
        .option('json', {
          type: 'boolean',
          default: false,
          describe: 'Print db columns, parsed fields, and raw_json (use to debug field mapping)',
        }),
    ) as Argv<ListCreditCardsArgv>,
  handler: async (argv) => {
    const resolved = await loadConfig(argv.config);
    const { db } = openDatabase(resolved);
    const groupBy = parseCreditCardGroupBy(argv['group-by']);
    const { query, creditCards } = listEnrichedCreditCards(db, {
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
            rows: creditCards.map((row) => serializeCreditCardForJson(row)),
          },
          null,
          2,
        )}\n`,
      );
      return;
    }

    process.stdout.write(renderCreditCardsTree(creditCards, groupBy));
  },
};
