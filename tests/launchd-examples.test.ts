import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('launchd examples', () => {
  it('keeps maintain --serve alive and restarts it at 05:00', async () => {
    const [service, daily] = await Promise.all([
      readFile('examples/launchd/ai.mcp.local-openfinance.plist', 'utf8'),
      readFile('examples/launchd/ai.mcp.local-openfinance-daily.plist', 'utf8'),
    ]);

    expect(service).toContain('maintain');
    expect(service).toContain('--serve');
    expect(service).toContain('<key>KeepAlive</key>');
    expect(daily).toContain('kickstart');
    expect(daily).toContain('<key>Hour</key>');
    expect(daily).toContain('<integer>5</integer>');
  });

  it('checks due reports every hour', async () => {
    const plist = await readFile('examples/launchd/ai.mcp.local-openfinance-reports.plist', 'utf8');
    expect(plist).toContain('run');
    expect(plist).toContain('--due');
    expect(plist).toContain('--send');
    expect(plist).toContain('<key>StartInterval</key>');
    expect(plist).toContain('<integer>3600</integer>');
  });
});
