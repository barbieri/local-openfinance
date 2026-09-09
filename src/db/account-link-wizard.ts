import type { DatabaseSync } from 'node:sqlite';
import { checkbox, confirm, select } from '@inquirer/prompts';
import chalk from 'chalk';
import {
  dissolveAccountGroup,
  findSuggestedDuplicateGroups,
  formatAccountIdentitySummary,
  formatLinkableAccountHeadline,
  formatLinkableAccountRecentTransactions,
  getAliasAccountIds,
  type LinkableAccountRow,
  type LinkedAccountGroupSummary,
  linkAccounts,
  listLinkableAccounts,
  listLinkedAccountGroups,
  type SuggestedDuplicateGroup,
  unlinkAccountAlias,
} from './account-links.js';
import { resolveAccountDisplayName } from './connection-labels.js';

const EXIT_CHOICE = '__exit__';

export type LinkAccountsWizardResult =
  | { readonly action: 'none'; readonly reason?: 'exit' | 'empty' | undefined }
  | {
      readonly action: 'linked';
      readonly canonicalAccountId: string;
      readonly aliasAccountIds: readonly string[];
    }
  | { readonly action: 'dissolved'; readonly canonicalAccountId: string }
  | { readonly action: 'unlinked'; readonly aliasAccountIds: readonly string[] };

export async function runLinkAccountsWizard(
  db: DatabaseSync,
  recentLimit: number,
): Promise<LinkAccountsWizardResult> {
  const suggestions = findSuggestedDuplicateGroups(db);
  if (suggestions.length > 0) {
    return runSuggestedDuplicateWizard(db, suggestions, recentLimit);
  }

  const linkedGroups = listLinkedAccountGroups(db);
  if (linkedGroups.length === 0) {
    return { action: 'none', reason: 'empty' };
  }

  return runLinkedGroupsWizard(db, linkedGroups, recentLimit);
}

async function runSuggestedDuplicateWizard(
  db: DatabaseSync,
  suggestions: readonly SuggestedDuplicateGroup[],
  recentLimit: number,
): Promise<LinkAccountsWizardResult> {
  const selectedKey = await select({
    message: 'Possible duplicate accounts detected. Review a group or exit',
    choices: [
      ...suggestions.map((group) => ({
        name: `${formatAccountIdentitySummary(group)} (${group.accounts.length} accounts)`,
        description: group.accounts
          .map((account) => formatLinkableAccountHeadline(db, account))
          .join(' · '),
        value: group.identityKey,
      })),
      { name: 'Exit without changes', value: EXIT_CHOICE },
    ],
  });

  if (selectedKey === EXIT_CHOICE) {
    return { action: 'none' };
  }

  const group = suggestions.find((candidate) => candidate.identityKey === selectedKey);
  if (!group) {
    return { action: 'none' };
  }

  return runLinkGroupWizard(db, group.accounts, recentLimit);
}

async function runLinkedGroupsWizard(
  db: DatabaseSync,
  linkedGroups: readonly LinkedAccountGroupSummary[],
  recentLimit: number,
): Promise<LinkAccountsWizardResult> {
  const selectedCanonical = await select({
    message: 'No new duplicate accounts detected. Review a linked group or exit',
    choices: [
      ...linkedGroups.map((group) => ({
        name: formatLinkedGroupHeadline(db, group),
        description: formatLinkedGroupDescription(db, group, recentLimit),
        value: group.canonicalAccountId,
      })),
      { name: 'Exit without changes', value: EXIT_CHOICE },
    ],
  });

  if (selectedCanonical === EXIT_CHOICE) {
    return { action: 'none' };
  }

  const group = linkedGroups.find(
    (candidate) => candidate.canonicalAccountId === selectedCanonical,
  );
  if (!group) {
    return { action: 'none' };
  }

  const action = await select({
    message: 'What would you like to do with this linked group?',
    choices: [
      { name: 'Unlink selected alias accounts', value: 'unlink' as const },
      { name: 'Dissolve the entire group', value: 'dissolve' as const },
      { name: 'Exit without changes', value: EXIT_CHOICE },
    ],
  });

  if (action === EXIT_CHOICE) {
    return { action: 'none' };
  }

  if (action === 'dissolve') {
    const shouldDissolve = await confirm({
      message: 'Dissolve this linked group and restore all accounts?',
      default: false,
    });
    if (!shouldDissolve) {
      return { action: 'none' };
    }

    dissolveAccountGroup(db, group.canonicalAccountId);
    return { action: 'dissolved', canonicalAccountId: group.canonicalAccountId };
  }

  const aliasRows = group.aliasAccountIds
    .map((aliasId) => listLinkableAccounts(db).find((account) => account.id === aliasId))
    .filter((account): account is LinkableAccountRow => account !== undefined);

  if (aliasRows.length === 0) {
    return { action: 'none' };
  }

  const aliasesToUnlink = await checkbox({
    message: 'Choose alias accounts to unlink',
    choices: aliasRows.map((account) => ({
      name: formatLinkableAccountHeadline(db, account),
      description: formatLinkableAccountRecentTransactions(db, account, recentLimit),
      value: account.id,
    })),
  });

  if (aliasesToUnlink.length === 0) {
    return { action: 'none' };
  }

  const shouldUnlink = await confirm({
    message: `Unlink ${aliasesToUnlink.length} alias account(s)?`,
    default: false,
  });
  if (!shouldUnlink) {
    return { action: 'none' };
  }

  for (const aliasId of aliasesToUnlink) {
    unlinkAccountAlias(db, aliasId);
  }

  return { action: 'unlinked', aliasAccountIds: aliasesToUnlink };
}

