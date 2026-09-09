import type { Hono } from 'hono';
import type { WebServerContext } from './context.js';

export function registerJobRoutes(app: Hono, ctx: WebServerContext): void {
  app.get('/api/jobs/current', (c) => {
    return c.json({ active: ctx.jobs.getCurrent() });
  });

  app.post('/api/jobs/sync', (c) => {
    const forceUpsert =
      c.req.query('force-upsert') === 'true' ||
      c.req.query('force') === 'true' ||
      ctx.resolved.config.sync.forceUpsert;
    const skipPrecompute = c.req.query('no-precompute-assist') === 'true';
    const clearPending = c.req.query('clear-pending') === 'true';
    const result = ctx.jobs.startSync(ctx, {
      forceUpsert,
      skipPrecompute,
      clearPending,
    });
    if (result === 'already-running') {
      return c.json({ error: 'Another background job is already running' }, 409);
    }
    return c.json({ started: true, kind: 'sync' }, 202);
  });

  app.post('/api/jobs/precompute', (c) => {
    const clearPending = c.req.query('clear-pending') === 'true';
    const result = ctx.jobs.startPrecompute(ctx, { clearPending });
    if (result === 'already-running') {
      return c.json({ error: 'Another background job is already running' }, 409);
    }
    return c.json({ started: true, kind: 'precompute' }, 202);
  });

  app.post('/api/jobs/abort', (c) => {
    const aborted = ctx.jobs.abort();
    if (!aborted) {
      return c.json({ error: 'No running job to abort' }, 409);
    }
    return c.json({ aborted: true });
  });
}

export async function streamJobEvents(
  ctx: WebServerContext,
  write: (data: string) => Promise<void>,
  closeSignal: AbortSignal,
): Promise<void> {
  let resolveClose: (() => void) | undefined;
  const closePromise = new Promise<void>((resolve) => {
    resolveClose = resolve;
  });

  const onClose = (): void => {
    resolveClose?.();
  };
  closeSignal.addEventListener('abort', onClose, { once: true });

  const terminalTypes = new Set(['done', 'precompute-done', 'error', 'aborted']);

  const unsubscribe = ctx.jobs.subscribe((event) => {
    void write(JSON.stringify(event));
    const type = event['type'];
    if (typeof type === 'string' && terminalTypes.has(type)) {
      setTimeout(() => resolveClose?.(), 250);
    }
  });

  try {
    await closePromise;
  } finally {
    closeSignal.removeEventListener('abort', onClose);
    unsubscribe();
  }
}
