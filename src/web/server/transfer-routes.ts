import type { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { listFilteredTransactionIds } from '../../db/transaction-query.js';
import {
  type ApiTransferPairProposal,
  DEFAULT_TRANSFER_FEE_TOLERANCE_CENTS,
  DEFAULT_TRANSFER_WINDOW_HOURS,
  detectTransferGroups,
  normalizeTransferConfirmBody,
  type TransferPairProposal,
  toApiTransferPairProposal,
} from '../../transfers/detect.js';
import type { WebServerContext } from './context.js';
import { parseTransactionFiltersFromRequest } from './transaction-request.js';
import { parseValidatedJsonBody, validateWebApiBody } from './validate-body.js';

export function registerTransferRoutes(app: Hono, ctx: WebServerContext): void {
  app.get('/api/transfers/suggestions/:transactionId', (c) => {
    const transactionId = c.req.param('transactionId');
    const suggestion = ctx.db
      .prepare(
        `SELECT s.kind, s.confidence, s.amount_confidence, s.time_confidence,
                source.id AS source_id, source.account_id AS source_account_id,
                source.occurred_at AS source_occurred_at, source.amount_cents AS source_amount_cents,
                source.merchant_name AS source_merchant_name, source.description AS source_description,
                destination.id AS destination_id, destination.account_id AS destination_account_id,
                destination.occurred_at AS destination_occurred_at, destination.amount_cents AS destination_amount_cents,
                destination.merchant_name AS destination_merchant_name, destination.description AS destination_description
         FROM transfer_link_suggestions s
         JOIN transactions source ON source.id = s.source_entry_id
         JOIN transactions destination ON destination.id = s.destination_entry_id
         WHERE source_entry_id = ? OR destination_entry_id = ?
         ORDER BY created_at DESC LIMIT 1`,
      )
      .get(transactionId, transactionId) as
      | {
          [key: string]: string | number | null;
          kind: string;
          confidence: number;
          amount_confidence: number;
          time_confidence: number;
        }
      | undefined;
    if (!suggestion) return c.json({ suggestion: null });
    const leg = (prefix: 'source' | 'destination') => ({
      id: String(suggestion[`${prefix}_id`]),
      accountId: String(suggestion[`${prefix}_account_id`]),
      occurredAt: String(suggestion[`${prefix}_occurred_at`]),
      amountCents: Number(suggestion[`${prefix}_amount_cents`]),
      merchantName: suggestion[`${prefix}_merchant_name`] as string | null,
      description: suggestion[`${prefix}_description`] as string | null,
    });
    return c.json({
      suggestion: {
        source: leg('source'),
        destination: leg('destination'),
        kind: suggestion.kind,
        confidence: suggestion.confidence,
        amountConfidence: suggestion.amount_confidence,
        timeConfidence: suggestion.time_confidence,
      },
    });
  });

  app.post('/api/transfers/detect', async (c) => {
    const filters = parseTransactionFiltersFromRequest(c);
    const proposals: ApiTransferPairProposal[] = [];
    const summary = await detectTransferGroups(ctx.db, {
      windowHours: DEFAULT_TRANSFER_WINDOW_HOURS,
      feeToleranceCents: DEFAULT_TRANSFER_FEE_TOLERANCE_CENTS,
      dryRun: true,
      transactionIds: listFilteredTransactionIds(ctx.db, filters),
      onProposal: (proposal) => {
        proposals.push(toApiTransferPairProposal(proposal));
      },
    });
    return c.json({ proposals, summary });
  });

  app.post('/api/transfers/confirm', async (c) => {
    let rawBody: unknown;
    try {
      rawBody = await c.req.json();
    } catch {
      throw new HTTPException(400, { message: 'Invalid JSON body' });
    }

    const body = validateWebApiBody<{ pairs: TransferPairProposal[] }>(
      'transferConfirm',
      normalizeTransferConfirmBody(rawBody),
    );
    await Promise.all(
      body.pairs.map((pair) =>
        detectTransferGroups(ctx.db, {
          windowHours: DEFAULT_TRANSFER_WINDOW_HOURS,
          feeToleranceCents: DEFAULT_TRANSFER_FEE_TOLERANCE_CENTS,
          dryRun: false,
          confirmPair: async () => true,
          singlePair: pair,
        }),
      ),
    );
    return c.json({ linked: body.pairs.length });
  });

  app.post('/api/transfers/link', async (c) => {
    const body = await parseValidatedJsonBody<{ sourceId: string; destinationId: string }>(
      c,
      'transferLink',
    );
    await detectTransferGroups(ctx.db, {
      windowHours: DEFAULT_TRANSFER_WINDOW_HOURS,
      feeToleranceCents: 0,
      dryRun: false,
      manualPair: { sourceId: body.sourceId, destinationId: body.destinationId },
    });
    return c.json({ linked: true });
  });

  app.delete('/api/transfers/link/:groupId', (c) => {
    const groupId = c.req.param('groupId');
    ctx.db.prepare(`DELETE FROM transfer_group_members WHERE group_id = ?`).run(groupId);
    ctx.db.prepare(`DELETE FROM transfer_groups WHERE id = ?`).run(groupId);
    return c.json({ deleted: groupId });
  });
}
