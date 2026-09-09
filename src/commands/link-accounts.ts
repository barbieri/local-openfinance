import process from 'node:process';
import { checkbox, select } from '@inquirer/prompts';
import chalk from 'chalk';
import type { Argv, CommandModule } from 'yargs';
import { loadConfig } from '../config/load-config.js';
import {
  formatLinkAccountsWizardResult,
  runLinkAccountsWizard,
} from '../db/account-link-wizard.js';
import {
  dissolveAccountGroup,
  formatLinkableAccountHeadline,
  formatLinkableAccountRecentTransactions,
  getAliasAccountIds,
  linkAccounts,
  listLinkableAccounts,
  unlinkAccountAlias,
} from '../db/account-links.js';
import { openDatabase } from '../db/connection.js';
import { resolveAccountDisplayName } from '../db/connection-labels.js';
import { type ConfigArgv, withConfigOption } from './shared.js';

type LinkAccountsArgv = ConfigArgv & {
  readonly canonical?: string | undefined;
  readonly alias?: readonly string[] | undefined;
  readonly clear?: boolean | undefined;
  readonly unlink?: string | undefined;
  readonly 'recent-limit': number;
};

function hasExplicitLinkAccountsArgs(argv: LinkAccountsArgv): boolean {
  return (
    argv.canonical !== undefined ||
    argv.alias !== undefined ||
    argv.clear === true ||
    argv.unlink !== undefined
  );
}

export const linkAccountsCommand: CommandModule<object, LinkAccountsArgv> = {
  command: 'link-accounts',
  describe: 'merge duplicate synced accounts so only the canonical account is visible and synced',
  builder: (argv) =>
    withConfigOption(argv)
      .option('canonical', {
        type: 'string',
        describe: 'Canonical account id to keep visible',
      })
      .option('alias', {
        type: 'string',
        array: true,
        describe: 'Duplicate account id to hide and stop syncing (repeatable)',
      })
      .option('recent-limit', {
        type: 'number',
        default: 3,
        describe: 'Recent transactions shown when choosing accounts',
      })
      .option('clear', {
        type: 'boolean',
        default: false,
        describe: 'Dissolve the merge group for the canonical account',
      })
      .option('unlink', {
        type: 'string',
        describe: 'Remove one alias account from its merge group',
      }) as Argv<LinkAccountsArgv>,
  handler: async (argv) => {
    const resolved = await loadConfig(argv.config);
    const { db } = openDatabase(resolved);
    const recentLimit = argv['recent-limit'];

    if (!hasExplicitLinkAccountsArgs(argv)) {
      const result = await runLinkAccountsWizard(db, recentLimit);
      process.stdout.write(`${formatLinkAccountsWizardResult(db, result)}\n`);
      return;
    }

    if (argv.unlink) {
      const removed = unlinkAccountAlias(db, argv.unlink);
      process.stdout.write(
        `${removed ? chalk.green('alias unlinked') : chalk.yellow('account is not a merged alias')}\n`,
      );
      return;
    }

    const canonicalAccountId =
      argv.canonical ?? (await promptCanonicalAccountSelection(db, recentLimit));

    if (argv.clear) {
      const removed = dissolveAccountGroup(db, canonicalAccountId);
      process.stdout.write(
        `${removed ? chalk.green('account group dissolved') : chalk.yellow('no group found')}\n`,
      );
      return;
    }

    const aliasAccountIds =
      argv.alias && argv.alias.length > 0
        ? argv.alias
        : await promptAliasAccountSelection(db, canonicalAccountId, recentLimit);

    const group = linkAccounts(db, canonicalAccountId, aliasAccountIds);

    process.stdout.write(
      `${chalk.green('accounts linked')}\n${JSON.stringify(
        {
          canonical_account_id: group.canonicalAccountId,
          display_name: resolveAccountDisplayName(db, group.canonicalAccountId),
          merged_account_ids: getAliasAccountIds(db, group.canonicalAccountId),
          members: group.members,
        },
        null,
        2,
      )}\n`,
    );
  },
};

async function promptCanonicalAccountSelection(
  db: ReturnType<typeof openDatabase>['db'],
  recentLimit: number,
): Promise<string> {
  const accounts = listLinkableAccounts(db).filter((account) => !account.isAlias);
  if (accounts.length === 0) {
    throw new Error('No synced accounts found. Run sync first.');
  }

  return select({
    message: 'Choose the canonical account to keep visible',
    choices: accounts.map((account) => ({
      name: formatLinkableAccountHeadline(db, account),
      description: formatLinkableAccountRecentTransactions(db, account, recentLimit),
      value: account.id,
    })),
  });
}

async function promptAliasAccountSelection(
  db: ReturnType<typeof openDatabase>['db'],
  canonicalAccountId: string,
  recentLimit: number,
): Promise<string[]> {
  const existingAliases = new Set(getAliasAccountIds(db, canonicalAccountId));
  const candidates = listLinkableAccounts(db).filter(
    (account) =>
      account.id !== canonicalAccountId &&
      !account.isCanonical &&
      (account.canonicalAccountId === null || account.canonicalAccountId === canonicalAccountId),
  );

  if (candidates.length === 0) {
    throw new Error('No eligible alias accounts found to merge.');
  }

  return checkbox({
    message: 'Choose duplicate accounts to hide and stop syncing',
    choices: candidates.map((account) => ({
      name: formatLinkableAccountHeadline(db, account),
      description: formatLinkableAccountRecentTransactions(db, account, recentLimit),
      value: account.id,
      checked: existingAliases.has(account.id),
    })),
  });
}
