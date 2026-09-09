import process from 'node:process';
import chalk from 'chalk';
import type { Argv, CommandModule } from 'yargs';
import { loadConfig } from '../config/load-config.js';
import { openDatabaseReadWrite } from '../db/connection.js';
import {
  backupDatabase,
  readQuickCheckResult,
  rebuildFtsIndexes,
  vacuumDatabase,
} from '../db/database-health.js';
import { type ConfigArgv, withConfigOption } from './shared.js';

type CheckDatabaseArgv = ConfigArgv & {
  readonly repair?: boolean | undefined;
  readonly vacuum?: boolean | undefined;
  readonly backup?: string | undefined;
};

export const checkDatabaseCommand: CommandModule<object, CheckDatabaseArgv> = {
  command: 'check-database',
  describe: 'verify SQLite integrity and optionally rebuild FTS indexes or vacuum',
  builder: (argv) =>
    withConfigOption(argv)
      .option('repair', {
        type: 'boolean',
        default: false,
        describe: 'Rebuild FTS indexes from their content tables',
      })
      .option('vacuum', {
        type: 'boolean',
        default: false,
        describe: 'Run VACUUM after repairs (rewrites the database file)',
      })
      .option('backup', {
        type: 'string',
        describe: 'Write a backup copy to this path before repair/vacuum',
      }) as Argv<CheckDatabaseArgv>,
  handler: async (argv) => {
    const resolved = await loadConfig(argv.config);
    const { db, databasePath } = openDatabaseReadWrite(resolved, { skipHealthCheck: true });

    try {
      const initialCheck = readQuickCheckResult(db);
      if (argv.backup) {
        backupDatabase(db, argv.backup);
      }

      let rebuilt: readonly string[] = [];
      if (argv.repair) {
        rebuilt = rebuildFtsIndexes(db);
      }

      if (argv.vacuum) {
        vacuumDatabase(db);
      }

      const finalCheck = readQuickCheckResult(db);
      process.stdout.write(
        `${JSON.stringify(
          {
            database_path: databasePath,
            quick_check_before: initialCheck,
            quick_check_after: finalCheck,
            rebuilt_fts: rebuilt,
            vacuumed: argv.vacuum ?? false,
            backup_path: argv.backup ?? null,
          },
          null,
          2,
        )}\n`,
      );

      if (finalCheck !== 'ok') {
        process.stderr.write(
          `${chalk.red('database still reports corruption; consider removing the file and running sync again')}\n`,
        );
        process.exitCode = 1;
      }
    } finally {
      db.close();
    }
  },
};
