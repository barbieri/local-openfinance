import process from 'node:process';
import type { DatabaseSync } from 'node:sqlite';
import chalk from 'chalk';
import {
  type PostSyncAssistInput,
  type PostSyncAssistResult,
  runPostSyncAssist as runProductionPostSyncAssist,
} from '../intelligence/post-sync-assist.js';
import type { ResolvedConfig } from '../types.js';

type CliPostSyncAssistRunner = (input: PostSyncAssistInput) => Promise<PostSyncAssistResult>;

export type PostSyncAssistCliDependencies = {
  readonly runPostSyncAssist: CliPostSyncAssistRunner;
};

export type RunPostSyncAssistCliInput = {
  readonly db: DatabaseSync;
  readonly resolved: ResolvedConfig;
  readonly quiet: boolean;
  readonly showPrecomputeSummary?: boolean | undefined;
  readonly syncedAt?: string | undefined;
};

export function createPostSyncAssistCli(
  dependencies: PostSyncAssistCliDependencies,
): (input: RunPostSyncAssistCliInput) => Promise<PostSyncAssistResult> {
  return async function runPostSyncAssistCli(
    input: RunPostSyncAssistCliInput,
  ): Promise<PostSyncAssistResult> {
    const postSync = await dependencies.runPostSyncAssist({
      db: input.db,
      resolved: input.resolved,
      syncedAt: input.syncedAt,
      onProgress: (event) => {
        if (input.quiet || event.type !== 'progress') {
          return;
        }
        process.stderr.write(
          `\r${chalk.dim('precompute-assist')}: ${event.current}/${event.total}`,
        );
      },
    });

    if (!input.quiet) {
      process.stderr.write('\n');
    }
    if (input.showPrecomputeSummary !== false) {
      process.stdout.write(
        `${chalk.green('precompute-assist complete')}\n${JSON.stringify(postSync.precompute, null, 2)}\n`,
      );
    }
    if (postSync.digest.kind === 'failed') {
      process.stderr.write(
        `${chalk.red('suggestion digest failed')}: ${postSync.digest.error.message}\n`,
      );
      throw postSync.digest.error;
    }
    if (!input.quiet && postSync.digest.kind === 'sent') {
      process.stdout.write(
        `${chalk.green('suggestion digest sent')}: ${postSync.digest.suggestionCount} itens\n`,
      );
    }

    return postSync;
  };
}

export const runPostSyncAssistCli = createPostSyncAssistCli({
  runPostSyncAssist: runProductionPostSyncAssist,
});
