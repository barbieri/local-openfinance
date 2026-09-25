import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config/load-config.js';
import { listEnrichedTransactionPage } from '../src/db/enriched-transactions.js';
import { saveIntelligenceTaxonomyPolicy } from '../src/db/intelligence.js';
import { migrateDatabase } from '../src/db/migrate.js';
import {
  loadReportTransactionChartDataset,
  resolveReportQueryScope,
} from '../src/intelligence/report-scope.js';
import { executeIntelligenceTool } from '../src/intelligence/tools.js';
import type { ResolvedConfig } from '../src/types.js';
import { decodeTableState } from '../src/web/client/lib/table-url-state.js';
import { buildTransactionListQuery } from '../src/web/client/lib/transaction-filters.js';
import { buildTransactionFilterQuery } from '../src/web/server/transaction-request.js';
import { parseTransactionWebFilters } from '../src/web/server/transactions-list.js';

function openDb(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  migrateDatabase(db);
  db.prepare(
    `INSERT INTO connections (item_id, connector_id, connector_name, status, raw_json, synced_at)
     VALUES ('item-1', '601', 'Itau', 'UPDATED', '{}', '2026-08-16T00:00:00.000Z')`,
  ).run();
  db.prepare(
    `INSERT INTO accounts (
       id, connection_item_id, type, name, currency, raw_json, synced_at, balance_cents
     ) VALUES (
       'acct-1', 'item-1', 'BANK', 'Checking', 'BRL', '{}',
       '2026-08-16T00:00:00.000Z', 100000
     )`,
  ).run();
  saveIntelligenceTaxonomyPolicy(db, {
    reportId: 'weekly',
    taxonomyHash: 'empty-test-policy',
    policyJson: '{"decisions":[]}',
  });
  return db;
}

async function resolvedConfig(useCreditPurchaseDate: boolean): Promise<ResolvedConfig> {
  const resolved = await loadConfig('examples/expenses-config.json');
  return {
    ...resolved,
    config: {
      ...resolved.config,
      report: { ...resolved.config.report, useCreditPurchaseDate },
    },
  };
}

