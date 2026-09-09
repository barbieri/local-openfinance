import process from 'node:process';
import { confirm } from '@inquirer/prompts';
import chalk from 'chalk';
import type { Argv, CommandModule } from 'yargs';
import { loadConfig } from '../config/load-config.js';
import { openDatabase } from '../db/connection.js';
import {
  DEFAULT_TRANSFER_FEE_TOLERANCE_CENTS,
  DEFAULT_TRANSFER_WINDOW_HOURS,
  detectTransferGroups,
  formatTransferConfidencePercent,
  formatTransferLeg,
  type TransferPairProposal,
} from '../transfers/detect.js';
import { resolveLocalTimeZone } from '../utils/local-date.js';
import { resolveFlexibleLocalDateRange } from '../utils/local-date-range.js';
import { type ConfigArgv, withConfigOption, withDateRangeOptions } from './shared.js';

type DetectTransfersArgv = ConfigArgv & {
  readonly 'window-hours': number;
  readonly 'fee-tolerance-cents': number;
  readonly 'dry-run': boolean;
  readonly 'no-prompt': boolean;
  readonly date?: string | undefined;
  readonly 'start-date'?: string | undefined;
  readonly 'end-date'?: string | undefined;
};

export const detectTransfersCommand: CommandModule<object, DetectTransfersArgv> = {
  command: 'detect-transfers',
  describe: 'link opposite-sign transactions across accounts into transfer groups',
  builder: (argv) =>
    withConfigOption(withDateRangeOptions(argv))
      .option('window-hours', {
        type: 'number',
        default: DEFAULT_TRANSFER_WINDOW_HOURS,
        describe:
          'Maximum hours between paired transfer legs (also the time threshold for confidence scoring)',
      })
      .option('fee-tolerance-cents', {
        type: 'number',
        default: DEFAULT_TRANSFER_FEE_TOLERANCE_CENTS,
        describe:
          'Maximum absolute amount difference between paired legs in cents (also the amount threshold for confidence scoring)',
      })
      .option('dry-run', {
        type: 'boolean',
        default: false,
        describe: 'Report matches without writing transfer groups',
      })
      .option('no-prompt', {
        type: 'boolean',
        default: false,
        describe: 'Link every detected pair without interactive confirmation',
      }) as Argv<DetectTransfersArgv>,
  handler: async (argv) => {
    const resolved = await loadConfig(argv.config);
    const { db } = openDatabase(resolved);
    const timeZone = resolveLocalTimeZone();
    const dateRange = resolveFlexibleLocalDateRange(argv, timeZone);
    if (!dateRange) {
      throw new Error(
        'detect-transfers requires --date or --start-date/--end-date to limit the scan scope.',
      );
    }

    const summary = await detectTransferGroups(db, {
      windowHours: argv['window-hours'],
      feeToleranceCents: argv['fee-tolerance-cents'],
      dryRun: argv['dry-run'],
      dateRange,
      confirmPair: argv['no-prompt'] ? undefined : (proposal) => promptTransferPair(db, proposal),
    });

    process.stdout.write(
      `${chalk.green('detect-transfers complete')}\n${JSON.stringify(summary, null, 2)}\n`,
    );
  },
};

async function promptTransferPair(
  db: ReturnType<typeof openDatabase>['db'],
  proposal: TransferPairProposal,
): Promise<boolean> {
  return confirm({
    message: [
      `Link ${proposal.kind} (${formatTransferConfidencePercent(proposal.confidence)} confidence)?`,
      `Out: ${formatTransferLeg(db, proposal.source)}`,
      `In:  ${formatTransferLeg(db, proposal.destination)}`,
    ].join('\n'),
    default: true,
  });
}
