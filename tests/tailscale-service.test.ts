import { describe, expect, it, vi } from 'vitest';
import {
  buildAdvertiseArgs,
  buildDrainArgs,
  normalizeTailscaleServiceName,
  resolveTailscaleHttpsPortFromEnv,
  resolveTailscaleServiceFromEnv,
  startTailscaleServiceLifecycle,
  TAILSCALE_HTTPS_PORT_ENV,
  TAILSCALE_SERVICE_ENV,
} from '../src/web/server/tailscale-service.js';

describe('normalizeTailscaleServiceName', () => {
  it('adds svc: prefix when missing', () => {
    expect(normalizeTailscaleServiceName('local-openfinance')).toBe('svc:local-openfinance');
  });

  it('keeps existing svc: prefix', () => {
    expect(normalizeTailscaleServiceName('svc:local-openfinance')).toBe('svc:local-openfinance');
  });

  it('rejects blank names', () => {
    expect(() => normalizeTailscaleServiceName('  ')).toThrow(/non-empty/);
  });
});

describe('buildAdvertiseArgs / buildDrainArgs', () => {
  it('builds serve --service advertise command', () => {
    expect(
      buildAdvertiseArgs({
        service: 'local-openfinance',
        localPort: 3847,
      }),
    ).toEqual([
      'serve',
      '--service=svc:local-openfinance',
      '--https=443',
      '--yes',
      '127.0.0.1:3847',
    ]);
  });

  it('allows custom https port', () => {
    expect(
      buildAdvertiseArgs({
        service: 'svc:app',
        localPort: 3000,
        httpsPort: 8443,
      }),
    ).toEqual(['serve', '--service=svc:app', '--https=8443', '--yes', '127.0.0.1:3000']);
  });

  it('builds drain command', () => {
    expect(buildDrainArgs('local-openfinance')).toEqual([
      'serve',
      'drain',
      'svc:local-openfinance',
    ]);
  });
});

describe('env helpers', () => {
  it('reads service name from env', () => {
    expect(resolveTailscaleServiceFromEnv({})).toBeUndefined();
    expect(
      resolveTailscaleServiceFromEnv({ [TAILSCALE_SERVICE_ENV]: '  local-openfinance  ' }),
    ).toBe('local-openfinance');
  });

  it('reads https port from env with default', () => {
    expect(resolveTailscaleHttpsPortFromEnv({})).toBe(443);
    expect(resolveTailscaleHttpsPortFromEnv({ [TAILSCALE_HTTPS_PORT_ENV]: '8443' })).toBe(8443);
  });

  it('rejects invalid https port', () => {
    expect(() => resolveTailscaleHttpsPortFromEnv({ [TAILSCALE_HTTPS_PORT_ENV]: 'nope' })).toThrow(
      /integer port/,
    );
  });
});

describe('startTailscaleServiceLifecycle', () => {
  it('advertises then drains once', async () => {
    const calls: string[][] = [];
    const run = vi.fn(async (args: readonly string[]) => {
      calls.push([...args]);
      return { stdout: 'advertised', stderr: '' };
    });

    const lifecycle = await startTailscaleServiceLifecycle(
      { service: 'local-openfinance', localPort: 3847 },
      run,
    );

    expect(lifecycle.service).toBe('svc:local-openfinance');
    expect(calls[0]).toEqual([
      'serve',
      '--service=svc:local-openfinance',
      '--https=443',
      '--yes',
      '127.0.0.1:3847',
    ]);

    await lifecycle.drain();
    await lifecycle.drain();
    expect(calls).toHaveLength(2);
    expect(calls[1]).toEqual(['serve', 'drain', 'svc:local-openfinance']);
  });
});
