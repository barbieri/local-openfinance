import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { logger } from '../../logger.js';

const execFileAsync = promisify(execFile);

export const TAILSCALE_SERVICE_ENV = 'LOCAL_OPENFINANCE_TAILSCALE_SERVICE';
export const TAILSCALE_HTTPS_PORT_ENV = 'LOCAL_OPENFINANCE_TAILSCALE_HTTPS_PORT';
export const DEFAULT_TAILSCALE_HTTPS_PORT = 443;

export type TailscaleServiceOptions = {
  /** Service name, with or without `svc:` prefix (for example `local-openfinance`). */
  readonly service: string;
  /** Local HTTP port the web UI listens on (proxied target). */
  readonly localPort: number;
  /** HTTPS port advertised on the Tailscale Service (default 443). */
  readonly httpsPort?: number;
  /** Override `tailscale` binary path (tests / non-PATH installs). */
  readonly tailscaleBin?: string;
};

export type RunTailscale = (
  args: readonly string[],
  options?: { readonly bin?: string },
) => Promise<{ readonly stdout: string; readonly stderr: string }>;

export function resolveTailscaleServiceFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  const raw = env[TAILSCALE_SERVICE_ENV]?.trim();
  return raw ? raw : undefined;
}

export function resolveTailscaleHttpsPortFromEnv(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env[TAILSCALE_HTTPS_PORT_ENV]?.trim();
  if (!raw) {
    return DEFAULT_TAILSCALE_HTTPS_PORT;
  }
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(
      `${TAILSCALE_HTTPS_PORT_ENV} must be an integer port 1-65535, got ${JSON.stringify(raw)}`,
    );
  }
  return port;
}

/** Normalize to `svc:<name>` as required by Tailscale Services. */
export function normalizeTailscaleServiceName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) {
    throw new Error('Tailscale service name must be non-empty');
  }
  return trimmed.startsWith('svc:') ? trimmed : `svc:${trimmed}`;
}

export function buildAdvertiseArgs(options: TailscaleServiceOptions): string[] {
  const service = normalizeTailscaleServiceName(options.service);
  const httpsPort = options.httpsPort ?? DEFAULT_TAILSCALE_HTTPS_PORT;
  return [
    'serve',
    `--service=${service}`,
    `--https=${httpsPort}`,
    '--yes',
    `127.0.0.1:${options.localPort}`,
  ];
}

export function buildDrainArgs(service: string): string[] {
  return ['serve', 'drain', normalizeTailscaleServiceName(service)];
}

export const defaultRunTailscale: RunTailscale = async (args, options) => {
  const bin = options?.bin ?? 'tailscale';
  const { stdout, stderr } = await execFileAsync(bin, [...args], {
    encoding: 'utf8',
    maxBuffer: 1024 * 1024,
  });
  return { stdout: stdout.trim(), stderr: stderr.trim() };
};

/**
 * Configure and advertise this host as a Tailscale Service endpoint for the
 * local web UI. Requires a Service defined in the admin console and a
 * tag-based Tailscale identity on this device.
 *
 * @see https://tailscale.com/docs/features/tailscale-services
 */
export async function advertiseTailscaleService(
  options: TailscaleServiceOptions,
  run: RunTailscale = defaultRunTailscale,
): Promise<{ readonly service: string; readonly stdout: string; readonly stderr: string }> {
  const service = normalizeTailscaleServiceName(options.service);
  const args = buildAdvertiseArgs({ ...options, service });
  const result = await run(
    args,
    options.tailscaleBin !== undefined ? { bin: options.tailscaleBin } : undefined,
  );
  return { service, stdout: result.stdout, stderr: result.stderr };
}

/** Stop accepting new connections for the Service on this host. */
export async function drainTailscaleService(
  serviceName: string,
  run: RunTailscale = defaultRunTailscale,
  options?: { readonly tailscaleBin?: string },
): Promise<{ readonly service: string; readonly stdout: string; readonly stderr: string }> {
  const service = normalizeTailscaleServiceName(serviceName);
  const result = await run(
    buildDrainArgs(service),
    options?.tailscaleBin !== undefined ? { bin: options.tailscaleBin } : undefined,
  );
  return { service, stdout: result.stdout, stderr: result.stderr };
}

export type TailscaleLifecycle = {
  readonly service: string;
  readonly drain: () => Promise<void>;
};

/**
 * Advertise on start and return a one-shot `drain` that stops accepting new
 * Service connections. Callers that own the process should pass
 * `registerSignalHandlers: true` so SIGINT/SIGTERM drain then exit.
 */
export async function startTailscaleServiceLifecycle(
  options: TailscaleServiceOptions & {
    readonly registerSignalHandlers?: boolean;
  },
  run: RunTailscale = defaultRunTailscale,
): Promise<TailscaleLifecycle> {
  const advertised = await advertiseTailscaleService(options, run);
  const message =
    advertised.stdout ||
    advertised.stderr ||
    `Advertised ${advertised.service} → 127.0.0.1:${options.localPort}`;
  console.log(`Tailscale Service: ${message}`);
  logger.info(
    {
      service: advertised.service,
      localPort: options.localPort,
      httpsPort: options.httpsPort ?? DEFAULT_TAILSCALE_HTTPS_PORT,
    },
    'tailscale service advertised',
  );

  let drained = false;
  const drain = async (): Promise<void> => {
    if (drained) {
      return;
    }
    drained = true;
    try {
      await drainTailscaleService(
        advertised.service,
        run,
        options.tailscaleBin !== undefined ? { tailscaleBin: options.tailscaleBin } : undefined,
      );
      logger.info({ service: advertised.service }, 'tailscale service drained');
    } catch (error) {
      logger.warn({ err: error, service: advertised.service }, 'failed to drain tailscale service');
    }
  };

  if (options.registerSignalHandlers) {
    const onSignal = (signal: NodeJS.Signals): void => {
      void drain().finally(() => {
        // Replacing the default SIGINT/SIGTERM exit; exit after drain attempt.
        process.exit(signal === 'SIGINT' ? 130 : 143);
      });
    };
    process.once('SIGINT', onSignal);
    process.once('SIGTERM', onSignal);
  }

  return { service: advertised.service, drain };
}
