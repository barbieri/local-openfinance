import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { HTTPException } from 'hono/http-exception';
import { streamSSE } from 'hono/streaming';
import {
  applyAssistSuggestion,
  dismissAssistSuggestion,
} from '../../annotation/apply-suggestion.js';
import { resolveTransactionAssist } from '../../annotation/assist.js';
import { sanitizeAssistNotes } from '../../annotation/assist-proposal.js';
import {
  listTriageQueue,
  markAssistSuggestionReviewed,
} from '../../annotation/assist-suggestions.js';
import {
  resolveAnnotationLabelReferences,
  resolveAssistProposalLabelIds,
} from '../../annotation/label-resolve.js';
import { countPendingAssistSuggestions } from '../../annotation/pending-assist-suggestions.js';
import { saveTransactionClassification } from '../../annotation/save-transaction-classification.js';
import {
  listAnnotationCategories,
  loadAnnotatableEntry,
  saveEntryAnnotation,
  suggestCategoriesForEntry,
} from '../../annotation/store.js';
import { loadConfig } from '../../config/load-config.js';
import { deleteAccountLabel, upsertAccountLabel } from '../../db/account-labels.js';
import {
  dissolveAccountGroup,
  findSuggestedDuplicateGroups,
  formatAccountIdentitySummary,
  type LinkableAccountRow,
  linkAccounts,
  listLinkedAccountGroups,
  unlinkAccountAlias,
} from '../../db/account-links.js';
import type { EnrichedAccount } from '../../db/account-list-details.js';
import { listEnrichedAccounts, listEnrichedCreditCards } from '../../db/account-list-details.js';
import { formatAccountDetailsPlain } from '../../db/accounts/present.js';
import {
  countAnnotationLabelUsage,
  createAnnotationLabel,
  deleteAnnotationLabel,
  listAnnotationLabelRows,
  resolveAnnotationLabelPresentation,
  updateAnnotationLabel,
} from '../../db/annotation-labels.js';
import { deleteCategoryLabel, upsertCategoryLabel } from '../../db/category-labels.js';
import { buildCategoryTree } from '../../db/category-tree.js';
import { openDatabase } from '../../db/connection.js';
import {
  resolveAccountDisplayName,
  resolveConnectionDisplayName,
  upsertConnectionLabel,
} from '../../db/connection-labels.js';
import { listEnrichedConnections } from '../../db/connection-list-details.js';
import { listEnrichedCreditCardBills } from '../../db/credit-card-bill-details.js';
import {
  listEnrichedInvestments,
  parseInvestmentStatusFilter,
} from '../../db/investment-details.js';
import { serializeInvestmentForJson } from '../../db/investments/present.js';
import { listEnrichedLoans } from '../../db/loan-details.js';
import { formatSqliteUserMessage, isSqliteQueryError } from '../../db/sqlite-query.js';
import { logger } from '../../logger.js';
import type { AnnotationAssistProposal } from '../../scoring/providers.js';
import { resolveLocalTimeZone } from '../../utils/local-date.js';
import { authMiddleware } from './auth.js';
import { BackgroundJobManager } from './background-jobs.js';
import { buildConnectionById, type WebServerContext } from './context.js';
import { registerIntelligenceRoutes } from './intelligence-routes.js';
import { registerJobRoutes, streamJobEvents } from './job-routes.js';
import { buildCategoryIndexForLocale, parseRequestLocale } from './request-locale.js';
import {
  resolveTailscaleHttpsPortFromEnv,
  resolveTailscaleServiceFromEnv,
  startTailscaleServiceLifecycle,
} from './tailscale-service.js';
import { registerTransactionRoutes } from './transaction-routes.js';
import { registerTransferRoutes } from './transfer-routes.js';
import { presentTriageQueueForWeb } from './triage-present.js';
import { parseValidatedJsonBody } from './validate-body.js';

const DEFAULT_PORT = 3847;

