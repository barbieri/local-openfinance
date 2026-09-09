import process from 'node:process';
import type { Argv, CommandModule } from 'yargs';
import { loadConfig } from '../config/load-config.js';
import { openDatabase } from '../db/connection.js';
import {
  listEnrichedTransactions,
  parseTransactionAccountFilter,
  parseTransactionCategoryFilter,
  parseTransactionGroupBy,
  parseTransactionMerchantPattern,
  parseTransactionPaymentTypeFilter,
  parseTransactionStatusFilter,
  resolveLocalTimeZone,
  resolveTransactionDateRange,
} from '../db/transaction-details.js';
import { renderTransactionsTree, serializeTransactionForJson } from '../db/transactions/present.js';
import {
  type ConfigArgv,
  type DateRangeArgv,
  withConfigOption,
  withDateRangeOptions,
} from './shared.js';

type ListTransactionsArgv = ConfigArgv &
  DateRangeArgv & {
    readonly 'group-by'?: string | undefined;
    readonly status?: string | undefined;
    readonly account?: string | undefined;
    readonly 'category-id'?: string | undefined;
    readonly merchant?: string | undefined;
    readonly 'payment-type'?: string | undefined;
    readonly json?: boolean | undefined;
    readonly noTranslate?: boolean | undefined;
  };

export const listTransactionsCommand: CommandModule<object, ListTransactionsArgv> = {
  command: 'list-transactions',
  describe: 'list synced transactions grouped and formatted for the terminal',
  builder: (argv) =>
    withDateRangeOptions(
      withConfigOption(argv)
        .option('group-by', {
          type: 'string',
          describe:
            'Comma-separated grouping fields: account, date (default: account,date; dates oldest first)',
        })
        .option('status', {
          type: 'string',
          describe: 'Status filter: default all; comma-separated values such as POSTED,PENDING',
        })
        .option('account', {
          type: 'string',
          describe: 'Comma-separated account_id values to include',
        })
        .option('category-id', {
          type: 'string',
          describe: 'Comma-separated upstream Open Finance category_id values',
        })
        .option('merchant', {
          type: 'string',
          describe: 'Filter merchant_name by JavaScript regular expression',
        })
        .option('payment-type', {
          type: 'string',
          describe: 'Comma-separated payment_type / operationType values',
        })
        .option('json', {
          type: 'boolean',
          default: false,
          describe: 'Print db columns, parsed fields, and raw_json (use to debug field mapping)',
        })
        .option('no-translate', {
          type: 'boolean',
          default: false,
          describe: 'Show upstream category original name instead of translated name',
        }),
    ).option('date', {
      type: 'string',
      describe:
        'Date shortcut or selector: today, yesterday, tomorrow, this-week, this-month, ytd, last-12-months, YYYY, YYYY-MM, or YYYY-MM-DD',
    }) as Argv<ListTransactionsArgv>,
  handler: async (argv) => {
    const resolved = await loadConfig(argv.config);
    const { db } = openDatabase(resolved);
    const groupBy = parseTransactionGroupBy(argv['group-by']);
    const timeZone = resolveLocalTimeZone();
    const dateRange = resolveTransactionDateRange(argv, timeZone);
    const filters = {
      status: parseTransactionStatusFilter(argv.status),
      accountIds: parseTransactionAccountFilter(argv.account),
      categoryIds: parseTransactionCategoryFilter(argv['category-id']),
      merchantPattern: parseTransactionMerchantPattern(argv.merchant),
      paymentTypes: parseTransactionPaymentTypeFilter(argv['payment-type']),
      ...dateRange,
    };
    const translateCategory = !argv.noTranslate;
    const transactions = listEnrichedTransactions(db, filters, timeZone);

    if (argv.json) {
      process.stdout.write(
        `${JSON.stringify(
          {
            total: transactions.length,
            group_by: groupBy,
            translate_category: translateCategory,
            filters: {
              status: filters.status,
              accountIds: filters.accountIds,
              categoryIds: filters.categoryIds,
              merchantPattern: filters.merchantPattern?.source ?? null,
              paymentTypes: filters.paymentTypes,
              startDate: filters.startDate,
              endDate: filters.endDate,
            },
            time_zone: timeZone,
            rows: transactions.map((row) => serializeTransactionForJson(row, translateCategory)),
          },
          null,
          2,
        )}\n`,
      );
      return;
    }

    process.stdout.write(renderTransactionsTree(transactions, groupBy, { translateCategory }));
  },
};
