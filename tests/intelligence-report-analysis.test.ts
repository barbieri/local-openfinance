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
       ('same-person', 'Transferência mesma titularidade', NULL, '2026-01-01T00:00:00.000Z')`,
  ).run();
  db.prepare(
    `INSERT INTO annotation_labels (id, name, parent_id, created_at) VALUES
       ('transport', 'Transporte', NULL, '2026-01-01T00:00:00.000Z'),
       ('accessories', 'Acessórios', 'transport', '2026-01-01T00:00:00.000Z')`,
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
