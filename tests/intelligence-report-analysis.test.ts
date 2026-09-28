import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { saveEntryAnnotation } from '../src/annotation/store.js';
import { loadConfig } from '../src/config/load-config.js';
import { migrateDatabase } from '../src/db/migrate.js';
import {
  buildReportAnalysis,
  buildReportAnalysisPacket,
  type ReportCandidate,
  type ReportProfile,
  selectAnalysisProfiles,
} from '../src/intelligence/report-analysis.js';
import { buildMonthlyComparisonTable } from '../src/intelligence/report-runner.js';
import { resolveReportQueryScope } from '../src/intelligence/report-scope.js';
import { resolveTaxonomyTreatment } from '../src/intelligence/report-taxonomy-policy.js';

function openDb(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  migrateDatabase(db);
  db.prepare(
    `INSERT INTO connections (item_id, connector_id, connector_name, status, raw_json, synced_at)
     VALUES ('item-1', '601', 'Bank', 'UPDATED', '{}', '2026-08-17T00:00:00.000Z')`,
  ).run();
  db.prepare(
    `INSERT INTO accounts (
       id, connection_item_id, type, name, currency, raw_json, synced_at, balance_cents
     ) VALUES
       ('card', 'item-1', 'CREDIT', 'Card', 'BRL', '{}', '2026-08-17T00:00:00.000Z', 0),
       ('bank', 'item-1', 'BANK', 'Checking', 'BRL', '{}', '2026-08-17T00:00:00.000Z', 0)`,
  ).run();
  db.prepare(
    `INSERT INTO annotation_categories (id, name, parent_id, created_at) VALUES
       ('purchases', 'Compras', NULL, '2026-01-01T00:00:00.000Z'),
       ('investments', 'Investimentos', NULL, '2026-01-01T00:00:00.000Z'),
       ('same-person', 'Transferência mesma titularidade', NULL, '2026-01-01T00:00:00.000Z')`,
  ).run();
  db.prepare(
    `INSERT INTO annotation_labels (id, name, parent_id, created_at) VALUES
       ('transport', 'Transporte', NULL, '2026-01-01T00:00:00.000Z'),
       ('accessories', 'Acessórios', 'transport', '2026-01-01T00:00:00.000Z'),
       ('investment-label', 'Investimentos', NULL, '2026-01-01T00:00:00.000Z'),
       ('offshore', 'Offshore', 'investment-label', '2026-01-01T00:00:00.000Z')`,
  ).run();
  return db;
}

function insertTransaction(
  db: DatabaseSync,
  id: string,
  accountId: string,
  date: string,
  cents: number,
  description: string,
): void {
  db.prepare(
    `INSERT INTO transactions (
       id, account_id, occurred_at, amount_cents, currency, description, raw_json, synced_at
     ) VALUES (?, ?, ?, ?, 'BRL', ?, '{}', '2026-08-17T00:00:00.000Z')`,
  ).run(id, accountId, `${date}T12:00:00.000Z`, cents, description);
}

function analysisProfile(index: number): ReportProfile {
  return {
    key: `category:${index}`,
    kind: 'category',
    id: String(index),
    path: `Category ${index}`,
    depth: 1,
    pattern: 'undefined',
    basis: 'active-day',
    stats: {
      n: 1,
      averageCents: 1,
      standardDeviationCents: 0,
      medianCents: 1,
      minCents: 1,
      maxCents: 1,
    },
    history: {
      facts: 1,
      first: '2026-01-01',
      last: '2026-01-01',
      activeMonths: 1,
      spanMonths: 1,
      monthlyCoverage: 1,
      bursts: 0,
    },
    current: {
      facts: 1,
      cents: 14 - index,
      comparable: false,
      deltaCents: null,
      deltaRatio: null,
      zScore: null,
      expectedness: 'no-baseline',
    },
  };
}

function analysisCandidate(id: string, profileRefs: readonly string[]): ReportCandidate {
  return {
    id,
    kind: 'aggregate',
    importance: 1,
    title: id,
    amount: 'R$ 1,00',
    signal: 'no-baseline',
    transactionIds: [],
    profileRefs,
    evidence: [],
  };
}