async function runLinkGroupWizard(
  db: DatabaseSync,
  accounts: readonly LinkableAccountRow[],
  recentLimit: number,
): Promise<LinkAccountsWizardResult> {
  const eligibleAccounts = accounts.filter((account) => !account.isAlias);
  if (eligibleAccounts.length < 2) {
    return { action: 'none' };
  }

  const canonicalAccountId = await select({
    message: 'Choose the canonical account to keep visible',
    choices: [
      ...eligibleAccounts.map((account) => ({
        name: formatLinkableAccountHeadline(db, account),
        description: formatLinkableAccountRecentTransactions(db, account, recentLimit),
        value: account.id,
      })),
      { name: 'Exit without changes', value: EXIT_CHOICE },
    ],
  });

  if (canonicalAccountId === EXIT_CHOICE) {
    return { action: 'none' };
  }

  const aliasCandidates = eligibleAccounts.filter((account) => account.id !== canonicalAccountId);
  const aliasAccountIds = await checkbox({
    message: 'Choose duplicate accounts to hide and stop syncing',
    choices: aliasCandidates.map((account) => ({
      name: formatLinkableAccountHeadline(db, account),
      description: formatLinkableAccountRecentTransactions(db, account, recentLimit),
      value: account.id,
      checked: account.canonicalAccountId === canonicalAccountId,
    })),
  });

  if (aliasAccountIds.length === 0) {
    return { action: 'none' };
  }

  const shouldLink = await confirm({
    message: `Link ${aliasAccountIds.length} alias account(s) to the canonical account?`,
    default: true,
  });
  if (!shouldLink) {
    return { action: 'none' };
  }

  linkAccounts(db, canonicalAccountId, aliasAccountIds);
  return { action: 'linked', canonicalAccountId, aliasAccountIds };
}

function formatLinkedGroupHeadline(db: DatabaseSync, group: LinkedAccountGroupSummary): string {
  const canonicalName = resolveAccountDisplayName(db, group.canonicalAccountId);
  return `${canonicalName} · ${group.aliasAccountIds.length} alias(es)`;
}

function formatLinkedGroupDescription(
  db: DatabaseSync,
  group: LinkedAccountGroupSummary,
  recentLimit: number,
): string {
  const canonical = listLinkableAccounts(db).find(
    (account) => account.id === group.canonicalAccountId,
  );
  const aliasLabels = group.aliasAccountIds.map((aliasId) =>
    resolveAccountDisplayName(db, aliasId),
  );
  const recent =
    canonical !== undefined
      ? formatLinkableAccountRecentTransactions(db, canonical, recentLimit)
      : 'No recent transactions';

  return `${aliasLabels.join(' · ')} · ${recent}`;
}

export function formatLinkAccountsWizardResult(
  db: DatabaseSync,
  result: LinkAccountsWizardResult,
): string {
  switch (result.action) {
    case 'none':
      if (result.reason === 'empty') {
        return chalk.dim('No duplicate accounts detected and no linked groups found.');
      }
      return chalk.dim('No changes made.');
    case 'linked':
      return `${chalk.green('accounts linked')}\n${JSON.stringify(
        {
          canonical_account_id: result.canonicalAccountId,
          display_name: resolveAccountDisplayName(db, result.canonicalAccountId),
          merged_account_ids: getAliasAccountIds(db, result.canonicalAccountId),
        },
        null,
        2,
      )}`;
    case 'dissolved':
      return chalk.green(`account group dissolved for ${result.canonicalAccountId}`);
    case 'unlinked':
      return chalk.green(`unlinked ${result.aliasAccountIds.length} alias account(s)`);
  }
}
