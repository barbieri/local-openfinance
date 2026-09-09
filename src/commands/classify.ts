import process from 'node:process';
import chalk from 'chalk';
import type { Argv, CommandModule } from 'yargs';
import { runClassifyWizard } from '../annotation/wizard.js';
import { loadConfig } from '../config/load-config.js';
import { openDatabase } from '../db/connection.js';
import { type ConfigArgv, withConfigOption } from './shared.js';

type ClassifyArgv = ConfigArgv & {
  readonly limit: number;
  readonly 'entry-type': 'all' | 'transaction' | 'investment_transaction';
  readonly 'skip-embedding': boolean;
};

export const classifyCommand: CommandModule<object, ClassifyArgv> = {
  command: 'classify',
  describe: 'interactively classify unannotated expenses and investments',
  builder: (argv) =>
    withConfigOption(argv)
      .option('limit', {
        type: 'number',
        default: 20,
        describe: 'Maximum unannotated entries to review',
      })
      .option('entry-type', {
        choices: ['all', 'transaction', 'investment_transaction'] as const,
        default: 'all' as const,
        describe: 'Entry kinds to classify',
      })
      .option('skip-embedding', {
        type: 'boolean',
        default: false,
        describe: 'Skip embedding generation and model suggestions',
      }) as Argv<ClassifyArgv>,
  handler: async (argv) => {
    const resolved = await loadConfig(argv.config);
    const { db } = openDatabase(resolved);

    const entryTypes =
      argv['entry-type'] === 'all'
        ? (['transaction', 'investment_transaction'] as const)
        : ([argv['entry-type']] as const);

    const result = await runClassifyWizard(db, resolved.config, {
      limit: argv.limit,
      entryTypes,
      skipEmbedding: argv['skip-embedding'],
    });

    process.stdout.write(
      `${chalk.green('classify complete')}\n${JSON.stringify(result, null, 2)}\n`,
    );
  },
};
