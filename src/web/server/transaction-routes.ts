import type { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { saveTransactionClassification } from '../../annotation/save-transaction-classification.js';
import { listMccCodes, mccCodesDocumentVersion } from '../../data/mcc-codes.js';
import {
  canChangeCreditCardBillLink,
  setManualCreditCardBillLink,
} from '../../db/credit-card-bill-links.js';
import {
  getEnrichedTransaction,
  listEnrichedTransactionPage,
} from '../../db/enriched-transactions.js';
import {
  findFirstInstallmentTransactionId,
  getInstallmentPlanInfo,
} from '../../db/installment-siblings.js';
import {
  clearTransactionCategoryOverride,
  upsertTransactionCategoryOverride,
} from '../../db/transaction-category-overrides.js';
import type { WebServerContext } from './context.js';
import { parseRequestLocale } from './request-locale.js';
import { listTransactionChartsForWeb, parseTransactionChartKind } from './transaction-charts.js';
import { parseTransactionFiltersFromRequest } from './transaction-request.js';
import { parseTransactionPagination } from './transactions-list.js';
import { parseValidatedJsonBody } from './validate-body.js';

export function registerTransactionRoutes(app: Hono, ctx: WebServerContext): void {
  app.get('/api/mcc-codes', (c) => {
    return c.json({ version: mccCodesDocumentVersion(), codes: listMccCodes() });
  });

  app.get('/api/transactions', (c) => {
    const filters = parseTransactionFiltersFromRequest(c);
    const pagination = parseTransactionPagination({
      page: c.req.query('page'),
      pageSize: c.req.query('page-size'),
    });
    if ('error' in pagination) {
      return c.json({ error: pagination.error }, 400);
    }
    const result = listEnrichedTransactionPage(ctx.db, filters, {
      limit: pagination.pageSize,
      offset: pagination.offset,
      sort: c.req.query('sort') ?? undefined,
      locale: parseRequestLocale(c.req.query('locale')),
    });
    return c.json(result);
  });

  app.get('/api/transactions/charts', (c) => {
    const chart = parseTransactionChartKind(c.req.query('chart'));
    if (!chart) {
      return c.json(
        { error: 'chart query parameter is required (balance, category, or label)' },
        400,
      );
    }
    const filters = parseTransactionFiltersFromRequest(c);
    return c.json(listTransactionChartsForWeb(ctx.db, filters, chart));
  });

  app.get('/api/transactions/search', (c) => {
    const filters = parseTransactionFiltersFromRequest(c);
    const q = c.req.query('q');
    if (!q) {
      throw new HTTPException(400, { message: 'q is required' });
    }
    const pagination = parseTransactionPagination({
      page: '1',
      pageSize: c.req.query('page-size'),
    });
    if ('error' in pagination) {
      return c.json({ error: pagination.error }, 400);
    }
    const result = listEnrichedTransactionPage(ctx.db, filters, {
      limit: pagination.pageSize,
      offset: pagination.offset,
      sort: c.req.query('sort') ?? undefined,
      locale: parseRequestLocale(c.req.query('locale')),
    });
    return c.json(result);
  });

  app.get('/api/transactions/:transactionId/installment-plan', (c) => {
    const locale = parseRequestLocale(c.req.query('locale'));
    const transactionId = c.req.param('transactionId');
    const transaction = getEnrichedTransaction(ctx.db, transactionId, undefined, {
      locale,
    });
    if (
      !transaction ||
      transaction.installment_number === null ||
      transaction.total_installments === null ||
      transaction.total_installments <= 1
    ) {
      return c.json({ plan: null });
    }

    const plan = getInstallmentPlanInfo(ctx.db, transactionId);
    const firstInstallmentId = findFirstInstallmentTransactionId(ctx.db, transactionId);
    const firstInstallment = firstInstallmentId
      ? getEnrichedTransaction(ctx.db, firstInstallmentId, undefined, { locale })
      : null;

    return c.json({
      plan: {
        installmentNumber: plan?.installmentNumber ?? transaction.installment_number,
        totalInstallments: plan?.totalInstallments ?? transaction.total_installments,
        siblingCount: plan?.siblingIds.length ?? 0,
        firstInstallment: firstInstallment
          ? {
              id: firstInstallment.id,
              local_date: firstInstallment.local_date,
              occurred_at: firstInstallment.occurred_at,
              amount_cents: firstInstallment.amount_cents,
              amount_in_account_currency_cents: firstInstallment.amount_in_account_currency_cents,
              currency: firstInstallment.currency,
              account_currency: firstInstallment.account_currency,
              description: firstInstallment.description,
              display_description: firstInstallment.display_description,
              category_presentation: firstInstallment.category_presentation,
            }
          : null,
      },
    });
  });

  app.get('/api/transactions/:transactionId', (c) => {
    const transaction = getEnrichedTransaction(ctx.db, c.req.param('transactionId'), undefined, {
      locale: parseRequestLocale(c.req.query('locale')),
    });
    if (!transaction) {
      return c.json({ error: 'Transaction not found' }, 404);
    }
    return c.json({ transaction });
  });

  app.post('/api/transactions/:transactionId/bill-link', async (c) => {
    const transactionId = c.req.param('transactionId');
    const body = await parseValidatedJsonBody<{ billId: string }>(c, 'setTransactionBillLink');
    const row = getEnrichedTransaction(ctx.db, transactionId);
    if (!row) {
      return c.json({ error: 'Transaction not found' }, 404);
    }
    if (!canChangeCreditCardBillLink(ctx.db, transactionId, row.raw_json)) {
      return c.json({ error: 'Bill link cannot be changed for this transaction' }, 400);
    }
    try {
      setManualCreditCardBillLink(ctx.db, transactionId, body.billId, new Date().toISOString());
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to set bill link';
      return c.json({ error: message }, 400);
    }
    const transaction = getEnrichedTransaction(ctx.db, transactionId);
    return c.json({ saved: true, transaction });
  });

  app.post('/api/transactions/:transactionId/classification', async (c) => {
    const transactionId = c.req.param('transactionId');
    const body = await parseValidatedJsonBody<{
      categoryOverrideId?: string | null;
      categoryId?: string | null;
      subCategoryId?: string | null;
      labelIds?: string[];
      notes?: string | null;
      applyToInstallmentSiblings?: boolean;
      applyToTransactionIds?: string[];
    }>(c, 'saveTransactionClassification');

    const result = await saveTransactionClassification(ctx.db, ctx.resolved.config, transactionId, {
      categoryOverrideId: body.categoryOverrideId,
      categoryId: body.categoryId,
      subCategoryId: body.subCategoryId,
      labelIds: body.labelIds,
      notes: body.notes,
      source: 'manual',
      applyToInstallmentSiblings: body.applyToInstallmentSiblings === true,
      applyToTransactionIds: body.applyToTransactionIds,
    });
    return c.json(result);
  });

  app.put('/api/transactions/:transactionId/category-override', async (c) => {
    const transactionId = c.req.param('transactionId');
    const body = await parseValidatedJsonBody<{ categoryId: string }>(c, 'categoryOverride');
    upsertTransactionCategoryOverride(ctx.db, transactionId, body.categoryId);
    return c.json({ saved: true });
  });

  app.delete('/api/transactions/:transactionId/category-override', (c) => {
    const transactionId = c.req.param('transactionId');
    clearTransactionCategoryOverride(ctx.db, transactionId);
    return c.json({ cleared: true });
  });
}
