import { describe, expect, it, vi } from 'vitest';
import { throwIfAborted } from '../src/utils/job-abort.js';

const { syncOpenFinanceDataMock } = vi.hoisted(() => ({
  syncOpenFinanceDataMock: vi.fn(),
}));

vi.mock('../src/openfinance/sync/engine.js', () => ({
  syncOpenFinanceData: syncOpenFinanceDataMock,
}));

import { BackgroundJobManager } from '../src/web/server/background-jobs.js';

const ctx = {
  db: {} as never,
  createClient: () =>
    ({
      post: async () => ({}),
    }) as never,
  resolved: {
    config: {
      sync: {
        forceBeforeFetch: false,
        forceUpsert: false,
        connections: [],
        lookbackDays: 7,
        pageSize: 100,
      },
      annotation: { embedding: null },
    },
  } as never,
};

describe('BackgroundJobManager', () => {
  it('replays buffered events to late subscribers', async () => {
    const jobs = new BackgroundJobManager();
    const seen: string[] = [];

    jobs.startPrecompute(ctx, { clearPending: false });

    await vi.waitFor(() => {
      expect(jobs.getCurrent()?.status).toBe('completed');
    });

    jobs.subscribe((event) => {
      seen.push(String(event['type']));
    });

    expect(seen).toContain('done');
  });

  it('returns already-running when a second job is started', async () => {
    syncOpenFinanceDataMock.mockImplementation(
      () =>
        new Promise(() => {
          /* never resolves */
        }),
    );

    const jobs = new BackgroundJobManager();

    expect(
      jobs.startSync(ctx, {
        forceUpsert: false,
        skipPrecompute: true,
        clearPending: false,
      }),
    ).toBe('started');
    await vi.waitFor(() => {
      expect(jobs.isRunning()).toBe(true);
    });
    expect(jobs.startPrecompute(ctx, { clearPending: false })).toBe('already-running');
    expect(
      jobs.startSync(ctx, {
        forceUpsert: false,
        skipPrecompute: true,
        clearPending: false,
      }),
    ).toBe('already-running');
  });

  it('marks job aborted when abort is requested during sync', async () => {
    syncOpenFinanceDataMock.mockImplementation((_db, _client, options) => {
      return new Promise((_resolve, reject) => {
        const interval = setInterval(() => {
          try {
            throwIfAborted(options.signal);
          } catch (error) {
            clearInterval(interval);
            reject(error);
          }
        }, 5);
      });
    });

    const jobs = new BackgroundJobManager();
    const events: string[] = [];
    jobs.subscribe((event) => {
      events.push(String(event['type']));
    });

    jobs.startSync(ctx, {
      forceUpsert: false,
      skipPrecompute: true,
      clearPending: false,
    });
    await vi.waitFor(() => {
      expect(jobs.isRunning()).toBe(true);
    });
    expect(jobs.abort()).toBe(true);

    await vi.waitFor(() => {
      expect(jobs.getCurrent()?.status).toBe('aborted');
    });
    expect(events).toContain('aborted');
  });

  it('returns false when abort is called with no active job', () => {
    const jobs = new BackgroundJobManager();
    expect(jobs.abort()).toBe(false);
  });

  it('propagates detailed OpenFinance-style failure messages to job snapshot and events', async () => {
    const detail = [
      'Cannot reach Banco MCP (network error) for POST https://api.mcp.ai/api/openfinance/connections/list.',
      'fetch failed',
      'connect ECONNREFUSED 127.0.0.1:443 (ECONNREFUSED)',
    ].join('\n');
    syncOpenFinanceDataMock.mockRejectedValue(new TypeError(detail));

    const jobs = new BackgroundJobManager();
    const events: Record<string, unknown>[] = [];
    jobs.subscribe((event) => {
      events.push(event);
    });

    jobs.startSync(ctx, {
      forceUpsert: false,
      skipPrecompute: true,
      clearPending: false,
    });

    await vi.waitFor(() => {
      expect(jobs.getCurrent()?.status).toBe('failed');
    });

    const snapshot = jobs.getCurrent();
    expect(snapshot?.error).toContain('Cannot reach Banco MCP');
    expect(snapshot?.error).toContain('ECONNREFUSED');
    const errorEvent = events.find((event) => event['type'] === 'error');
    expect(errorEvent?.['message']).toContain('Cannot reach Banco MCP');
  });
});
