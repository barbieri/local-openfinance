import { existsSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import chalk from 'chalk';
import type { Argv, CommandModule } from 'yargs';
import { loadConfig } from '../config/load-config.js';
import { openDatabase, openDatabaseReadWrite } from '../db/connection.js';
import {
  createDatedBackup,
  DEFAULT_BACKUP_KEEP_DAYS,
  defaultBackupDir,
  pruneDatedBackups,
} from '../db/database-backup.js';
import { OpenFinanceClient } from '../openfinance/client.js';
import { syncOpenFinanceData } from '../openfinance/sync/engine.js';
import { createSyncProgress } from '../openfinance/sync/progress.js';
import { toLocalDateKey } from '../utils/local-date.js';
import { startWebServer } from '../web/server/server.js';
import { runPostSyncAssistCli } from './post-sync-cli.js';
import { type ConfigArgv, withConfigOption } from './shared.js';

type MaintainArgv = ConfigArgv & {
  readonly 'backup-dir'?: string | undefined;
  readonly 'keep-days'?: number | undefined;
  readonly quiet?: boolean | undefined;
  readonly 'no-sync'?: boolean | undefined;
  readonly 'no-precompute-assist'?: boolean | undefined;
  readonly 'force-upsert'?: boolean | undefined;
  readonly serve?: boolean | undefined;
};

type MaintainResolved = Awaited<ReturnType<typeof loadConfig>>;

export const maintainCommand: CommandModule<object, MaintainArgv> = {
  command: 'maintain',
  describe:
    'write a restorable daily SQLite backup, prune old backups, sync Open Finance data, and precompute missing classify suggestions',
  builder: (argv) =>
    withConfigOption(argv)
      .option('backup-dir', {
        type: 'string',
        describe:
          'Directory for dated VACUUM INTO copies (default: <database-stem>-backups beside the database)',
      })
      .option('keep-days', {
        type: 'number',
        default: DEFAULT_BACKUP_KEEP_DAYS,
        describe: 'Delete dated backups older than this many local days (default 30)',
      })
      .option('quiet', {
        type: 'boolean',
        default: false,
        describe: 'Suppress sync and precompute progress on stderr',
      })
      .option('no-sync', {
        type: 'boolean',
        default: false,
        describe: 'Only backup and prune; skip sync and precompute',
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
      })
      .option('serve', {
        type: 'boolean',
        default: false,
        describe:
          'Start the local web UI after backup/prune, then run sync as a background web job',
      }) as Argv<MaintainArgv>,
  handler: async (argv) => {
    const resolved = await loadConfig(argv.config);
    const databasePath = resolved.config.storage.databasePath;
    const backupDir = path.resolve(argv['backup-dir'] ?? defaultBackupDir(databasePath));
    const keepDays = argv['keep-days'] ?? DEFAULT_BACKUP_KEEP_DAYS;
    const today = toLocalDateKey(new Date().toISOString());
    const skipSync = argv['no-sync'] === true;
    const skipPrecompute = skipSync || argv['no-precompute-assist'] === true;
    const serve = argv.serve === true;
    const deferSyncToWeb = serve && !skipSync;

    const backupPath = backupExistingDatabase(resolved, databasePath, backupDir, today);
    const prunedBackups = pruneDatedBackups({
      databasePath,
      backupDir,
      keepDays,
      today,
    });

    const { appliedMigrations, syncSummary, precomputeSummary } = await runMaintainSync({
      resolved,
      argv,
      skipSync,
      skipPrecompute,
      deferSyncToWeb,
    });

    process.stdout.write(
      `${chalk.green('maintain complete')}\n${JSON.stringify(
        {
          database_path: databasePath,
          backup_path: backupPath,
          backup_dir: backupDir,
          keep_days: keepDays,
          pruned_backups: prunedBackups,
          applied_migrations: appliedMigrations,
          sync: syncSummary,
          precompute: precomputeSummary,
        },
        null,
        2,
      )}\n`,
    );

    if (serve) {
      startMaintainWebServer(argv, deferSyncToWeb);
    }
  },
};

function backupExistingDatabase(
  resolved: MaintainResolved,
  databasePath: string,
  backupDir: string,
  today: string,
): string | null {
  if (!existsSync(databasePath)) {
    return null;
  }
  const { db } = openDatabaseReadWrite(resolved, { skipHealthCheck: true });
  try {
    db.exec('PRAGMA busy_timeout = 60000');
    return createDatedBackup({
      db,
      databasePath,
      backupDir,
      today,
    }).backupPath;
  } finally {
    db.close();
  }
}

async function runMaintainSync(options: {
  readonly resolved: MaintainResolved;
  readonly argv: MaintainArgv;
  readonly skipSync: boolean;
  readonly skipPrecompute: boolean;
  readonly deferSyncToWeb: boolean;
}): Promise<{
  readonly appliedMigrations: readonly number[] | null;
  readonly syncSummary: unknown;
  readonly precomputeSummary: unknown;
}> {
  if (options.deferSyncToWeb) {
    return {
      appliedMigrations: null,
      syncSummary: { started: true, via: 'web' },
      precomputeSummary: options.skipPrecompute ? null : { started: true, via: 'web' },
    };
  }
  if (options.skipSync) {
    return { appliedMigrations: null, syncSummary: null, precomputeSummary: null };
  }
  return runMaintainCliSync(options.resolved, options.argv, options.skipPrecompute);
}

async function runMaintainCliSync(
  resolved: MaintainResolved,
  argv: MaintainArgv,
  skipPrecompute: boolean,
): Promise<{
  readonly appliedMigrations: readonly number[];
  readonly syncSummary: unknown;
  readonly precomputeSummary: unknown;
}> {
  const { db, appliedMigrations } = openDatabase(resolved);
  try {
    const client = new OpenFinanceClient();
    const progress = createSyncProgress(argv.quiet === true);
    const syncSummary = await syncOpenFinanceData(db, client, {
      ...resolved.config.sync,
      forceUpsert: argv['force-upsert'] === true || resolved.config.sync.forceUpsert,
      progress,
    });

    if (skipPrecompute) {
      return { appliedMigrations, syncSummary, precomputeSummary: null };
    }

    const postSync = await runPostSyncAssistCli({
      db,
      resolved,
      quiet: argv.quiet === true,
      showPrecomputeSummary: false,
      syncedAt: syncSummary.syncedAt,
    });
    const precomputeSummary = postSync.precompute;
    return { appliedMigrations, syncSummary, precomputeSummary };
  } finally {
    db.close();
  }
}

function startMaintainWebServer(argv: MaintainArgv, startSyncJob: boolean): void {
  startWebServer(argv.config, {
    onReady: (ctx) => {
      if (!startSyncJob) {
        return;
      }
      const result = ctx.jobs.startBackgroundSync(ctx, {
        forceUpsert: argv['force-upsert'] === true || ctx.resolved.config.sync.forceUpsert,
        skipPrecompute: argv['no-precompute-assist'] === true,
        clearPending: false,
      });
      if (result === 'already-running') {
        process.stderr.write(
          `${chalk.yellow('sync job already running; skipped maintain auto-start')}\n`,
        );
      }
    },
  });
}
