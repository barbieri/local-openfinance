import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { softDeleteInvestment } from '../src/db/entry-deletion.js';
import { migrateDatabase } from '../src/db/migrate.js';
import {
  buildInvestmentReportSnapshot,
  investmentScopeFingerprint,
} from '../src/intelligence/investment-report-snapshot.js';
import {
  buildInvestmentAllocationCurrencyCharts,
  buildInvestmentAllocationModel,
  type InvestmentAllocationPosition,
  type InvestmentAllocationSelection,
} from '../src/web/client/pages/investments/investment-allocation-chart-data.js';

function openDb(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  migrateDatabase(db);
  db.prepare(
    `INSERT INTO connections (item_id, connector_id, connector_name, status, raw_json, synced_at) VALUES ('item', '1', 'Bank', 'UPDATED', '{}', '2026-01-01T00:00:00Z')`,
  ).run();
  return db;
}

function insertInvestment(
  db: DatabaseSync,
  id: string,
  currency: string,
  cents: number,
  type = 'FIXED',
  subtype = 'CDB',
  code = id,
): void {
  db.prepare(
    `INSERT INTO investments (id, connection_item_id, type, subtype, name, code, balance_cents, currency, raw_json, synced_at) VALUES (?, 'item', ?, ?, ?, ?, ?, ?, '{}', '2026-01-01T00:00:00Z')`,
  ).run(id, type, subtype, id, code, cents, currency);
}

function savePrior(db: DatabaseSync, periodEnd: string, snapshot: unknown, id = periodEnd): void {
  const metadata = snapshotMetadata(snapshot);
  db.prepare(
    `INSERT INTO intelligence_runs (
       id, report_id, period_start, period_end, created_at, subject, alert_count,
       briefing_json, investment_snapshot_version, investment_scope_fingerprint,
       markdown, html, cited_transaction_ids_json
     ) VALUES (?, 'weekly', '2026-01-01', ?, ?, 'x', 0, ?, ?, ?, '', '', '[]')`,
  ).run(
    id,
    periodEnd,
    `${periodEnd}T00:00:00Z`,
    JSON.stringify({ investments: snapshot }),
    metadata.version,
    metadata.scopeFingerprint,
  );
}

function snapshotMetadata(snapshot: unknown): {
  readonly version: number | null;
  readonly scopeFingerprint: string | null;
} {
  if (typeof snapshot !== 'object' || snapshot === null || Array.isArray(snapshot)) {
    return { version: null, scopeFingerprint: null };
  }
  const record = snapshot as Record<string, unknown>;
  return {
    version: typeof record['version'] === 'number' ? record['version'] : null,
    scopeFingerprint:
      typeof record['scopeFingerprint'] === 'string' ? record['scopeFingerprint'] : null,
  };
}

function position(
  id: string,
  currency: string,
  type: string,
  subtype: string,
  code: string | null,
  allocationCents: number,
): InvestmentAllocationPosition {
  return {
    id,
    currency,
    type,
    subtype,
    code,
    displayName: id,
    totalCents: allocationCents,
    allocationCents,
  };
}

