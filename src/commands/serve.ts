import process from 'node:process';
import type { CommandModule } from 'yargs';
import { startWebServer } from '../web/server/server.js';
import { type ConfigArgv, withConfigOption } from './shared.js';

type ServeArgv = ConfigArgv & {
  readonly port?: number | undefined;
  readonly tailscaleService?: string | undefined;
  readonly tailscaleHttpsPort?: number | undefined;
};

export const serveCommand: CommandModule<object, ServeArgv> = {
  command: 'serve',
  describe:
    'start local web UI (127.0.0.1 only; requires LOCAL_OPENFINANCE_WEB_TOKEN; optional Tailscale Service announce)',
  builder: (argv) =>
    withConfigOption(argv)
      .option('port', {
        type: 'number',
        describe: 'Port (default LOCAL_OPENFINANCE_WEB_PORT or 3847)',
      })
      .option('tailscale-service', {
        type: 'string',
        describe:
          'Announce as Tailscale Service (name or svc:name; env LOCAL_OPENFINANCE_TAILSCALE_SERVICE)',
      })
      .option('tailscale-https-port', {
        type: 'number',
        describe:
          'Tailscale Service HTTPS port (default LOCAL_OPENFINANCE_TAILSCALE_HTTPS_PORT or 443)',
      }),
  handler: (argv) => {
    const port = argv.port ?? Number(process.env['LOCAL_OPENFINANCE_WEB_PORT'] ?? 3847);
    startWebServer(argv.config, {
      port,
      ...(argv.tailscaleService !== undefined ? { tailscaleService: argv.tailscaleService } : {}),
      ...(argv.tailscaleHttpsPort !== undefined
        ? { tailscaleHttpsPort: argv.tailscaleHttpsPort }
        : {}),
    });
  },
};
