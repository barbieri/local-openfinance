import process from 'node:process';
import chalk from 'chalk';
import type { CommandModule } from 'yargs';
import { listUnannotatedEntries } from '../annotation/store.js';
import { runClassifyWizard } from '../annotation/wizard.js';
import { loadConfig } from '../config/load-config.js';
import { openDatabase } from '../db/connection.js';
import { OpenFinanceClient } from '../openfinance/client.js';
import { syncOpenFinanceData } from '../openfinance/sync/engine.js';
import { createSyncProgress } from '../openfinance/sync/progress.js';
import { runPostSyncAssistCli } from './post-sync-cli.js';
import { type ConfigArgv, withConfigOption } from './shared.js';

type SyncArgv = ConfigArgv & {
  readonly classify?: boolean | undefined;
  readonly quiet?: boolean | undefined;
  readonly 'force-upsert'?: boolean | undefined;
  readonly 'no-precompute-assist'?: boolean | undefined;
};

export const syncCommand: CommandModule<object, SyncArgv> = {
  command: 'sync',
  describe: 'sync Open Finance data from Banco MCP into the local SQLite database',
  builder: (argv) =>
    withConfigOption(argv)
      .option('classify', {
        type: 'boolean',
        default: false,
        describe: 'Run the classify wizard after sync when unannotated entries exist',
      })
      .option('quiet', {
        type: 'boolean',
        default: false,
        describe: 'Suppress sync progress output on stderr',
      })
      .option('no-precompute-assist', {
        type: 'boolean',
        default: false,
        describe: 'Skip precomputing classify suggestions after sync',
      })
      .option('force-upsert', {
        type: 'boolean',
        default: false,
        alias: 'force',
        describe:
          'Re-fetch and upsert all rows (bypass incremental skips for categories, transactions, and investment transactions)',
      }),
  handler: async (argv) => {
    const resolved = await loadConfig(argv.config);
    const { db, appliedMigrations } = openDatabase(resolved);

    try {
      const client = new OpenFinanceClient();
      const progress = createSyncProgress(argv.quiet === true);
      const summary = await syncOpenFinanceData(db, client, {
        ...resolved.config.sync,
        forceUpsert: argv['force-upsert'] === true || resolved.config.sync.forceUpsert,
        progress,
      });

      process.stdout.write(
        `${chalk.green('sync complete')}\n${JSON.stringify({ appliedMigrations, summary }, null, 2)}\n`,
      );

      if (argv['no-precompute-assist'] !== true) {
        await runPostSyncAssistCli({
          db,
          resolved,
          quiet: argv.quiet === true,
          syncedAt: summary.syncedAt,
        });
      }

      if (argv.classify) {
        const pending = listUnannotatedEntries(db, {
          entryTypes: ['transaction', 'investment_transaction'],
          limit: 1,
        });
        if (pending.length > 0) {
          const result = await runClassifyWizard(db, resolved.config, {
            limit: 20,
            entryTypes: ['transaction', 'investment_transaction'],
          });
          process.stdout.write(
            `${chalk.green('classify complete')}\n${JSON.stringify(result, null, 2)}\n`,
          );
        } else {
          process.stdout.write(`${chalk.dim('classify')}: no unannotated entries found.\n`);
        }
      }
    } finally {
      db.close();
    }
  },
};
