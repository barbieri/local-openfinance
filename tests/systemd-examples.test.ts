import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('systemd examples', () => {
  it('runs due report delivery as a bounded hourly oneshot', async () => {
    const [service, timer] = await Promise.all([
      readFile('examples/systemd/local-openfinance-reports.service', 'utf8'),
      readFile('examples/systemd/local-openfinance-reports.timer', 'utf8'),
    ]);

    expect(service).toContain('Type=oneshot');
    expect(service).toContain('run --config examples/expenses-config.json --due --send');
    expect(service).toContain('TimeoutStartSec=30min');
    expect(timer).toContain('OnCalendar=hourly');
    expect(timer).toContain('Persistent=true');
    expect(timer).toContain('Unit=local-openfinance-reports.service');
  });
});