export function createWebApp(ctx: WebServerContext): Hono {
  const app = new Hono();

  app.use('/api/*', cors());
  app.use('/api/*', authMiddleware());

  app.get('/api/health', (c) => {
    return c.json({
      ok: true,
      dbPath: ctx.resolved.config.storage.databasePath,
      timeZone: resolveLocalTimeZone(),
    });
  });

  app.get('/api/connections', (c) => {
    const { connections } = listEnrichedConnections(ctx.db, { limit: 10_000, offset: 0 });
    const rows = connections.map((row) => ({
      item_id: row.item_id,
      connector_id: row.connector_id,
      connector_name: row.connector_name,
      status: row.status,
      synced_at: row.synced_at,
      display_name: row.display_name,
      label_name: row.label_name,
      branch: row.branch,
      account: row.account,
    }));
    return c.json({ rows, byId: buildConnectionById(rows) });
  });

  app.get('/api/accounts', (c) => {
    const { accounts } = listEnrichedAccounts(ctx.db, { limit: 10_000, offset: 0 });
    const rows = accounts.map((row) => serializeAccountRow(row));
    return c.json({ rows, byId: Object.fromEntries(rows.map((r) => [String(r['id']), r])) });
  });

  app.get('/api/annotation-categories', (c) => {
    return c.json({ rows: listAnnotationCategories(ctx.db) });
  });

  app.get('/api/annotation-labels', (c) => {
    const rows = listAnnotationLabelRows(ctx.db);
    const byIdMap = new Map(rows.map((row) => [row.id, row]));
    const byId: Record<string, unknown> = {};
    for (const row of rows) {
      const presentation = resolveAnnotationLabelPresentation(row, byIdMap);
      byId[row.id] = {
        ...presentation,
        parent_id: row.parentId,
        icon_override: row.icon,
        color_override: row.color,
        usageCount: countAnnotationLabelUsage(ctx.db, row.id),
      };
    }
    return c.json({ rows: Object.values(byId), byId });
  });

  app.post('/api/annotation-labels', async (c) => {
    const body = await c.req.json<{
      name: string;
      parentId?: string | null;
      icon?: string | null;
      color?: string | null;
    }>();
    const created = createAnnotationLabel(ctx.db, body);
    return c.json({ id: created.id });
  });

  app.put('/api/annotation-labels/:labelId', async (c) => {
    const labelId = c.req.param('labelId');
    const body = await c.req.json<{
      name: string;
      parentId?: string | null;
      icon?: string | null;
      color?: string | null;
    }>();
    const updated = updateAnnotationLabel(ctx.db, labelId, body);
    return c.json({ id: updated.id });
  });

  app.delete('/api/annotation-labels/:labelId', (c) => {
    const labelId = c.req.param('labelId');
    try {
      deleteAnnotationLabel(ctx.db, labelId);
    } catch (error) {
      throw new HTTPException(409, {
        message: error instanceof Error ? error.message : 'Cannot delete label',
      });
    }
    return c.json({ deleted: labelId });
  });

  app.get('/api/categories', (c) => {
    const index = buildCategoryIndexForLocale(ctx.db, parseRequestLocale(c.req.query('locale')));
    const byId: Record<string, unknown> = {};
    for (const [id, entry] of index) {
      byId[id] = {
        id: entry.id,
        name: entry.name,
        name_translated: entry.name_translated,
        parent_id: entry.parent_id,
        parent_name: entry.parent_name,
        path: entry.path,
        ancestorIds: entry.ancestorIds,
        label: entry.label,
        presentation: entry.presentation,
      };
    }
    const tree = buildCategoryTree(index.values());
    return c.json({ tree, byId });
  });

  app.get('/api/credit-cards', (c) => {
    const { creditCards } = listEnrichedCreditCards(ctx.db, { limit: 10_000, offset: 0 });
    const rows = creditCards.map((row) => serializeAccountRow(row));
    return c.json({ rows });
  });

  app.get('/api/credit-card-bills', (c) => {
    const { bills } = listEnrichedCreditCardBills(ctx.db, { limit: 10_000, offset: 0 });
    return c.json({
      rows: bills.map((bill) => ({
        id: bill.id,
        account_id: bill.account_id,
        due_date: bill.due_date,
        total_amount_cents: bill.total_amount_cents,
        minimum_payment_cents: bill.minimum_payment_cents,
        payment_status: bill.payment_status,
        currency: bill.currency,
      })),
    });
  });

  app.get('/api/investments', (c) => {
    const statusFilter = parseInvestmentStatusFilter(c.req.query('status'));
    const investments = listEnrichedInvestments(ctx.db, statusFilter);
    return c.json({
      rows: investments.map((inv) => {
        const serialized = serializeInvestmentForJson(inv);
        const parsed = serialized['parsed'] as Record<string, unknown>;
        return {
          id: inv.id,
          connection_item_id: inv.connection_item_id,
          connector_name: inv.connector_name,
          type: inv.type,
          subtype: inv.subtype,
          name: inv.name,
          code: inv.code,
          currency: inv.currency,
          balance_cents: inv.balance_cents,
          ...parsed,
        };
      }),
    });
  });

  app.get('/api/loans', (c) => {
    const loans = listEnrichedLoans(ctx.db);
    return c.json({
      rows: loans.map((loan) => ({
        id: loan.id,
        connection_item_id: loan.connection_item_id,
        type: loan.type,
        name: loan.display_name,
        contract_amount_cents: loan.contract_amount_cents,
        balance_cents: loan.outstanding_balance_cents,
        due_date: loan.due_date,
        currency: loan.currency,
      })),
    });
  });

  registerTransactionRoutes(app, ctx);
  registerIntelligenceRoutes(app, ctx);

  app.put('/api/connections/:itemId/label', async (c) => {
    const itemId = c.req.param('itemId');
    const body = await c.req.json<{ branch?: string; account?: string; name?: string }>();
    const label = upsertConnectionLabel(ctx.db, itemId, {
      branch: body.branch,
      account: body.account,
      name: body.name,
    });
    return c.json(label);
  });

  app.put('/api/accounts/:accountId/label', async (c) => {
    const accountId = c.req.param('accountId');
    const body = await c.req.json<{ name?: string | null }>();
    if (body.name === null || body.name === '') {
      deleteAccountLabel(ctx.db, accountId);
      return c.json({ cleared: true });
    }
    const label = upsertAccountLabel(ctx.db, accountId, body.name ?? '');
    return c.json(label);
  });

  app.put('/api/categories/:categoryId/label', async (c) => {
    const categoryId = c.req.param('categoryId');
    const body = await c.req.json<{
      name?: string | null;
      icon?: string | null;
      color?: string | null;
    }>();
    const label = upsertCategoryLabel(ctx.db, categoryId, body);
    return c.json(label);
  });

  app.delete('/api/categories/:categoryId/label', (c) => {
    const categoryId = c.req.param('categoryId');
    deleteCategoryLabel(ctx.db, categoryId);
    return c.json({ cleared: true });
  });

  app.get('/api/accounts/link-suggestions', (c) => {
    const groups = findSuggestedDuplicateGroups(ctx.db).map((group) => ({
      identity_key: group.identityKey,
      identity_summary: formatAccountIdentitySummary(group),
      accounts: group.accounts.map((account) => presentLinkableAccountForWeb(ctx.db, account)),
    }));
    return c.json({ groups });
  });

  app.get('/api/accounts/linked-groups', (c) => {
    const groups = listLinkedAccountGroups(ctx.db).map((group) => ({
      canonical_account_id: group.canonicalAccountId,
      canonical_display_name: resolveAccountDisplayName(ctx.db, group.canonicalAccountId),
      alias_account_ids: group.aliasAccountIds,
      aliases: group.aliasAccountIds.map((aliasId) => ({
        id: aliasId,
        display_name: resolveAccountDisplayName(ctx.db, aliasId),
      })),
    }));
    return c.json({ groups });
  });

  app.post('/api/accounts/link', async (c) => {
    const body = await c.req.json<{ canonicalAccountId: string; aliasAccountIds: string[] }>();
    const result = linkAccounts(ctx.db, body.canonicalAccountId, body.aliasAccountIds);
    return c.json(result);
  });

  app.post('/api/accounts/unlink', async (c) => {
    const body = await c.req.json<{ aliasAccountIds: string[] }>();
    for (const aliasId of body.aliasAccountIds) {
      unlinkAccountAlias(ctx.db, aliasId);
    }
    return c.json({ unlinked: body.aliasAccountIds });
  });

  app.post('/api/accounts/dissolve-group', async (c) => {
    const body = await c.req.json<{ canonicalAccountId: string }>();
    dissolveAccountGroup(ctx.db, body.canonicalAccountId);
    return c.json({ dissolved: body.canonicalAccountId });
  });

  app.post('/api/classify/suggest', async (c) => {
    const body = await c.req.json<{ entryType: string; entryId: string }>();
    const entry = loadAnnotatableEntry(ctx.db, body.entryType as 'transaction', body.entryId);
    if (!entry) {
      throw new HTTPException(404, { message: 'Entry not found' });
    }
    const suggestions = await suggestCategoriesForEntry(ctx.db, entry, {
      embedding: ctx.resolved.config.annotation.embedding,
      classifier: ctx.resolved.config.annotation.classifier,
      similarityThreshold: ctx.resolved.config.annotation.similarityThreshold,
    });
    return c.json(suggestions);
  });

  app.get('/api/classify/triage/stats', (c) => {
    return c.json({ pending: countPendingAssistSuggestions(ctx.db) });
  });

  app.get('/api/classify/triage', (c) => {
    const limit = Number.parseInt(c.req.query('limit') ?? '20', 10);
    const offset = Number.parseInt(c.req.query('offset') ?? '0', 10);
    const items = presentTriageQueueForWeb(
      ctx.db,
      listTriageQueue(ctx.db, {
        limit: Number.isFinite(limit) ? limit : 20,
        offset: Number.isFinite(offset) ? offset : 0,
      }),
    );
    return c.json({
      items,
      pending: countPendingAssistSuggestions(ctx.db),
    });
  });

  app.post('/api/classify/triage/:entryId/apply', async (c) => {
    const entryId = c.req.param('entryId');
    const body = await c.req
      .json<{
        proposal?: AnnotationAssistProposal | null;
        applyToInstallmentSiblings?: boolean;
      }>()
      .catch(() => ({
        proposal: null,
        applyToInstallmentSiblings: false,
      }));

    if (body.proposal) {
      const transaction = ctx.db
        .prepare('SELECT description, merchant_name FROM transactions WHERE id = ?')
        .get(entryId) as
        | { readonly description: string | null; readonly merchant_name: string | null }
        | undefined;
      await saveTransactionClassification(ctx.db, ctx.resolved.config, entryId, {
        categoryOverrideId: body.proposal.categoryOverrideId,
        categoryId: body.proposal.categoryId,
        subCategoryId: body.proposal.subCategoryId,
        labelIds: resolveAssistProposalLabelIds(ctx.db, body.proposal),
        notes: sanitizeAssistNotes(body.proposal.notes, {
          description: transaction?.description ?? null,
          merchantName: transaction?.merchant_name ?? null,
        }),
        source: 'suggested',
        applyToInstallmentSiblings: body.applyToInstallmentSiblings === true,
      });
      markAssistSuggestionReviewed(ctx.db, entryId, 'applied');
      return c.json({ applied: entryId });
    }

    await applyAssistSuggestion(ctx.db, entryId, ctx.resolved.config, body.proposal ?? undefined);
    return c.json({ applied: entryId });
  });

  app.post('/api/classify/triage/:entryId/dismiss', (c) => {
    const entryId = c.req.param('entryId');
    dismissAssistSuggestion(ctx.db, entryId);
    return c.json({ dismissed: entryId });
  });

  registerJobRoutes(app, ctx);
  registerTransferRoutes(app, ctx);

  app.get('/api/jobs/events', (c) => {
    return streamSSE(c, async (stream) => {
      await streamJobEvents(
        ctx,
        async (data) => {
          await stream.writeSSE({ data });
        },
        c.req.raw.signal,
      );
    });
  });

  app.post('/api/classify/assist', async (c) => {
    const body = await c.req.json<{
      entryType: 'transaction' | 'investment_transaction';
      entryId: string;
      windowDays?: number;
      topK?: number;
      force?: boolean;
      currentState?: {
        categoryOverrideId?: string | null;
        categoryId?: string | null;
        subCategoryId?: string | null;
        labelIds?: string[];
        labelNames?: string[];
        notes?: string | null;
      };
    }>();
    const entry = loadAnnotatableEntry(ctx.db, body.entryType, body.entryId);
    if (!entry) {
      throw new HTTPException(404, { message: 'Entry not found' });
    }
    const result = await resolveTransactionAssist(ctx.db, entry, {
      embedding: ctx.resolved.config.annotation.embedding,
      classifier: ctx.resolved.config.annotation.classifier,
      embeddingWindowDays: body.windowDays,
      currentState: body.currentState,
      topK: body.topK,
      force: body.force,
    });
    return c.json(result);
  });

  app.post('/api/classify', async (c) => {
    const body = await parseValidatedJsonBody<{
      entryType: 'transaction' | 'investment_transaction';
      entryId: string;
      categoryId?: string | null;
      subCategoryId?: string | null;
      labelIds?: string[];
      labelNames?: string[];
      notes?: string | null;
      source?: 'manual' | 'suggested';
    }>(c, 'saveEntryAnnotation');
    const labelIds =
      (body.labelIds ?? []).length > 0
        ? [...new Set(body.labelIds ?? [])]
        : [
            ...new Set(
              ...(body.labelNames ?? []).flatMap((name) =>
                resolveAnnotationLabelReferences(ctx.db, [name], { createMissing: false }),
              ),
            ),
          ];
    await saveEntryAnnotation(ctx.db, {
      entryType: body.entryType,
      entryId: body.entryId,
      categoryId: body.categoryId ?? null,
      subCategoryId: body.subCategoryId ?? undefined,
      labelIds: [...new Set(labelIds)],
      notes: body.notes ?? undefined,
      source: body.source ?? 'manual',
      embedding: ctx.resolved.config.annotation.embedding,
    });
    return c.json({ saved: true });
  });

  app.all('/api/*', (c) => {
    return c.json({ error: 'Not found' }, 404);
  });

  app.get('*', (c) => {
    const file = resolveStaticFile(c.req.path);
    if (!file) {
      return c.text('Not found', 404);
    }
    return c.body(readFileSync(file), 200, {
      'Content-Type': contentTypeFor(file),
    });
  });

  app.onError((error, c) => {
    if (error instanceof HTTPException) {
      return error.getResponse();
    }
    if (isSqliteQueryError(error)) {
      return c.json({ error: formatSqliteUserMessage(error) }, 500);
    }
    logger.error({ err: error }, 'request failed');
    const message = error instanceof Error ? error.message : 'Internal Server Error';
    return c.json({ error: message }, 500);
  });

  return app;
}

