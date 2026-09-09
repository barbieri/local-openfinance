import process from 'node:process';
import type { DatabaseSync } from 'node:sqlite';
import type { Argv, CommandModule } from 'yargs';
import { loadConfig } from '../config/load-config.js';
import { openDatabase } from '../db/connection.js';
import { backupDatabase } from '../db/database-health.js';
import {
  parseRebuildMemoryQuantity,
  rebuildReportMemory,
} from '../intelligence/memory-rebuilder.js';
import { resolveLocalTimeZone } from '../utils/local-date.js';
import { type ConfigArgv, withConfigOption } from './shared.js';

type RebuildMemoryArgv = ConfigArgv & {
  readonly report?: string | undefined;
  readonly quantity: string;
};

export const rebuildMemoryCommand: CommandModule<object, RebuildMemoryArgv> = {
  command: 'rebuild-memory',
  describe:
    'recreate bounded report memory from historical report periods without generating reports',
  builder: (argv) =>
    withConfigOption(argv)
      .option('report', {
        type: 'string',
        describe: 'One named report id; omit to rebuild every configured report',
      })
      .option('quantity', {
        type: 'string',
        default: 'all',
        describe: 'Number of most recent report periods to process, or all',
      }) as Argv<RebuildMemoryArgv>,
  handler: async (argv) => {
    const resolved = await loadConfig(argv.config);
    const quantity = parseRebuildMemoryQuantity(argv.quantity);
    const reports = argv.report
      ? resolved.config.reports.filter((report) => report.id === argv.report)
      : resolved.config.reports;
    if (reports.length === 0) {
      throw new Error(
        argv.report ? `Report not found: ${argv.report}` : 'No reports are configured.',
      );
    }
    const opened = openDatabase(resolved);
    const { db } = opened;
    try {
      const backupPath =
        opened.migrationBackupPath ??
        backupBeforeMemoryRebuild(db, resolved.config.storage.databasePath);
      const timeZone = resolveLocalTimeZone();
      const results = await rebuildConfiguredMemories({
        db,
        resolved,
        reportIds: reports.map((report) => report.id),
        quantity,
        timeZone,
      });
      process.stdout.write(`${JSON.stringify({ backupPath, results }, null, 2)}\n`);
    } finally {
      db.close();
    }
  },
};

async function rebuildConfiguredMemories(input: {
  readonly db: DatabaseSync;
  readonly resolved: Awaited<ReturnType<typeof loadConfig>>;
  readonly reportIds: readonly string[];
  readonly quantity: ReturnType<typeof parseRebuildMemoryQuantity>;
  readonly timeZone: string;
}): Promise<readonly Awaited<ReturnType<typeof rebuildReportMemory>>[]> {
  const [reportId, ...remaining] = input.reportIds;
  if (!reportId) return [];
  const result = await rebuildReportMemory({
    db: input.db,
    resolved: input.resolved,
    reportId,
    quantity: input.quantity,
    timeZone: input.timeZone,
  });
  return [result, ...(await rebuildConfiguredMemories({ ...input, reportIds: remaining }))];
}

function backupBeforeMemoryRebuild(db: DatabaseSync, databasePath: string): string | null {
  if (databasePath === ':memory:') return null;
  const stamp = new Date()
    .toISOString()
    .replaceAll(/[-:.TZ]/gu, '')
    .slice(0, 17);
  const backupPath = `${databasePath}.${stamp}-${process.pid}-before-rebuild-report-memory.sqlite`;
  backupDatabase(db, backupPath);
  return backupPath;
}
