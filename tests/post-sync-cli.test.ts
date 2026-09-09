import process from 'node:process';
import type { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createPostSyncAssistCli,
  type RunPostSyncAssistCliInput,
} from '../src/commands/post-sync-cli.js';

const outputSpies: Array<ReturnType<typeof vi.spyOn>> = [];

afterEach(() => {
  for (const spy of outputSpies.splice(0)) {
    spy.mockRestore();
  }
});

function input(overrides: Partial<RunPostSyncAssistCliInput> = {}): RunPostSyncAssistCliInput {
  return {
    db: {} as DatabaseSync,
    resolved: {} as RunPostSyncAssistCliInput['resolved'],
    quiet: false,
    ...overrides,
  };
}

function captureOutput(): { readonly stdout: () => string; readonly stderr: () => string } {
  const stdout: string[] = [];
  const stderr: string[] = [];
  outputSpies.push(
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      stdout.push(String(chunk));
      return true;
    }),
  );
  outputSpies.push(
    vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
      stderr.push(String(chunk));
      return true;
    }),
  );
  return { stdout: () => stdout.join(''), stderr: () => stderr.join('') };
}

describe('runPostSyncAssistCli', () => {
  it('centralizes progress, summary, and successful digest output', async () => {
    const output = captureOutput();
    const runPostSyncAssist = vi.fn(async (input) => {
      input.onProgress?.({
        type: 'progress',
        current: 2,
        total: 3,
        entryId: 'tx-2',
        status: 'ok',
      });
      return {
        origin: { kind: 'cli' as const },
        precompute: { total: 3 } as never,
        digest: { kind: 'sent' as const, suggestionCount: 4 },
      };
    });
    const runPostSyncAssistCli = createPostSyncAssistCli({ runPostSyncAssist });

    const result = await runPostSyncAssistCli(input());

    expect(result.digest).toEqual({ kind: 'sent', suggestionCount: 4 });
    expect(output.stdout()).toContain('precompute-assist complete');
    expect(output.stdout()).toContain('suggestion digest sent');
    expect(output.stderr()).toContain('precompute-assist: 2/3');
  });

  it('preserves maintain output by suppressing the precompute summary', async () => {
    const output = captureOutput();
    const runPostSyncAssist = vi.fn(async () => ({
      origin: { kind: 'cli' as const },
      precompute: { total: 3 } as never,
      digest: { kind: 'sent' as const, suggestionCount: 4 },
    }));
    const runPostSyncAssistCli = createPostSyncAssistCli({ runPostSyncAssist });

    await runPostSyncAssistCli(input({ showPrecomputeSummary: false }));

    expect(output.stdout()).not.toContain('precompute-assist complete');
    expect(output.stdout()).toContain('suggestion digest sent');
  });

  it('prints and rethrows digest failures', async () => {
    const output = captureOutput();
    const error = new Error('SMTP indisponível');
    const runPostSyncAssist = vi.fn(async () => ({
      origin: { kind: 'cli' as const },
      precompute: { total: 3 } as never,
      digest: { kind: 'failed' as const, error, suggestionCount: 4 },
    }));
    const runPostSyncAssistCli = createPostSyncAssistCli({ runPostSyncAssist });

    await expect(runPostSyncAssistCli(input())).rejects.toBe(error);
    expect(output.stderr()).toContain('suggestion digest failed: SMTP indisponível');
  });
});