export type StartWebServerOptions = {
  readonly port?: number;
  /**
   * When set, advertise this host as a Tailscale Service after listen.
   * Accepts `name` or `svc:name`. See LOCAL_OPENFINANCE_TAILSCALE_SERVICE.
   */
  readonly tailscaleService?: string;
  /** HTTPS port for the Tailscale Service endpoint (default 443). */
  readonly tailscaleHttpsPort?: number;
  /** Called after the HTTP server is listening. */
  readonly onReady?: (ctx: WebServerContext) => void;
};

export function startWebServer(
  configPath: string,
  portOrOptions: number | StartWebServerOptions = DEFAULT_PORT,
): void {
  const options: StartWebServerOptions =
    typeof portOrOptions === 'number' ? { port: portOrOptions } : portOrOptions;
  const port = options.port ?? DEFAULT_PORT;

  void loadConfig(configPath).then(async (resolved) => {
    const { db } = openDatabase(resolved);
    const ctx: WebServerContext = {
      db,
      resolved,
      jobs: new BackgroundJobManager(),
    };
    const app = createWebApp(ctx);
    serve({ fetch: app.fetch, hostname: '127.0.0.1', port }, () => {
      console.log(`Web UI at http://127.0.0.1:${port}/?token=…`);
      options.onReady?.(ctx);
    });

    const tailscaleService = options.tailscaleService ?? resolveTailscaleServiceFromEnv();
    if (tailscaleService) {
      try {
        const httpsPort = options.tailscaleHttpsPort ?? resolveTailscaleHttpsPortFromEnv();
        await startTailscaleServiceLifecycle({
          service: tailscaleService,
          localPort: port,
          httpsPort,
          registerSignalHandlers: true,
        });
      } catch (error) {
        logger.error(
          { err: error, service: tailscaleService },
          'failed to advertise Tailscale Service (local UI still running)',
        );
        const message = error instanceof Error ? error.message : String(error);
        console.error(`Tailscale Service advertise failed for ${tailscaleService}: ${message}`);
        console.error(
          'Prerequisites: define the Service in the admin console, use a tag-based Tailscale identity on this host, and ensure `tailscale` is on PATH. See https://tailscale.com/docs/features/tailscale-services',
        );
      }
    }
  });
}