describe('deterministic report analysis', () => {
  it('compares only complete year-over-year months from scoped raw coverage', async () => {
    const db = openDb();
    for (const [id, account, date, cents] of [
      ['first', 'bank', '2025-06-10', -1_000],
      ['july-prior-expense', 'bank', '2025-07-10', -10_000],
      ['july-prior-income', 'bank', '2025-07-12', 5_000],
      ['july-refund', 'card', '2025-07-13', -700],
      ['august-prior-expense', 'bank', '2025-08-10', -20_000],
      ['august-prior-income', 'bank', '2025-08-12', 6_000],
      ['july-current-expense', 'bank', '2026-07-10', -30_000],
      ['july-current-income', 'bank', '2026-07-12', 7_000],
      ['august-current-expense', 'bank', '2026-08-10', -40_000],
      ['august-current-income', 'bank', '2026-08-12', 8_000],
    ] as const)
      insertTransaction(db, id, account, date, cents, id);
    const loaded = await loadConfig('examples/expenses-config.json');
    const resolved = {
      ...loaded,
      config: {
        ...loaded.config,
        intelligence: { ...loaded.config.intelligence, rareLookbackYears: 1 },
      },
    };
    const period = { start: '2026-08-01', end: '2026-08-31' };
    const scope = resolveReportQueryScope(resolved, 'monthly', { timeZone: 'UTC', period });
    const analysis = buildReportAnalysis({ db, resolved, scope, policy: { decisions: [] } });

    expect(analysis.chart).toHaveLength(12);
    expect(analysis.yearOverYear).toEqual({
      priorYear: 2025,
      currentYear: 2026,
      months: [
        ...Array.from({ length: 5 }, (_, index) => ({
          kind: 'omitted',
          month: index + 1,
          reason: 'unavailable',
        })),
        { kind: 'omitted', month: 6, reason: 'partial' },
        {
          kind: 'comparable',
          month: 7,
          prior: { expenseCents: 10_000, incomeCents: 5_000 },
          current: { expenseCents: 30_000, incomeCents: 7_000 },
        },
        {
          kind: 'comparable',
          month: 8,
          prior: { expenseCents: 20_000, incomeCents: 6_000 },
          current: { expenseCents: 40_000, incomeCents: 8_000 },
        },
      ],
    });

    const partialScope = resolveReportQueryScope(resolved, 'monthly', {
      timeZone: 'UTC',
      period: { start: '2026-08-01', end: '2026-08-15' },
    });
    const partial = buildReportAnalysis({
      db,
      resolved,
      scope: partialScope,
      policy: { decisions: [] },
    });
    expect(partial.yearOverYear?.months.at(-1)).toEqual({
      kind: 'omitted',
      month: 8,
      reason: 'partial',
    });
    expect(partial.chart).toHaveLength(12);
  });

  it('derives year-over-year coverage before the bounded analysis history', async () => {
    const db = openDb();
    insertTransaction(db, 'coverage', 'bank', '2024-12-31', -100, 'coverage');
    insertTransaction(db, 'january-prior', 'bank', '2025-01-10', -1_000, 'january prior');
    insertTransaction(db, 'january-current', 'bank', '2026-01-10', -2_000, 'january current');
    const loaded = await loadConfig('examples/expenses-config.json');
    const resolved = {
      ...loaded,
      config: {
        ...loaded.config,
        intelligence: { ...loaded.config.intelligence, rareLookbackYears: 1 },
      },
    };
    const scope = resolveReportQueryScope(resolved, 'monthly', {
      timeZone: 'UTC',
      period: { start: '2026-08-01', end: '2026-08-31' },
    });

    const analysis = buildReportAnalysis({ db, resolved, scope, policy: { decisions: [] } });

    expect(analysis.yearOverYear?.months[0]).toEqual({
      kind: 'comparable',
      month: 1,
      prior: { expenseCents: 1_000, incomeCents: 0 },
      current: { expenseCents: 2_000, incomeCents: 0 },
    });
  });

  it('keeps must-report profile references beyond the normal profile limit', () => {
    const profiles = Array.from({ length: 14 }, (_, index) => analysisProfile(index));
    const candidates = profiles.map((profile, index) =>
      analysisCandidate(`candidate-${index}`, [profile.key]),
    );

    const selected = selectAnalysisProfiles(profiles, candidates, ['candidate-13']);

    expect(selected).toHaveLength(13);
    expect(selected.map((profile) => profile.key)).toContain('category:13');
  });

  it('lets a deeper semantic decision override its parent while internal always wins', () => {
    const policy = {
      decisions: [
        {
          kind: 'category' as const,
          id: 'investments',
          path: 'Investments',
          treatment: 'portfolio-movement' as const,
          confidence: 1,
          reason: 'Portfolio parent.',
        },
        {
          kind: 'category' as const,
          id: 'dividends',
          path: 'Investments > Dividends',
          treatment: 'reportable' as const,
          confidence: 1,
          reason: 'Reportable income.',
        },
        {
          kind: 'label' as const,
          id: 'own-transfer',
          path: 'Own transfer',
          treatment: 'internal-own-account' as const,
          confidence: 1,
          reason: 'Own accounts.',
        },
      ],
    };
    const dividends = [
      { kind: 'category' as const, id: 'investments', path: 'Investments', depth: 1 },
      {
        kind: 'category' as const,
        id: 'dividends',
        path: 'Investments > Dividends',
        depth: 2,
      },
    ];

    expect(resolveTaxonomyTreatment(dividends, policy)).toBe('reportable');
    expect(
      resolveTaxonomyTreatment(
        [...dividends, { kind: 'label', id: 'own-transfer', path: 'Own transfer', depth: 1 }],
        policy,
      ),
    ).toBe('internal-own-account');
    expect(
      resolveTaxonomyTreatment(
        [{ kind: 'label', id: 'uncertain-own', path: 'Possible own transfer', depth: 1 }],
        {
          decisions: [
            {
              kind: 'label',
              id: 'uncertain-own',
              path: 'Possible own transfer',
              treatment: 'internal-own-account',
              confidence: 0.79,
              reason: 'Not confident enough.',
            },
          ],
        },
      ),
    ).toBe('uncertain');
  });

  it('uses semantic exclusions, credit-card signs, suggestions, and taxonomy correlations', async () => {
    const db = openDb();
    insertTransaction(db, 'old-accessory-1', 'card', '2026-05-10', 4_000, 'PAYPAL');
    insertTransaction(db, 'old-accessory-2', 'card', '2026-06-10', 6_000, 'PAYPAL');
    insertTransaction(
      db,
      'bmw-accessory',
      'card',
      '2026-08-13',
      192_631,
      'Acessórios BMW R1300RT (interior das malas, proteção de mala)',
    );
    db.prepare("UPDATE transactions SET merchant_name = 'PAYPAL' WHERE id = 'bmw-accessory'").run();
    for (const id of ['old-accessory-1', 'old-accessory-2', 'bmw-accessory']) {
      await saveEntryAnnotation(db, {
        entryType: 'transaction',
        entryId: id,
        categoryId: 'purchases',
        labelIds: ['accessories'],
        source: 'manual',
      });
    }
    insertTransaction(db, 'semantic-transfer', 'bank', '2026-08-14', -500_000, 'Transfer');
    await saveEntryAnnotation(db, {
      entryType: 'transaction',
      entryId: 'semantic-transfer',
      categoryId: 'same-person',
      source: 'manual',
    });
    insertTransaction(db, 'high-suggestion', 'bank', '2026-08-15', -20_000, 'Suggested');
    insertTransaction(db, 'low-suggestion', 'bank', '2026-08-15', -30_000, 'Low suggestion');
    const insertSuggestion = db.prepare(
      `INSERT INTO annotation_assist_suggestions (
         entry_type, entry_id, status, proposal_json, examples_json, confidence,
         used_classifier, computed_at, review_status
       ) VALUES ('transaction', ?, 'ok', ?, '[]', ?, 0, '2026-08-15T00:00:00.000Z', 'pending')`,
    );
    insertSuggestion.run('high-suggestion', '{"categoryId":"purchases"}', 0.9);
    insertSuggestion.run('low-suggestion', '{"categoryId":"purchases"}', 0.81);
    db.prepare(
      `INSERT INTO entry_annotations (
         id, entry_type, entry_id, source, created_at, updated_at
       ) VALUES (
         'empty-high-suggestion', 'transaction', 'high-suggestion', 'manual',
         '2026-08-15T00:00:00.000Z', '2026-08-15T00:00:00.000Z'
       )`,
    ).run();

    const resolved = await loadConfig('examples/expenses-config.json');
    const scope = resolveReportQueryScope(resolved, 'weekly', {
      timeZone: 'UTC',
      period: { start: '2026-08-10', end: '2026-08-16' },
    });
    const analysis = buildReportAnalysis({
      db,
      resolved,
      scope,
      policy: {
        decisions: [
          {
            kind: 'category',
            id: 'same-person',
            path: 'Transferência mesma titularidade',
            treatment: 'internal-own-account',
            confidence: 1,
            reason: 'Own-account movement.',
          },
        ],
      },
    });

    expect(analysis.excluded.internal.semantic).toBe(1);
    expect(analysis.summary.expense).toContain('2.426,31');
    expect(analysis.classification['assumed-suggestion']).toBe(1);
    expect(analysis.classification.unclassified).toBe(1);
    const candidate = analysis.candidates.find((item) => item.id === 'transaction:bmw-accessory');
    expect(candidate?.driver?.detail).toContain('Acessórios BMW R1300RT');
    expect(candidate?.preferredProfileRef).toBe('label:accessories');
    expect(candidate?.profileRefs).toHaveLength(2);
    expect(candidate?.driver?.labels).toContain('Transporte > Acessórios');
    const profileKeys = new Set(analysis.profiles.map((profile) => profile.key));
    expect(
      analysis.candidates
        .filter((item) => analysis.mustReport.includes(item.id))
        .flatMap((item) => item.profileRefs)
        .every((key) => profileKeys.has(key)),
    ).toBe(true);
    expect(JSON.stringify(analysis)).not.toContain('semantic-transfer');
  });

  it('uses the payer document for masked incoming transactions', async () => {
    const db = openDb();
    insertTransaction(db, 'masked-income', 'bank', '2026-08-13', 50_000, '***.729.378-**');
    db.prepare(
      `UPDATE transactions
       SET merchant_name = '***.729.378-**',
           raw_json = ?
       WHERE id = 'masked-income'`,
    ).run(
      JSON.stringify({
        paymentData: {
          payer: { documentNumber: { type: 'CPF', value: '52998224725' } },
          receiver: 'Conta do usuário',
        },
      }),
    );
    const resolved = await loadConfig('examples/expenses-config.json');
    const scope = resolveReportQueryScope(resolved, 'weekly', {
      timeZone: 'UTC',
      period: { start: '2026-08-10', end: '2026-08-16' },
    });

    const packet = buildReportAnalysisPacket({
      db,
      resolved,
      scope,
      policy: { decisions: [] },
    });

    expect(packet.reportableFacts.find((fact) => fact.id === 'masked-income')?.party).toBe(
      'CPF: 52998224725',
    );
  });

  it('does not compare one transaction with a monthly profile baseline', async () => {
    const db = openDb();
    for (const [index, date] of [
      '2026-04-10',
      '2026-05-10',
      '2026-06-10',
      '2026-07-10',
    ].entries()) {
      const id = `monthly-${index}`;
      insertTransaction(db, id, 'bank', date, -100_000, 'Monthly household costs');
      await saveEntryAnnotation(db, {
        entryType: 'transaction',
        entryId: id,
        categoryId: 'purchases',
        source: 'manual',
      });
    }
    insertTransaction(db, 'current-purchase', 'bank', '2026-08-12', -150_000, 'One purchase');
    await saveEntryAnnotation(db, {
      entryType: 'transaction',
      entryId: 'current-purchase',
      categoryId: 'purchases',
      source: 'manual',
    });
    const resolved = await loadConfig('examples/expenses-config.json');
    const scope = resolveReportQueryScope(resolved, 'weekly', {
      timeZone: 'UTC',
      period: { start: '2026-08-10', end: '2026-08-16' },
    });

    const analysis = buildReportAnalysis({ db, resolved, scope, policy: { decisions: [] } });
    const candidate = analysis.candidates.find(
      (item) => item.id === 'transaction:current-purchase',
    );

    expect(candidate).toMatchObject({ signal: 'no-baseline', profileRefs: ['category:purchases'] });
    expect(candidate?.preferredProfileRef).toBeUndefined();
    expect(candidate?.baseline).toBeUndefined();
    expect(analysis.profiles.find((profile) => profile.key === 'category:purchases')?.basis).toBe(
      'month',
    );
  });

  it('does not promote an aggregate neutralized by an offset or a negligible shared driver', async () => {
    const db = openDb();
    insertTransaction(db, 'historical', 'bank', '2026-06-10', -100_000, 'Historical purchase');
    insertTransaction(db, 'offset-expense', 'bank', '2026-08-10', -816_666, 'Temporary out');
    insertTransaction(db, 'offset-income', 'bank', '2026-08-13', 816_666, 'Temporary in');
    insertTransaction(db, 'large-driver', 'card', '2026-08-12', 500_000, 'Large accessory');
    insertTransaction(db, 'minor-driver', 'card', '2026-08-12', 10_000, 'Minor accessory');
    for (const id of ['historical', 'offset-expense']) {
      await saveEntryAnnotation(db, {
        entryType: 'transaction',
        entryId: id,
        categoryId: 'purchases',
        source: 'manual',
      });
    }
    for (const id of ['large-driver', 'minor-driver']) {
      await saveEntryAnnotation(db, {
        entryType: 'transaction',
        entryId: id,
        categoryId: 'purchases',
        labelIds: ['accessories'],
        source: 'manual',
      });
    }
    const resolved = await loadConfig('examples/expenses-config.json');
    const scope = resolveReportQueryScope(resolved, 'weekly', {
      timeZone: 'UTC',
      period: { start: '2026-08-10', end: '2026-08-16' },
    });
    const analysis = buildReportAnalysis({ db, resolved, scope, policy: { decisions: [] } });

    expect(analysis.candidates.some((item) => item.kind === 'offset')).toBe(true);
    expect(analysis.candidates.some((item) => item.id === 'transaction:offset-expense')).toBe(
      false,
    );
    expect(analysis.candidates.some((item) => item.id === 'aggregate:category:purchases')).toBe(
      false,
    );
    expect(analysis.candidates.some((item) => item.id === 'transaction:large-driver')).toBe(true);
    expect(analysis.candidates.some((item) => item.id === 'transaction:minor-driver')).toBe(false);
  });

  it('keeps stable within-range spending inspectable without turning it into an alert', async () => {
    const db = openDb();
    for (const [id, date] of [
      ['old-1', '2026-05-10'],
      ['old-2', '2026-06-10'],
      ['old-3', '2026-07-10'],
      ['current', '2026-08-12'],
    ] as const) {
      insertTransaction(db, id, 'bank', date, -100_000, 'Stable purchase');
      await saveEntryAnnotation(db, {
        entryType: 'transaction',
        entryId: id,
        categoryId: 'purchases',
        source: 'manual',
      });
    }
    const resolved = await loadConfig('examples/expenses-config.json');
    const scope = resolveReportQueryScope(resolved, 'weekly', {
      timeZone: 'UTC',
      period: { start: '2026-08-10', end: '2026-08-16' },
    });

    const analysis = buildReportAnalysis({ db, resolved, scope, policy: { decisions: [] } });

    expect(analysis.candidates.some((candidate) => candidate.signal === 'within-range')).toBe(true);
    expect(analysis.mustReport).toEqual([]);
  });

  it('flows the global language into generated table text', async () => {
    const db = openDb();
    insertTransaction(db, 'english-table', 'bank', '2026-08-12', -20_000, 'Groceries');
    const loaded = await loadConfig('examples/expenses-config.json');
    const resolved = {
      ...loaded,
      config: { ...loaded.config, language: 'en-US' as const },
    };
    const scope = resolveReportQueryScope(resolved, 'monthly', {
      timeZone: 'UTC',
      period: { start: '2026-08-01', end: '2026-08-31' },
    });

    const analysis = buildReportAnalysis({ db, resolved, scope, policy: { decisions: [] } });
    const table = buildMonthlyComparisonTable(analysis);

    expect(analysis.language).toBe('en-US');
    expect(table).toContain('<th>Metric</th>');
    expect(table).toContain('<th>Expenses</th>');
    expect(table).toContain('<th>Monthly balance</th>');
    expect(table).toContain('<th>Cumulative balance</th>');
    expect(table).toContain('<th>Income MoM</th>');
    expect(table).toContain('<th>Expenses MoM</th>');
  });

  it('ends ad-hoc monthly comparison buckets on the requested partial month', async () => {
    const db = openDb();
    insertTransaction(db, 'may-expense', 'bank', '2026-05-12', -10_000, 'May');
    insertTransaction(db, 'june-expense', 'bank', '2026-06-12', -20_000, 'June');
    insertTransaction(db, 'july-expense', 'bank', '2026-07-12', -30_000, 'July');
    const resolved = await loadConfig('examples/expenses-config.json');
    const scope = resolveReportQueryScope(resolved, 'monthly', {
      timeZone: 'UTC',
      period: { start: '2026-05-01', end: '2026-07-15' },
    });

    const analysis = buildReportAnalysis({ db, resolved, scope, policy: { decisions: [] } });
    const table = buildMonthlyComparisonTable(analysis);

    expect(analysis.chart).toHaveLength(12);
    expect(
      analysis.chart.slice(-3).map(({ start, end, expenseCents }) => ({
        start,
        end,
        expenseCents,
      })),
    ).toEqual([
      { start: '2026-05-01', end: '2026-05-31', expenseCents: 10_000 },
      { start: '2026-06-01', end: '2026-06-30', expenseCents: 20_000 },
      { start: '2026-07-01', end: '2026-07-15', expenseCents: 30_000 },
    ]);
    expect(table).toContain('<th>2026-07 parcial</th>');
  });

  it('clips a partial starting month to the requested ad-hoc range', async () => {
    const db = openDb();
    insertTransaction(db, 'before-range', 'bank', '2026-05-10', -10_000, 'Before range');
    insertTransaction(db, 'inside-range', 'bank', '2026-05-20', -20_000, 'Inside range');
    insertTransaction(db, 'after-range', 'bank', '2026-07-20', -30_000, 'After range');
    const resolved = await loadConfig('examples/expenses-config.json');
    const scope = resolveReportQueryScope(resolved, 'monthly', {
      timeZone: 'UTC',
      period: { start: '2026-05-15', end: '2026-07-15' },
    });

    const analysis = buildReportAnalysis({ db, resolved, scope, policy: { decisions: [] } });
    const table = buildMonthlyComparisonTable(analysis);

    expect(
      analysis.chart.slice(-3).map(({ start, end, expenseCents }) => ({
        start,
        end,
        expenseCents,
      })),
    ).toEqual([
      { start: '2026-05-15', end: '2026-05-31', expenseCents: 20_000 },
      { start: '2026-06-01', end: '2026-06-30', expenseCents: 0 },
      { start: '2026-07-01', end: '2026-07-15', expenseCents: 0 },
    ]);
    expect(table).toContain('<th>2026-05 parcial</th>');
    expect(table).toContain('<th>2026-07 parcial</th>');
  });

  it.each([
    {
      name: 'multiple complete months',
      period: { start: '2026-05-01', end: '2026-07-31' },
      history: ['2026-01-10', '2026-02-10', '2026-03-10', '2026-04-10'],
      current: ['2026-05-10', '2026-06-10', '2026-07-10'],
      expectedDelta: '+R$ 0,00',
      ratioAvailable: true,
    },
    {
      name: 'a mid-month window',
      period: { start: '2026-08-10', end: '2026-08-20' },
      history: ['2026-04-10', '2026-05-10', '2026-06-10', '2026-07-10'],
      current: ['2026-08-12'],
      expectedDelta: '+R$ 1.000,00',
      ratioAvailable: false,
    },
  ])('omits non-comparable monthly profile deltas and anomalies for $name', async (sample) => {
    const db = openDb();
    for (const [index, date] of [...sample.history, ...sample.current].entries()) {
      const id = `expense-${index}`;
      insertTransaction(db, id, 'bank', date, -100_000, 'Recurring household cost');
      await saveEntryAnnotation(db, {
        entryType: 'transaction',
        entryId: id,
        categoryId: 'purchases',
        source: 'manual',
      });
    }
    const resolved = await loadConfig('examples/expenses-config.json');
    const scope = resolveReportQueryScope(resolved, 'monthly', {
      timeZone: 'UTC',
      period: sample.period,
    });

    const analysis = buildReportAnalysis({ db, resolved, scope, policy: { decisions: [] } });
    const profile = analysis.profiles.find((item) => item.key === 'category:purchases');

    expect(analysis.period.comparisonBasis).toBe('equal-length');
    expect(analysis.summary.expenseDelta).toBe(sample.expectedDelta);
    expect(analysis.summary.expenseRatio !== null).toBe(sample.ratioAvailable);
    expect(analysis.summary.incomeDelta).toBe('+R$ 0,00');
    expect(analysis.summary.incomeRatio).toBeNull();
    expect(profile?.basis).toBe('month');
    expect(profile?.current).toMatchObject({
      comparable: false,
      deltaCents: null,
      deltaRatio: null,
      expectedness: 'no-baseline',
    });
    expect(analysis.candidates.some((candidate) => candidate.kind === 'aggregate')).toBe(false);
    expect(analysis.candidates.some((candidate) => candidate.kind === 'transaction')).toBe(true);
    expect(analysis.candidates.every((candidate) => candidate.baseline === undefined)).toBe(true);
    expect(
      analysis.candidates
        .filter((candidate) => candidate.kind === 'transaction')
        .every((candidate) => candidate.signal === 'no-baseline'),
    ).toBe(true);
    expect(analysis.chart.at(-1)?.end).toBe(sample.period.end);
  });

  it('retains monthly comparisons for one complete calendar month', async () => {
    const db = openDb();
    for (const [index, date] of [
      '2026-01-10',
      '2026-02-10',
      '2026-03-10',
      '2026-04-10',
      '2026-05-10',
    ].entries()) {
      const id = `expense-${index}`;
      insertTransaction(db, id, 'bank', date, -100_000, 'Recurring household cost');
      await saveEntryAnnotation(db, {
        entryType: 'transaction',
        entryId: id,
        categoryId: 'purchases',
        source: 'manual',
      });
    }
    const resolved = await loadConfig('examples/expenses-config.json');
    const scope = resolveReportQueryScope(resolved, 'monthly', {
      timeZone: 'UTC',
      period: { start: '2026-05-01', end: '2026-05-31' },
    });

    const analysis = buildReportAnalysis({ db, resolved, scope, policy: { decisions: [] } });

    expect(analysis.period.comparisonBasis).toBe('calendar-month');
    expect(analysis.summary.expenseDelta).not.toBeNull();
    expect(
      analysis.profiles.find((item) => item.key === 'category:purchases')?.current.comparable,
    ).toBe(true);
  });

  it('keeps a valid single-item active-day anomaly in an irregular monthly window', async () => {
    const db = openDb();
    for (const [index, date] of ['2026-07-01', '2026-07-05', '2026-07-09'].entries()) {
      const id = `historical-${index}`;
      insertTransaction(db, id, 'bank', date, -10_000, 'Historical household item');
      await saveEntryAnnotation(db, {
        entryType: 'transaction',
        entryId: id,
        categoryId: 'purchases',
        source: 'manual',
      });
    }
    insertTransaction(db, 'current-item', 'bank', '2026-08-12', -100_000, 'Current item');
    await saveEntryAnnotation(db, {
      entryType: 'transaction',
      entryId: 'current-item',
      categoryId: 'purchases',
      source: 'manual',
    });
    const resolved = await loadConfig('examples/expenses-config.json');
    const scope = resolveReportQueryScope(resolved, 'monthly', {
      timeZone: 'UTC',
      period: { start: '2026-08-10', end: '2026-08-20' },
    });

    const analysis = buildReportAnalysis({ db, resolved, scope, policy: { decisions: [] } });
    const candidate = analysis.candidates.find((item) => item.id === 'transaction:current-item');

    expect(analysis.profiles.find((profile) => profile.key === 'category:purchases')?.basis).toBe(
      'active-day',
    );
    expect(candidate?.signal).toBe('unusual');
    expect(candidate?.baseline).toBeDefined();
  });

  it('loads the complete equal-length prior interval for a long ad-hoc monthly range', async () => {
    const db = openDb();
    insertTransaction(db, 'prior-expense', 'bank', '2022-02-01', -50_000, 'Prior expense');
    insertTransaction(db, 'current-expense', 'bank', '2029-06-01', -100_000, 'Current expense');
    const resolved = await loadConfig('examples/expenses-config.json');
    const scope = resolveReportQueryScope(resolved, 'monthly', {
      timeZone: 'UTC',
      period: { start: '2026-01-01', end: '2029-12-31' },
    });

    const analysis = buildReportAnalysis({ db, resolved, scope, policy: { decisions: [] } });

    expect(analysis.period.comparisonBasis).toBe('equal-length');
    expect(analysis.summary.expenseDelta).toBe('+R$ 500,00');
  });

  it.each([
    { useCreditPurchaseDate: false, included: false },
    { useCreditPurchaseDate: true, included: true },
  ])(
    'passes useCreditPurchaseDate=$useCreditPurchaseDate through report fact loading',
    async ({ useCreditPurchaseDate, included }) => {
      const db = openDb();
      db.prepare(
        `INSERT INTO transactions (
           id, account_id, occurred_at, amount_cents, currency, description, raw_json, synced_at
         ) VALUES (?, ?, ?, ?, 'BRL', ?, ?, '2026-08-17T00:00:00.000Z')`,
      ).run(
        'purchase-date',
        'card',
        '2026-09-12T12:00:00.000Z',
        20_000,
        'Purchase date basis',
        JSON.stringify({ creditCardMetadata: { purchaseDate: '2026-08-12' } }),
      );
      const loaded = await loadConfig('examples/expenses-config.json');
      const resolved = {
        ...loaded,
        config: {
          ...loaded.config,
          report: { ...loaded.config.report, useCreditPurchaseDate },
        },
      };
      const scope = resolveReportQueryScope(resolved, 'weekly', {
        timeZone: 'UTC',
        period: { start: '2026-08-10', end: '2026-08-16' },
      });

      expect(scope.useCreditPurchaseDate).toBe(useCreditPurchaseDate);
      const packet = buildReportAnalysisPacket({ db, resolved, scope, policy: { decisions: [] } });

      expect(packet.reportableFacts.some((fact) => fact.id === 'purchase-date')).toBe(included);
    },
  );

  it('respects includeUnannotated report scopes', async () => {
    const db = openDb();
    insertTransaction(db, 'classified', 'bank', '2026-08-12', -20_000, 'Classified');
    insertTransaction(db, 'unclassified', 'bank', '2026-08-13', -30_000, 'Unclassified');
    await saveEntryAnnotation(db, {
      entryType: 'transaction',
      entryId: 'classified',
      categoryId: 'purchases',
      source: 'manual',
    });
    const resolved = await loadConfig('examples/expenses-config.json');
    const baseScope = resolveReportQueryScope(resolved, 'weekly', {
      timeZone: 'UTC',
      period: { start: '2026-08-10', end: '2026-08-16' },
    });
    const classifiedScope = {
      ...baseScope,
      report: { ...baseScope.report, includeUnannotated: false },
    };
    const classified = buildReportAnalysis({
      db,
      resolved,
      scope: classifiedScope,
      policy: { decisions: [] },
    });
    expect(classified.summary.expense).toContain('200,00');
    expect(classified.classification.unclassified).toBe(0);
  });

  it('excludes only Investimentos category and nested-label movements from chart facts', async () => {
    const db = openDb();
    insertTransaction(db, 'ordinary', 'bank', '2026-08-12', -10_000, 'Groceries');
    insertTransaction(db, 'category-investment', 'bank', '2026-08-13', -20_000, 'Broker');
    insertTransaction(db, 'label-investment', 'bank', '2026-08-14', -30_000, 'Offshore');
    await saveEntryAnnotation(db, {
      entryType: 'transaction',
      entryId: 'ordinary',
      categoryId: 'purchases',
      source: 'manual',
    });
    await saveEntryAnnotation(db, {
      entryType: 'transaction',
      entryId: 'category-investment',
      categoryId: 'investments',
      source: 'manual',
    });
    await saveEntryAnnotation(db, {
      entryType: 'transaction',
      entryId: 'label-investment',
      categoryId: 'purchases',
      labelIds: ['offshore'],
      source: 'manual',
    });
    const resolved = await loadConfig('examples/expenses-config.json');
    const scope = resolveReportQueryScope(resolved, 'weekly', {
      timeZone: 'UTC',
      period: { start: '2026-08-10', end: '2026-08-16' },
    });
    const policy = {
      decisions: [
        {
          kind: 'category' as const,
          id: 'investments',
          path: 'Investimentos',
          treatment: 'portfolio-movement' as const,
          confidence: 1,
          reason: 'Investment category.',
        },
        {
          kind: 'label' as const,
          id: 'investment-label',
          path: 'Investimentos',
          treatment: 'portfolio-movement' as const,
          confidence: 1,
          reason: 'Investment label.',
        },
        {
          kind: 'label' as const,
          id: 'offshore',
          path: 'Investimentos > Offshore',
          treatment: 'portfolio-movement' as const,
          confidence: 1,
          reason: 'Nested investment label.',
        },
      ],
    };

    const result = buildReportAnalysisPacket({ db, resolved, scope, policy });

    expect(result.analysis.excluded.portfolio).toBe(2);
    expect(result.analysis.chart.at(-1)?.expenseCents).toBe(10_000);
    expect(result.reportableFacts.map((fact) => fact.id)).toEqual(['ordinary']);
  });

  it('does not pair equal amounts across accounts or distant dates as compensation', async () => {
    const db = openDb();
    insertTransaction(db, 'expense', 'bank', '2026-08-10', -100_000, 'Expense');
    insertTransaction(db, 'other-account-income', 'card', '2026-08-11', -100_000, 'Refund');
    insertTransaction(db, 'distant-income', 'bank', '2026-08-20', 100_000, 'Income');
    const resolved = await loadConfig('examples/expenses-config.json');
    const scope = resolveReportQueryScope(resolved, 'weekly', {
      timeZone: 'UTC',
      period: { start: '2026-08-01', end: '2026-08-31' },
    });

    const analysis = buildReportAnalysis({ db, resolved, scope, policy: { decisions: [] } });

    expect(analysis.candidates.some((candidate) => candidate.kind === 'offset')).toBe(false);
  });

  it('uses all period expenses for the 20 percent normal-item threshold', async () => {
    const db = openDb();
    insertTransaction(db, 'candidate', 'bank', '2026-08-10', -20_000, 'Candidate');
    for (let index = 0; index < 12; index += 1) {
      insertTransaction(db, `small-${index}`, 'bank', '2026-08-11', -9_000, `Small ${index}`);
    }
    const resolved = await loadConfig('examples/expenses-config.json');
    const scope = resolveReportQueryScope(resolved, 'weekly', {
      timeZone: 'UTC',
      period: { start: '2026-08-10', end: '2026-08-16' },
    });

    const analysis = buildReportAnalysis({ db, resolved, scope, policy: { decisions: [] } });

    expect(analysis.candidates.some((item) => item.id === 'transaction:candidate')).toBe(false);
  });
});