describe('investment report snapshot', () => {
  it('separates currencies, excludes deleted rows, and has qualified hierarchy identities', () => {
    const db = openDb();
    insertInvestment(db, 'shown', 'BRL', 20_000, 'FIXED', 'CDB', 'CDB1');
    insertInvestment(db, 'usd', 'USD', 30_000, 'FIXED', 'CDB', 'CDB1');
    insertInvestment(db, 'hidden', 'BRL', 90_000, 'OTHER', 'ETF', 'HIDDEN');
    softDeleteInvestment(db, { investmentId: 'hidden', deletedAt: '2026-09-16T00:00:00Z' });
    const snapshot = buildInvestmentReportSnapshot(
      db,
      'weekly',
      { start: '2026-02-01', end: '2026-02-07' },
      { accountIds: [] },
    );
    expect(snapshot).toMatchObject({ availability: 'included', previousPeriodEnd: null });
    if (snapshot.availability !== 'included') throw new Error('expected included');
    expect(snapshot.currencies).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          currency: 'BRL',
          totalCents: 20_000,
          type: [expect.objectContaining({ id: 'FIXED' })],
          subtype: [expect.objectContaining({ id: 'FIXED / CDB' })],
          code: [expect.objectContaining({ id: 'FIXED / CDB / code:CDB1' })],
        }),
        expect.objectContaining({ currency: 'USD', totalCents: 30_000 }),
      ]),
    );
  });

  it('omits a currency with only zero-value investment rows', () => {
    const db = openDb();
    insertInvestment(db, 'zero-usd', 'USD', 0);
    insertInvestment(db, 'shown-brl', 'BRL', 20_000);
    const snapshot = buildInvestmentReportSnapshot(
      db,
      'weekly',
      { start: '2026-02-01', end: '2026-02-07' },
      { accountIds: [] },
    );
    if (snapshot.availability !== 'included') throw new Error('expected included');
    expect(snapshot.currencies).toEqual([
      expect.objectContaining({ currency: 'BRL', totalCents: 20_000 }),
    ]);
  });

  it('excludes account-scoped reports without expanding them to a connection', () => {
    const snapshot = buildInvestmentReportSnapshot(
      openDb(),
      'weekly',
      { start: '2026-02-01', end: '2026-02-07' },
      { accountIds: ['account-1'] },
    );
    expect(snapshot).toMatchObject({
      availability: 'excluded',
      currencies: [],
      previousPeriodEnd: null,
    });
  });

  it('uses code when present and investment id when a code is absent', () => {
    const db = openDb();
    insertInvestment(db, 'stable-id', 'BRL', 10_000, 'FIXED', 'CDB', '');
    db.prepare("UPDATE investments SET code = NULL WHERE id = 'stable-id'").run();
    const first = buildInvestmentReportSnapshot(
      db,
      'weekly',
      { start: '2026-02-01', end: '2026-02-07' },
      { accountIds: [] },
    );
    if (first.availability !== 'included') throw new Error('expected included');
    const stored = { ...first, materialChanges: [] };
    savePrior(db, '2026-01-31', stored);
    db.prepare("UPDATE investments SET name = 'Renamed by provider' WHERE id = 'stable-id'").run();
    const renamed = buildInvestmentReportSnapshot(
      db,
      'weekly',
      { start: '2026-02-01', end: '2026-02-07' },
      { accountIds: [] },
    );
    expect(renamed.availability === 'included' && renamed.materialChanges).toEqual([]);
    expect(first.currencies[0]?.code[0]?.id).toBe('FIXED / CDB / investment:stable-id');
  });

  it('uses the report hierarchy for the allocation charts across currencies', () => {
    const db = openDb();
    insertInvestment(db, 'brl-cdb-1', 'BRL', 10_000, 'FIXED', 'CDB', 'CDB1');
    insertInvestment(db, 'brl-cdb-2', 'BRL', 20_000, 'FIXED', 'CDB', 'CDB2');
    insertInvestment(db, 'brl-etf', 'BRL', 30_000, 'VARIABLE', 'ETF', 'ETF1');
    insertInvestment(db, 'usd-cdb', 'USD', 40_000, 'FIXED', 'CDB', 'USD1');
    insertInvestment(db, 'fallback', 'USD', 5_000, 'FIXED', 'CDB', 'placeholder');
    db.prepare("UPDATE investments SET code = NULL WHERE id = 'fallback'").run();
    const snapshot = buildInvestmentReportSnapshot(
      db,
      'weekly',
      { start: '2026-02-01', end: '2026-02-07' },
      { accountIds: [] },
    );
    if (snapshot.availability !== 'included') throw new Error('expected included');
    const positions: readonly InvestmentAllocationPosition[] = [
      position('brl-cdb-1', 'BRL', 'FIXED', 'CDB', 'CDB1', 10_000),
      position('brl-cdb-2', 'BRL', 'FIXED', 'CDB', 'CDB2', 20_000),
      position('brl-etf', 'BRL', 'VARIABLE', 'ETF', 'ETF1', 30_000),
      position('usd-cdb', 'USD', 'FIXED', 'CDB', 'USD1', 40_000),
      position('fallback', 'USD', 'FIXED', 'CDB', null, 5_000),
    ];
    const model = buildInvestmentAllocationModel(positions);
    const buckets = (
      currency: string,
      selection: InvestmentAllocationSelection = { typeId: null, subtypeId: null, codeId: null },
    ) => {
      const chart = buildInvestmentAllocationCurrencyCharts(model, { [currency]: selection }).find(
        (candidate) => candidate.currency === currency,
      );
      if (!chart) throw new Error(`missing ${currency} allocation chart`);
      return chart;
    };
    const compact = (values: readonly { readonly id: string; readonly cents: number }[]) =>
      values.map(({ id, cents }) => ({ id, cents }));

    for (const currency of snapshot.currencies) {
      expect(compact(buckets(currency.currency).types)).toEqual(compact(currency.type));
      for (const type of currency.type) {
        const typeChart = buckets(currency.currency, {
          typeId: type.id,
          subtypeId: null,
          codeId: null,
        });
        const subtypes = currency.subtype.filter((bucket) => bucket.id.startsWith(`${type.id} / `));
        expect(compact(typeChart.subtypes)).toEqual(compact(subtypes));
        for (const subtype of subtypes) {
          const subtypeChart = buckets(currency.currency, {
            typeId: type.id,
            subtypeId: subtype.id,
            codeId: null,
          });
          expect(compact(subtypeChart.codes)).toEqual(
            compact(currency.code.filter((bucket) => bucket.id.startsWith(`${subtype.id} / `))),
          );
        }
      }
    }
  });

  it('uses the newest valid compatible earlier period and marks strict material changes', () => {
    const db = openDb();
    insertInvestment(db, 'one', 'BRL', 10_200, 'FIXED', 'CDB', 'ONE');
    const fingerprint = investmentScopeFingerprint([]);
    const prior = {
      version: 2,
      scopeFingerprint: fingerprint,
      availability: 'included',
      previousPeriodEnd: null,
      currencies: [
        {
          currency: 'BRL',
          totalCents: 10_000,
          count: 1,
          type: [{ id: 'FIXED', label: 'FIXED', cents: 10_000, count: 1 }],
          subtype: [{ id: 'FIXED / CDB', label: 'FIXED / CDB', cents: 10_000, count: 1 }],
          code: [{ id: 'FIXED / CDB / code:ONE', label: 'ONE', cents: 10_000, count: 1 }],
        },
      ],
      materialChanges: [],
    };
    savePrior(db, '2026-02-01', prior);
    savePrior(db, '2026-02-06', { ...prior, scopeFingerprint: 'wrong' }, 'wrong');
    savePrior(db, '2026-02-05', { bad: true }, 'bad');
    const snapshot = buildInvestmentReportSnapshot(
      db,
      'weekly',
      { start: '2026-02-02', end: '2026-02-07' },
      { accountIds: [] },
    );
    if (snapshot.availability !== 'included') throw new Error('expected included');
    expect(snapshot.previousPeriodEnd).toBe('2026-02-01');
    expect(snapshot.materialChanges.some((change) => change.kind === 'changed')).toBe(true);
    db.prepare("UPDATE investments SET balance_cents = 10100 WHERE id = 'one'").run();
    const exact = buildInvestmentReportSnapshot(
      db,
      'weekly',
      { start: '2026-02-02', end: '2026-02-07' },
      { accountIds: [] },
    );
    expect(exact.availability === 'included' && exact.materialChanges).toEqual([]);
  });

  it('makes added and removed buckets, including a removed currency, material', () => {
    const db = openDb();
    insertInvestment(db, 'new', 'BRL', 20_000, 'NEW', 'A', 'NEW');
    const fingerprint = investmentScopeFingerprint([]);
    savePrior(db, '2026-02-01', {
      version: 2,
      scopeFingerprint: fingerprint,
      availability: 'included',
      previousPeriodEnd: null,
      currencies: [
        {
          currency: 'USD',
          totalCents: 10_000,
          count: 1,
          type: [{ id: 'OLD', label: 'OLD', cents: 10_000, count: 1 }],
          subtype: [{ id: 'OLD / X', label: 'OLD / X', cents: 10_000, count: 1 }],
          code: [{ id: 'OLD / X / code:OLD', label: 'OLD', cents: 10_000, count: 1 }],
        },
      ],
      materialChanges: [],
    });
    const snapshot = buildInvestmentReportSnapshot(
      db,
      'weekly',
      { start: '2026-02-02', end: '2026-02-07' },
      { accountIds: [] },
    );
    if (snapshot.availability !== 'included') throw new Error('expected included');
    expect(snapshot.materialChanges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          currency: 'BRL',
          dimension: 'total',
          kind: 'added',
          percent: null,
        }),
        expect.objectContaining({
          currency: 'USD',
          dimension: 'total',
          kind: 'removed',
          percent: null,
        }),
      ]),
    );
  });
});