function serializeAccountRow(account: EnrichedAccount): Record<string, unknown> {
  return {
    id: account.id,
    connection_item_id: account.connection_item_id,
    connection_display_name: account.connection_display_name,
    type: account.type,
    subtype: account.subtype,
    name: account.name,
    number: account.number,
    balance_cents: account.balance_cents,
    currency: account.currency,
    display_name: account.display_name,
    branch: account.branch,
    account: account.account,
    transfer_number: account.transfer_number,
    credit_data: account.credit_data,
    account_details: formatAccountDetailsPlain(account),
    merged_account_ids: account.merged_account_ids,
    synced_at: account.synced_at,
  };
}

function presentLinkableAccountForWeb(
  db: WebServerContext['db'],
  account: LinkableAccountRow,
): Record<string, unknown> {
  return {
    id: account.id,
    display_name: resolveAccountDisplayName(db, account.id),
    connection_item_id: account.connectionItemId,
    connection_display_name: resolveConnectionDisplayName(db, account.connectionItemId),
    type: account.type,
    subtype: account.subtype,
    transfer_number: account.transferNumber,
    canonical_account_id: account.canonicalAccountId,
  };
}

/**
 * Locate the Vite production client build (`dist/client`).
 *
 * Layouts differ by entrypoint:
 * - esbuild CLI bundle: `dist/bundle/*.mjs` → sibling `../client`
 * - tsc output: `dist/web/server/*.js` → `../../client`
 * - tsx source: `src/web/server/*.ts` → `../../../dist/client`
 * - cwd fallback when invoked from the package/repo root
 */
