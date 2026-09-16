import type { Hono } from 'hono';
import { SoftDeleteTargetNotFoundError, softDeleteInvestment } from '../../db/entry-deletion.js';
import { enrichInvestmentRow, loadInvestmentRowById } from '../../db/investment-details.js';
import { serializeInvestmentForJson } from '../../db/investments/present.js';
import type { WebServerContext } from './context.js';
import { parseValidatedJsonBody } from './validate-body.js';

export function registerInvestmentRoutes(app: Hono, ctx: WebServerContext): void {
  app.get('/api/investments/:investmentId', (c) => {
    const investment = loadInvestmentRowById(ctx.db, c.req.param('investmentId'));
    if (!investment) {
      return c.json({ error: 'Investment not found' }, 404);
    }
    return c.json({
      investment: serializeInvestmentForJson(enrichInvestmentRow(ctx.db, investment)),
    });
  });

  app.post('/api/investments/:investmentId/delete', async (c) => {
    const investmentId = c.req.param('investmentId');
    const body = await parseValidatedJsonBody<{ deleteReason?: string | null }>(
      c,
      'softDeleteInvestment',
    );
    try {
      return c.json(
        softDeleteInvestment(ctx.db, {
          investmentId,
          deleteReason: body.deleteReason,
        }),
      );
    } catch (error) {
      if (error instanceof SoftDeleteTargetNotFoundError) {
        return c.json({ error: 'Investment not found', missingIds: error.missingIds }, 404);
      }
      throw error;
    }
  });
}
