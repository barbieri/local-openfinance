import process from 'node:process';
import type { DatabaseSync } from 'node:sqlite';
import { stripVTControlCharacters } from 'node:util';
import { Marked, type MarkedExtension } from 'marked';
import { markedTerminal } from 'marked-terminal';
import type { Argv, CommandModule } from 'yargs';
import { loadConfig } from '../config/load-config.js';
import { openDatabase } from '../db/connection.js';
import {
  DueReportAlreadyRunError,
  type ExecutedReport,
  executeReport,
  sanitizeReportSubject,
} from '../intelligence/report-runner.js';
import { resolveReportQueryScope } from '../intelligence/report-scope.js';
import { resolveDueReports } from '../intelligence/schedule.js';
import type { ResolvedConfig } from '../types.js';
import { resolveLocalTimeZone } from '../utils/local-date.js';
import { resolveFlexibleLocalDateRange } from '../utils/local-date-range.js';
import { mapInParallel } from '../utils/map-in-parallel.js';
import {
  type ConfigArgv,
  type DateRangeArgv,
  withConfigOption,
  withDateRangeOptions,
} from './shared.js';

export type RunArgv = ConfigArgv &
  DateRangeArgv & {
    readonly report?: string | undefined;
    readonly due?: boolean | undefined;
    readonly send: boolean;
    readonly 'dry-run': boolean;
  };

const terminalMarkdown = new Marked();
terminalMarkdown.use(markedTerminal() as unknown as MarkedExtension);

export const runCommand: CommandModule<object, RunArgv> = {
  command: 'run',
  describe: 'run one named report or every report currently due',
  builder: (argv) =>
    withDateRangeOptions(withConfigOption(argv))
      .option('report', {
        type: 'string',
        describe: 'Named report id to run',
      })
      .option('due', {
        type: 'boolean',
        describe: 'Run every scheduled report that is currently due',
      })
      .option('send', {
        type: 'boolean',
        default: false,
        describe: 'Send eligible report results through notify.smtp',
      })
      .option('dry-run', {
        type: 'boolean',
        default: false,
        describe: 'Generate without persistence or email delivery',
      })
      .conflicts('report', 'due')
      .conflicts('due', ['date', 'start-date', 'end-date']) as Argv<RunArgv>,
  handler: async (argv) => {
    if (!argv.report && !argv.due) {
      throw new Error('run requires either --report <id> or --due.');
    }
    const results = await runConfiguredReports(argv);
    printResults(results);
  },
};

async function runConfiguredReports(argv: RunArgv): Promise<readonly ExecutedReport[]> {
  const resolved = await loadConfig(argv.config);
  const { db } = openDatabase(resolved);
  const now = new Date();
  const timeZone = resolveLocalTimeZone();
  if (argv.report) {
    return [await runManualReport(db, resolved, argv, argv.report, now, timeZone)];
  }
  return runDueReports(db, resolved, argv, now, timeZone);
}

async function runManualReport(
  db: DatabaseSync,
  resolved: ResolvedConfig,
  argv: RunArgv,
  reportId: string,
  now: Date,
  timeZone: string,
): Promise<ExecutedReport> {
  const defaultScope = resolveReportQueryScope(resolved, reportId, { now, timeZone });
  const override = resolveFlexibleLocalDateRange(argv, timeZone);
  const period = override ? requireCompletePeriod(override) : defaultScope.period;
  return executeReport({
    db,
    resolved,
    reportId,
    period,
    now,
    timeZone,
    triggerKind: 'manual',
    send: argv.send,
    dryRun: argv['dry-run'],
  });
}

async function runDueReports(
  db: DatabaseSync,
  resolved: ResolvedConfig,
  argv: RunArgv,
  now: Date,
  timeZone: string,
): Promise<readonly ExecutedReport[]> {
  const results = await mapInParallel(
    resolveDueReports(resolved.config.reports, now, timeZone),
    async (due): Promise<ExecutedReport | null> => {
      try {
        return await executeReport({
          db,
          resolved,
          reportId: due.report.id,
          now,
          timeZone,
          triggerKind: 'due',
          dueKey: due.dueKey,
          send: argv.send,
          dryRun: argv['dry-run'],
        });
      } catch (error) {
        if (error instanceof DueReportAlreadyRunError) {
          return null;
        }
        throw error;
      }
    },
    2,
  );
  return results.filter((result): result is ExecutedReport => result !== null);
}

function printResults(results: readonly ExecutedReport[]): void {
  if (results.length === 0) {
    process.stdout.write('No reports are due.\n');
    return;
  }
  for (const result of results) {
    const rendered = renderMarkdownForTerminal(result.markdown);
    process.stdout.write(
      `\n${sanitizeReportSubject(result.subject)}\n${result.period.start} – ${result.period.end}\n\n${rendered}\n`,
    );
    const cost = result.usage.estimatedCostMicrousd;
    process.stdout.write(
      `Usage: ${result.usage.callCount} calls, ${result.usage.inputTokens} input, ${result.usage.outputTokens} output tokens${cost === null ? ', cost unpriced' : `, estimated US$${(cost / 1_000_000).toFixed(6)}`}\n`,
    );
  }
}

export function renderMarkdownForTerminal(markdown: string): string {
  return terminalMarkdown.parse(stripVTControlCharacters(markdown), { async: false });
}

function requireCompletePeriod(range: {
  readonly startDate: string | null;
  readonly endDate: string | null;
}): { readonly start: string; readonly end: string } {
  if (!range.startDate || !range.endDate) {
    throw new Error('Report date overrides require both a start and an end date.');
  }
  if (range.startDate > range.endDate) {
    throw new Error('Report start date must not be after the end date.');
  }
  return { start: range.startDate, end: range.endDate };
}