export function resolveClientDistDir(
  moduleDir = path.dirname(fileURLToPath(import.meta.url)),
  cwd = process.cwd(),
): string | null {
  const candidates = [
    path.resolve(moduleDir, '../client'),
    path.resolve(moduleDir, '../../client'),
    path.resolve(moduleDir, '../../../dist/client'),
    path.resolve(cwd, 'dist/client'),
  ];
  for (const dir of candidates) {
    if (existsSync(path.join(dir, 'index.html'))) {
      return dir;
    }
  }
  return null;
}

function isPathInsideDir(filePath: string, dir: string): boolean {
  const resolvedFile = path.resolve(filePath);
  const resolvedDir = path.resolve(dir);
  return resolvedFile === resolvedDir || resolvedFile.startsWith(`${resolvedDir}${path.sep}`);
}

function resolveStaticFile(urlPath: string): string | null {
  const distClient = resolveClientDistDir();
  if (!distClient) {
    return null;
  }
  const relative = urlPath === '/' ? 'index.html' : urlPath.replace(/^\//, '');
  const candidate = path.resolve(distClient, relative);
  if (existsSync(candidate) && isPathInsideDir(candidate, distClient)) {
    return candidate;
  }
  const indexHtml = path.join(distClient, 'index.html');
  return existsSync(indexHtml) ? indexHtml : null;
}

function contentTypeFor(filePath: string): string {
  if (filePath.endsWith('.html')) return 'text/html';
  if (filePath.endsWith('.js')) return 'application/javascript';
  if (filePath.endsWith('.css')) return 'text/css';
  return 'application/octet-stream';
}