describe('intelligence transaction date basis', () => {
  it.each([
    {
      useCreditPurchaseDate: false,
      occurredAt: '2026-08-10T03:00:00.000Z',
      purchaseDate: '2026-09-12',
      expectedDisplayDate: '2026-08-10T03:00:00.000Z',
    },
    {
      useCreditPurchaseDate: true,
      occurredAt: '2026-09-12T12:00:00.000Z',
      purchaseDate: '2026-08-10',
      expectedDisplayDate: '2026-08-10',
    },
  ])(
    'uses the configured date basis for list, detail, chart, and evidence when useCreditPurchaseDate=$useCreditPurchaseDate',
    async ({ useCreditPurchaseDate, occurredAt, purchaseDate, expectedDisplayDate }) => {
      const db = openDb();
      const resolved = await resolvedConfig(useCreditPurchaseDate);
      db.prepare(
        `INSERT INTO transactions (
           id, account_id, occurred_at, amount_cents, currency, description, raw_json, synced_at
         ) VALUES (?, 'acct-1', ?, -50000, 'BRL', 'Date basis', ?,
                   '2026-09-13T00:00:00.000Z')`,
      ).run('date-basis', occurredAt, JSON.stringify({ creditCardMetadata: { purchaseDate } }));
      const context = {
        db,
        resolved,
        now: new Date('2026-08-21T12:00:00.000Z'),
        timeZone: 'America/Sao_Paulo',
      };

      const listed = executeIntelligenceTool(context, 'weekly', 'list_transactions', {}) as {
        readonly result: {
          readonly rows: readonly {
            readonly id: string;
            readonly localDate: string;
            readonly occurredAt: string;
          }[];
        };
      };
      const detail = executeIntelligenceTool(context, 'weekly', 'get_transaction', {
        id: 'date-basis',
      }) as {
        readonly result: {
          readonly id: string;
          readonly localDate: string;
          readonly occurredAt: string;
        };
      };
      const scope = resolveReportQueryScope(resolved, 'weekly', context);
      const chart = loadReportTransactionChartDataset(db, scope);
      const briefing = executeIntelligenceTool(context, 'weekly', 'briefing', {}) as {
        readonly result: {
          readonly analysis: { readonly candidates: readonly { readonly id: string }[] };
        };
      };

      expect(listed.result.rows.map((row) => row.id)).toEqual(['date-basis']);
      expect(listed.result.rows[0]).toMatchObject({
        localDate: '2026-08-10',
        occurredAt: expectedDisplayDate,
      });
      expect(detail.result).toMatchObject({
        id: 'date-basis',
        localDate: '2026-08-10',
        occurredAt: expectedDisplayDate,
      });
      expect(chart.total).toBe(1);
      expect(briefing.result.analysis.candidates.map((candidate) => candidate.id)).toContain(
        'transaction:date-basis',
      );
    },
  );

  it('keeps purchase calendar boundaries and converts timestamp and fallback instants', async () => {
    const db = openDb();
    const resolved = await resolvedConfig(true);
    db.prepare(
      `INSERT INTO categories (
         id, name, name_translated, parent_id, parent_name, raw_json, synced_at
       ) VALUES ('food', 'Food', 'Food', NULL, NULL, '{}', '2026-08-17T03:00:00.000Z')`,
    ).run();
    const insert = db.prepare(
      `INSERT INTO transactions (
         id, account_id, occurred_at, amount_cents, currency, description, category_id,
         raw_json, synced_at
       ) VALUES (?, 'acct-1', ?, -50000, 'BRL', ?, 'food', ?, '2026-09-13T00:00:00.000Z')`,
    );
    const rows = [
      {
        id: 'purchase-start',
        occurredAt: '2026-09-10T12:00:00.000Z',
        purchaseDate: '2026-08-10',
      },
      {
        id: 'purchase-end',
        occurredAt: '2026-09-16T12:00:00.000Z',
        purchaseDate: '2026-08-16',
      },
      {
        id: 'purchase-timestamp',
        occurredAt: '2026-09-17T12:00:00.000Z',
        purchaseDate: '2026-08-17T01:00:00.000Z',
      },
      {
        id: 'occurred-fallback',
        occurredAt: '2026-08-17T01:00:00.000Z',
        purchaseDate: null,
      },
      {
        id: 'timestamp-before-start',
        occurredAt: '2026-09-09T12:00:00.000Z',
        purchaseDate: '2026-08-10T02:59:59.999Z',
      },
      {
        id: 'fallback-after-end',
        occurredAt: '2026-08-17T03:00:00.000Z',
        purchaseDate: null,
      },
    ] as const;
    for (const row of rows) {
      insert.run(
        row.id,
        row.occurredAt,
        row.id,
        JSON.stringify(
          row.purchaseDate ? { creditCardMetadata: { purchaseDate: row.purchaseDate } } : {},
        ),
      );
    }
    const context = {
      db,
      resolved,
      now: new Date('2026-08-21T12:00:00.000Z'),
      timeZone: 'America/Sao_Paulo',
    };

    const listed = executeIntelligenceTool(context, 'weekly', 'list_transactions', {
      limit: 50,
      sort: 'date:asc',
    }) as {
      readonly result: {
        readonly rows: readonly {
          readonly id: string;
          readonly localDate: string;
          readonly occurredAt: string;
        }[];
      };
    };
    const expectedIds = [
      'purchase-start',
      'purchase-end',
      'purchase-timestamp',
      'occurred-fallback',
    ];
    expect(listed.result.rows.map((row) => row.id).toSorted()).toEqual(expectedIds.toSorted());
    expect(listed.result.rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'purchase-start',
          localDate: '2026-08-10',
          occurredAt: '2026-08-10',
        }),
        expect.objectContaining({
          id: 'purchase-end',
          localDate: '2026-08-16',
          occurredAt: '2026-08-16',
        }),
        expect.objectContaining({
          id: 'purchase-timestamp',
          localDate: '2026-08-16',
          occurredAt: '2026-08-17T01:00:00.000Z',
        }),
        expect.objectContaining({
          id: 'occurred-fallback',
          localDate: '2026-08-16',
          occurredAt: '2026-08-17T01:00:00.000Z',
        }),
      ]),
    );

    const detail = executeIntelligenceTool(context, 'weekly', 'get_transaction', {
      id: 'purchase-start',
    }) as { readonly result: { readonly localDate: string; readonly occurredAt: string } };
    expect(detail.result).toEqual(
      expect.objectContaining({ localDate: '2026-08-10', occurredAt: '2026-08-10' }),
    );

    const scope = resolveReportQueryScope(resolved, 'weekly', context);
    const chart = loadReportTransactionChartDataset(db, scope);
    expect(chart).toMatchObject({ total: 4, categoryTotals: { food: 200_000 } });
    const briefing = executeIntelligenceTool(context, 'weekly', 'briefing', {}) as {
      readonly result: {
        readonly analysis: {
          readonly chart: readonly {
            readonly start: string;
            readonly end: string;
            readonly expenseCents: number;
          }[];
        };
      };
    };
    expect(
      briefing.result.analysis.chart.find(
        (period) => period.start === '2026-08-10' && period.end === '2026-08-16',
      )?.expenseCents,
    ).toBe(200_000);

    const link = executeIntelligenceTool(context, 'weekly', 'report_link', {
      kind: 'category',
      id: 'food',
    }) as { readonly result: { readonly href: string } };
    const state = decodeTableState(link.result.href.split('/s=')[1] ?? '');
    if (!state) throw new Error('Report evidence link state did not decode');
    const query = new URLSearchParams(buildTransactionListQuery(state));
    const filters = parseTransactionWebFilters(
      buildTransactionFilterQuery((name) => query.get(name) ?? undefined),
    );
    const rediscovered = listEnrichedTransactionPage(db, filters, {
      limit: 50,
      offset: 0,
      timeZone: 'America/Sao_Paulo',
    });
    expect(rediscovered.rows.map((row) => row.id).toSorted()).toEqual(expectedIds.toSorted());
  });
});
