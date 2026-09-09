#!/usr/bin/env node
import './env.js';
import process from 'node:process';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { checkDatabaseCommand } from './commands/check-database.js';
import { classifyCommand } from './commands/classify.js';
import { creditCardDetailsCommand } from './commands/credit-card-details.js';
import { detectTransfersCommand } from './commands/detect-transfers.js';
import { inspectConfigCommand } from './commands/inspect-config.js';
import { labelAccountCommand } from './commands/label-account.js';
import { labelCategoryCommand } from './commands/label-category.js';
import { labelConnectionCommand } from './commands/label-connection.js';
import { linkAccountsCommand } from './commands/link-accounts.js';
import { listAccountsCommand } from './commands/list-accounts.js';
import { listCategoriesCommand } from './commands/list-categories.js';
import { listConnectionsCommand } from './commands/list-connections.js';
import { listCreditCardBillsCommand } from './commands/list-credit-card-bills.js';
import { listCreditCardsCommand } from './commands/list-credit-cards.js';
import { listInvestmentsCommand } from './commands/list-investments.js';
import { listLoansCommand } from './commands/list-loans.js';
import { listTransactionsCommand } from './commands/list-transactions.js';
import { listTransferGroupsCommand } from './commands/list-transfer-groups.js';
import { maintainCommand } from './commands/maintain.js';
import { precomputeAssistCommand } from './commands/precompute-assist.js';
import { rebuildMemoryCommand } from './commands/rebuild-memory.js';
import { runCommand } from './commands/run.js';
import { serveCommand } from './commands/serve.js';
import { syncCommand } from './commands/sync.js';
import { validateConfigCommand } from './commands/validate-config.js';
import { logger } from './logger.js';

async function main(): Promise<void> {
  await yargs(hideBin(process.argv))
    .scriptName('local-openfinance')
    .usage('$0 <command> [options]')
    .command(syncCommand)
    .command(maintainCommand)
    .command(checkDatabaseCommand)
    .command(classifyCommand)
    .command(precomputeAssistCommand)
    .command(rebuildMemoryCommand)
    .command(runCommand)
    .command(detectTransfersCommand)
    .command(labelConnectionCommand)
    .command(labelAccountCommand)
    .command(linkAccountsCommand)
    .command(listConnectionsCommand)
    .command(listAccountsCommand)
    .command(listTransactionsCommand)
    .command(listCreditCardsCommand)
    .command(listCreditCardBillsCommand)
    .command(creditCardDetailsCommand)
    .command(listInvestmentsCommand)
    .command(listLoansCommand)
    .command(listCategoriesCommand)
    .command(labelCategoryCommand)
    .command(serveCommand)
    .command(listTransferGroupsCommand)
    .command(inspectConfigCommand)
    .command(validateConfigCommand)
    .demandCommand(1, 'Choose a command.')
    .strictCommands()
    .recommendCommands()
    .help()
    .alias('h', 'help')
    .fail((message, error) => {
      throw error ?? new Error(message);
    })
    .parseAsync();
}

main().catch((error: unknown) => {
  logger.fatal({ err: error }, 'command failed');
  process.exit(1);
});
