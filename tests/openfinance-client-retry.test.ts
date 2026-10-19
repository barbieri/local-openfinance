import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const success = () => Response.json({ ok: true, result: { id: 'account' } });
const limited = (headers?: Record<string, string>) =>
  Response.json({ error: 'upstream_rate_limit' }, { status: 429, ...(headers ? { headers } : {}) });

async function setup(interval = '0') {
  vi.stubEnv('OPENFINANCE_MIN_REQUEST_INTERVAL_MS', interval);
  const { OpenFinanceClient } = await import('../src/openfinance/client.js');
  const fetchMock = vi.fn<typeof fetch>();
  vi.stubGlobal('fetch', fetchMock);
  return {
    client: new OpenFinanceClient('https://example.test', 'test-key'),
    fetchMock,
    OpenFinanceClient,
  };
}

describe('Banco request pacing and retries', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-18T08:00:00Z'));
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('honors Retry-After seconds before body hints', async () => {
    const { client, fetchMock } = await setup();
    fetchMock
      .mockResolvedValueOnce(
        Response.json(
          { error: { retry_after_ms: 2000 } },
          { status: 429, headers: { 'Retry-After': '1' } },
        ),
      )
      .mockResolvedValueOnce(success());
    const pending = client.post('/accounts/list');
    await vi.advanceTimersByTimeAsync(999);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await expect(pending).resolves.toEqual({ id: 'account' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('honors Retry-After HTTP dates', async () => {
    const { client, fetchMock } = await setup();
    fetchMock
      .mockResolvedValueOnce(limited({ 'Retry-After': new Date(Date.now() + 2000).toUTCString() }))
      .mockResolvedValueOnce(success());
    const pending = client.post('/accounts/list');
    await vi.advanceTimersByTimeAsync(1999);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await expect(pending).resolves.toEqual({ id: 'account' });
  });

  it('honors error.retry_after_ms without a header', async () => {
    const { client, fetchMock } = await setup();
    fetchMock
      .mockResolvedValueOnce(Response.json({ error: { retry_after_ms: 1200 } }, { status: 429 }))
      .mockResolvedValueOnce(success());
    const pending = client.post('/accounts/list');
    await vi.advanceTimersByTimeAsync(1199);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await expect(pending).resolves.toEqual({ id: 'account' });
  });

  it('grows jittered backoff to the cap and stops after eight attempts', async () => {
    const { client, fetchMock } = await setup();
    const starts: number[] = [];
    fetchMock.mockImplementation(async () => {
      starts.push(Date.now());
      return limited();
    });
    const pending = expect(client.post('/accounts/list')).rejects.toMatchObject({
      kind: 'http',
      status: 429,
      message: expect.stringContaining(
        'Banco MCP rate limit exceeded after retries. Wait and try again.',
      ),
    });
    await vi.runAllTimersAsync();
    await pending;
    expect(starts.map((time) => time - (starts[0] ?? 0))).toEqual([
      0, 375, 1125, 2625, 5625, 11625, 23625, 46125,
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(8);
  });

  it('retries ok:false envelopes with upstream_rate_limit codes', async () => {
    const { client, fetchMock } = await setup();
    fetchMock
      .mockResolvedValueOnce(
        Response.json({ ok: false, error: { code: 'upstream_rate_limit', message: 'busy' } }),
      )
      .mockResolvedValueOnce(success());
    const pending = client.post('/accounts/list');
    await vi.advanceTimersByTimeAsync(374);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await expect(pending).resolves.toEqual({ id: 'account' });
  });

  it('throws non-rate-limit ok:false envelopes without retrying', async () => {
    const { client, fetchMock } = await setup();
    fetchMock.mockResolvedValueOnce(Response.json({ ok: false, error: 'invalid account' }));
    await expect(client.post('/accounts/list')).rejects.toMatchObject({
      kind: 'upstream',
      message: expect.stringContaining('invalid account'),
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('spaces request starts across clients without waiting for responses', async () => {
    const { client, fetchMock, OpenFinanceClient } = await setup('600');
    let finishFirst: ((response: Response) => void) | undefined;
    fetchMock
      .mockImplementationOnce(
        () =>
          new Promise<Response>((resolve) => {
            finishFirst = resolve;
          }),
      )
      .mockImplementation(async () => success());
    const first = client.post('/accounts/list');
    const second = new OpenFinanceClient('https://other.test', 'other-key').post('/accounts/list');
    const third = client.post('/investments/list');
    await vi.advanceTimersByTimeAsync(599);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await expect(second).resolves.toEqual({ id: 'account' });
    await vi.advanceTimersByTimeAsync(599);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    await expect(third).resolves.toEqual({ id: 'account' });
    finishFirst?.(success());
    await first;
  });

  it('defaults request spacing to 550 ms', async () => {
    const { client, fetchMock } = await setup();
    vi.stubEnv('OPENFINANCE_MIN_REQUEST_INTERVAL_MS', undefined);
    fetchMock.mockImplementation(async () => success());
    const first = client.post('/accounts/list');
    const second = client.post('/accounts/list');
    await vi.advanceTimersByTimeAsync(549);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await Promise.all([first, second]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
