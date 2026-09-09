import process from 'node:process';
import { input, select } from '@inquirer/prompts';
import chalk from 'chalk';
import type { Argv, CommandModule } from 'yargs';
import { loadConfig } from '../config/load-config.js';
import { formatAccountTypeSubtype } from '../db/account-details.js';
import {
  deleteAccountLabel,
  listLabelableAccounts,
  upsertAccountLabel,
} from '../db/account-labels.js';
import { openDatabase } from '../db/connection.js';
import {
  formatConnectionRecentTransactions,
  listAccountRecentTransactions,
  resolveAccountDisplayName,
  resolveConnectionDisplayName,
} from '../db/connection-labels.js';
import { type ConfigArgv, withConfigOption } from './shared.js';

type LabelAccountArgv = ConfigArgv & {
  readonly 'account-id'?: string | undefined;
  readonly name?: string | undefined;
  readonly clear?: boolean | undefined;
  readonly 'recent-limit': number;
};

export const labelAccountCommand: CommandModule<object, LabelAccountArgv> = {
  command: 'label-account',
  describe: 'set a friendly display name for a synced account',
  builder: (argv) =>
    withConfigOption(argv)
      .option('account-id', {
        type: 'string',
        describe: 'Account id to label',
      })
      .option('name', {
        type: 'string',
        describe: 'Friendly display name shown in lists and transaction output',
      })
      .option('recent-limit', {
        type: 'number',
        default: 5,
        describe: 'Recent transactions shown when choosing an account',
      })
      .option('clear', {
        type: 'boolean',
        default: false,
        describe: 'Remove the manual label for the selected account',
      }) as Argv<LabelAccountArgv>,
  handler: async (argv) => {
    const resolved = await loadConfig(argv.config);
    const { db } = openDatabase(resolved);
    const recentLimit = argv['recent-limit'];

    const accountId = argv['account-id'] ?? (await promptAccountSelection(db, recentLimit));
    if (argv.clear) {
      const removed = deleteAccountLabel(db, accountId);
      process.stdout.write(
        `${removed ? chalk.green('label removed') : chalk.yellow('no label found')}\n`,
      );
      return;
    }

    printAccountRecentTransactions(db, accountId, recentLimit);

    const label =
      argv.name !== undefined
        ? upsertAccountLabel(db, accountId, argv.name)
        : await promptAccountLabel(db, accountId);

    process.stdout.write(
      `${chalk.green('label saved')}\n${JSON.stringify(
        {
          account_id: label.accountId,
          name: label.name,
          display_name: resolveAccountDisplayName(db, accountId),
        },
        null,
        2,
      )}\n`,
    );
  },
};

async function promptAccountSelection(
  db: ReturnType<typeof openDatabase>['db'],
  recentLimit: number,
): Promise<string> {
  const accounts = listLabelableAccounts(db);
  if (accounts.length === 0) {
    throw new Error('No synced accounts found. Run sync first.');
  }

  return select({
    message: 'Choose an account to label',
    choices: accounts.map((account) => ({
      name: formatAccountSelectionHeadline(db, account),
      description: formatConnectionRecentTransactions(
        listAccountRecentTransactions(db, account.id, recentLimit),
      ),
      value: account.id,
    })),
  });
}

function formatAccountSelectionHeadline(
  db: ReturnType<typeof openDatabase>['db'],
  account: ReturnType<typeof listLabelableAccounts>[number],
): string {
  const displayName = resolveAccountDisplayName(db, account.id);
  const connectionName =
    resolveConnectionDisplayName(db, account.connectionItemId) ??
    account.connectorName ??
    account.connectionItemId;
  const typeSubtype = formatAccountTypeSubtype(account.type, account.subtype);
  return `${displayName} · ${typeSubtype} · ${connectionName}`;
}

function printAccountRecentTransactions(
  db: ReturnType<typeof openDatabase>['db'],
  accountId: string,
  recentLimit: number,
): void {
  const transactions = listAccountRecentTransactions(db, accountId, recentLimit);
  process.stdout.write(`${chalk.dim('Recent transactions')}\n`);
  process.stdout.write(`${formatConnectionRecentTransactions(transactions)}\n\n`);
}

async function promptAccountLabel(db: ReturnType<typeof openDatabase>['db'], accountId: string) {
  const existing = listLabelableAccounts(db).find((row) => row.id === accountId)?.label;

  const name = await input({
    message: 'Display name',
    default: existing?.name ?? resolveAccountDisplayName(db, accountId),
  });

  return upsertAccountLabel(db, accountId, name);
}
