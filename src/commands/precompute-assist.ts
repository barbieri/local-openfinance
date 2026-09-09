import process from 'node:process';
import chalk from 'chalk';
import type { CommandModule } from 'yargs';
import { runAssistPrecompute } from '../annotation/assist-precompute.js';
import { loadConfig } from '../config/load-config.js';
import { openDatabase } from '../db/connection.js';
import { type ConfigArgv, withConfigOption } from './shared.js';

type PrecomputeAssistArgv = ConfigArgv & {
  readonly limit?: number | undefined;
  readonly quiet?: boolean | undefined;
  readonly clearPending?: boolean | undefined;
};

export const precomputeAssistCommand: CommandModule<object, PrecomputeAssistArgv> = {
  command: 'precompute-assist',
  describe: 'precompute classify suggestions for unannotated transactions',
  builder: (argv) =>
    withConfigOption(argv)
      .option('limit', {
        type: 'number',
        default: 10_000,
        describe: 'Maximum unannotated transactions to process',
      })
      .option('quiet', {
        type: 'boolean',
        default: false,
        describe: 'Suppress progress output on stderr',
      })
      .option('clear-pending', {
        type: 'boolean',
        default: false,
        describe: 'Delete pending suggestions for unannotated transactions before recomputing',
      }),
  handler: async (argv) => {
    const resolved = await loadConfig(argv.config);
    const { db, appliedMigrations } = openDatabase(resolved);

    try {
      const summary = await runAssistPrecompute(db, resolved.config, {
        limit: argv.limit,
        clearPending: argv.clearPending === true,
        onProgress: (event) => {
          if (argv.quiet || event.type === 'done') {
            return;
          }
          if (event.type === 'start') {
            process.stderr.write(
              `${chalk.dim('precompute-assist')}: processing ${event.total} transactions\n`,
            );
            return;
          }
          if (event.type === 'progress') {
            process.stderr.write(
              `\r${chalk.dim('precompute-assist')}: ${event.current}/${event.total} ${event.entryId.slice(0, 8)}… ${event.status}`,
            );
            return;
          }
          if (event.type === 'error') {
            process.stderr.write(`\n${chalk.red('precompute-assist error')}: ${event.message}\n`);
          }
        },
      });

      if (!argv.quiet) {
        process.stderr.write('\n');
      }

      process.stdout.write(
        `${chalk.green('precompute-assist complete')}\n${JSON.stringify({ appliedMigrations, summary }, null, 2)}\n`,
      );
    } finally {
      db.close();
    }
  },
};
