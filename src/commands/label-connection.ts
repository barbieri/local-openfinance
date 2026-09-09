import process from 'node:process';
import { input, select } from '@inquirer/prompts';
import chalk from 'chalk';
import type { Argv, CommandModule } from 'yargs';
import { loadConfig } from '../config/load-config.js';
import { openDatabase } from '../db/connection.js';
import {
  deleteConnectionLabel,
  formatConnectionLabel,
  formatConnectionRecentTransactions,
  formatConnectionSelectionHeadline,
  listConnectionRecentTransactions,
  listLabeledConnections,
  resolveConnectionDisplayName,
  upsertConnectionLabel,
} from '../db/connection-labels.js';
import { type ConfigArgv, withConfigOption } from './shared.js';

type LabelConnectionArgv = ConfigArgv & {
  readonly 'item-id'?: string | undefined;
  readonly branch?: string | undefined;
  readonly account?: string | undefined;
  readonly name?: string | undefined;
  readonly clear?: boolean | undefined;
  readonly 'recent-limit': number;
};

export const labelConnectionCommand: CommandModule<object, LabelConnectionArgv> = {
  command: 'label-connection',
  describe: 'set branch, account, and display name for a synced bank connection',
  builder: (argv) =>
    withConfigOption(argv)
      .option('item-id', {
        type: 'string',
        describe: 'Connection item_id to label',
      })
      .option('branch', {
        type: 'string',
        describe: 'Bank branch (agência)',
      })
      .option('account', {
        type: 'string',
        describe: 'Bank account number',
      })
      .option('name', {
        type: 'string',
        describe: 'Friendly display name shown instead of connector metadata',
      })
      .option('recent-limit', {
        type: 'number',
        default: 5,
        describe: 'Recent transactions shown when choosing a connection',
      })
      .option('clear', {
        type: 'boolean',
        default: false,
        describe: 'Remove the manual label for the selected connection',
      }) as Argv<LabelConnectionArgv>,
  handler: async (argv) => {
    const resolved = await loadConfig(argv.config);
    const { db } = openDatabase(resolved);
    const recentLimit = argv['recent-limit'];

    const itemId = argv['item-id'] ?? (await promptConnectionSelection(db, recentLimit));
    if (argv.clear) {
      const removed = deleteConnectionLabel(db, itemId);
      process.stdout.write(
        `${removed ? chalk.green('label removed') : chalk.yellow('no label found')}\n`,
      );
      return;
    }

    printConnectionRecentTransactions(db, itemId, recentLimit);

    const hasExplicitFields =
      argv.branch !== undefined || argv.account !== undefined || argv.name !== undefined;

    const label = hasExplicitFields
      ? upsertConnectionLabel(db, itemId, {
          branch: argv.branch,
          account: argv.account,
          name: argv.name,
        })
      : await promptConnectionLabel(db, itemId);

    process.stdout.write(
      `${chalk.green('label saved')}\n${JSON.stringify(
        {
          item_id: label.itemId,
          branch: label.branch,
          account: label.account,
          name: label.name,
          display_name: formatConnectionLabel(label) ?? resolveConnectionDisplayName(db, itemId),
        },
        null,
        2,
      )}\n`,
    );
  },
};

async function promptConnectionSelection(
  db: ReturnType<typeof openDatabase>['db'],
  recentLimit: number,
): Promise<string> {
  const connections = listLabeledConnections(db);
  if (connections.length === 0) {
    throw new Error('No synced connections found. Run sync first.');
  }

  return select({
    message: 'Choose a connection to label',
    choices: connections.map((connection) => ({
      name: formatConnectionSelectionHeadline(db, connection),
      description: formatConnectionRecentTransactions(
        listConnectionRecentTransactions(db, connection.itemId, recentLimit),
      ),
      value: connection.itemId,
    })),
  });
}

function printConnectionRecentTransactions(
  db: ReturnType<typeof openDatabase>['db'],
  itemId: string,
  recentLimit: number,
): void {
  const transactions = listConnectionRecentTransactions(db, itemId, recentLimit);
  process.stdout.write(`${chalk.dim('Recent transactions')}\n`);
  process.stdout.write(`${formatConnectionRecentTransactions(transactions)}\n\n`);
}

async function promptConnectionLabel(db: ReturnType<typeof openDatabase>['db'], itemId: string) {
  const existing = listLabeledConnections(db).find((row) => row.itemId === itemId)?.label;
  const displayDefault = existing?.name ?? resolveConnectionDisplayName(db, itemId) ?? '';

  const { branch, account, name } = await (
    [
      ['branch', 'Branch (agência)', existing?.branch ?? ''],
      ['account', 'Account number', existing?.account ?? ''],
      ['name', 'Display name', displayDefault],
    ] as const
  ).reduce(
    (fieldsPromise, [key, message, defaultValue]) =>
      fieldsPromise.then(async (fields) => {
        const value = await input({ message, default: defaultValue });
        return { ...fields, [key]: value };
      }),
    Promise.resolve({ branch: '', account: '', name: '' }),
  );

  return upsertConnectionLabel(db, itemId, { branch, account, name });
}
