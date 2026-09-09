import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import {
  enrichInvestmentRow,
  formatInvestmentIssuerLabel,
  formatInvestmentRateLabel,
  listEnrichedInvestments,
  parseInvestmentDetails,
  parseInvestmentGroupBy,
  parseInvestmentStatusFilter,
  resolveInvestmentTotalCents,
} from '../src/db/investment-details.js';
import {
  renderInvestmentsTree,
  serializeInvestmentForJson,
} from '../src/db/investments/present.js';
import { migrateDatabase } from '../src/db/migrate.js';

function seedInvestment(
  db: DatabaseSync,
  input: {
    readonly id: string;
    readonly itemId: string;
    readonly type: string;
    readonly subtype: string;
    readonly name: string;
    readonly code?: string | undefined;
    readonly balanceCents?: number | undefined;
    readonly rawJson: Record<string, unknown>;
  },
): void {
  db.prepare(
    `INSERT INTO connections (item_id, connector_id, connector_name, status, raw_json, synced_at)
     VALUES (?, '601', 'Itaú', 'UPDATED', '{}', '2026-06-10T00:00:00.000Z')
     ON CONFLICT(item_id) DO NOTHING`,
  ).run(input.itemId);

  db.prepare(
    `INSERT INTO investments (
      id, connection_item_id, type, subtype, name, code, balance_cents, currency, raw_json, synced_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 'BRL', ?, '2026-06-10T00:00:00.000Z')`,
  ).run(
    input.id,
    input.itemId,
    input.type,
    input.subtype,
    input.name,
    input.code ?? null,
    input.balanceCents ?? null,
    JSON.stringify(input.rawJson),
  );
}

describe('investment details', () => {
  it('parses equity unit price separately from position total', () => {
    const details = parseInvestmentDetails({
      type: 'EQUITY',
      value: '115.77',
      quantity: 650,
      amount: '75250.50',
      balance: '75250.50',
      amountWithdrawal: '75250.50',
    });

    expect(details.unit_price_cents).toBe(11577);
    expect(details.total_cents).toBe(7525050);
    expect(details.quantity).toBe(650);
  });

  it('parses fixed income totals, dates, and scalar taxes from raw_json', () => {
    const details = parseInvestmentDetails({
      type: 'FIXED_INCOME',
      value: '1.05',
      quantity: 55046,
      amount: '57708.86',
      balance: '57109.72',
      amountWithdrawal: '57109.72',
      purchaseDate: '2026-01-30T03:00:00.000Z',
      dueDate: '2031-01-06T03:00:00.000Z',
      taxes: '599.14',
      taxes2: '0.00',
    });

    expect(details.unit_price_cents).toBe(105);
    expect(details.total_cents).toBe(5710972);
    expect(details.purchase_date).toBe('2026-01-30T03:00:00.000Z');
    expect(details.taxes_cents).toBe(59914);
    expect(details.taxes2_cents).toBe(0);
  });

  it('parses nested Open Finance amount objects and alternate field names', () => {
    const details = parseInvestmentDetails({
      type: 'FIXED_INCOME',
      status: 'ACTIVE',
      balance: { amount: '57109.72', currency: 'BRL' },
      value: { amount: '1.05', currency: 'BRL' },
      quantity: 55046,
      fixedIncome: {
        isinCode: 'BR1234567890',
        issuerName: 'ITAU UNIBANCO S.A.',
        incomeTax: { amount: '599.14', currency: 'BRL' },
        issueDate: '2026-01-30T03:00:00.000Z',
        dueDate: '2031-01-06T03:00:00.000Z',
      },
    });

    expect(details.isin).toBe('BR1234567890');
    expect(details.issuer).toBe('ITAU UNIBANCO S.A.');
    expect(details.total_cents).toBe(5710972);
    expect(details.unit_price_cents).toBe(105);
    expect(details.quantity).toBe(55046);
    expect(details.taxes_cents).toBe(59914);
    expect(details.purchase_date).toBe('2026-01-30T03:00:00.000Z');
    expect(details.due_date).toBe('2031-01-06T03:00:00.000Z');
  });

  it('parses rate, rateType, and issuerCNPJ from top-level raw_json', () => {
    const details = parseInvestmentDetails({
      type: 'FIXED_INCOME',
      issuer: 'ITAU UNIBANCO S.A.',
      issuerCNPJ: '60.701.190/0001-04',
      rate: 101.2,
      rateType: 'CDI',
    });

    expect(details.rate).toBe(101.2);
    expect(details.rate_type).toBe('CDI');
    expect(details.issuer_cnpj).toBe('60.701.190/0001-04');
  });

  it('parses rate, rateType, and issuerCNPJ from nested raw_json objects', () => {
    const details = parseInvestmentDetails({
      type: 'FIXED_INCOME',
      details: {
        issuer: 'ITAU UNIBANCO S.A.',
        issuerCNPJ: '60.701.190/0001-04',
        rate: 101.2,
        rateType: 'CDI',
      },
    });

    expect(details.issuer).toBe('ITAU UNIBANCO S.A.');
    expect(details.issuer_cnpj).toBe('60.701.190/0001-04');
    expect(details.rate).toBe(101.2);
    expect(details.rate_type).toBe('CDI');
    expect(formatInvestmentRateLabel(details.rate, details.rate_type)).toBe('101.2% CDI');
    expect(formatInvestmentIssuerLabel(details.issuer, details.issuer_cnpj)).toBe(
      'ITAU UNIBANCO S.A. (60.701.190/0001-04)',
    );
  });

  it('formats issuer CNPJ digits when upstream sends an unmasked value', () => {
    expect(formatInvestmentIssuerLabel('ITAU UNIBANCO S.A.', '60701190000104')).toBe(
      'ITAU UNIBANCO S.A. (60.701.190/0001-04)',
    );
  });

  it('reads parsed detail columns from the database after sync-style upsert', () => {
    const db = new DatabaseSync(':memory:');
    migrateDatabase(db);

    seedInvestment(db, {
      id: 'inv-cdb',
      itemId: 'item-1',
      type: 'FIXED_INCOME',
      subtype: 'CDB',
      name: 'CDB - ITAU',
      rawJson: {},
    });

    const details = parseInvestmentDetails({
      type: 'FIXED_INCOME',
      issuer: 'ITAU UNIBANCO S.A.',
      issuerCNPJ: '60.701.190/0001-04',
      rate: 101.2,
      rateType: 'CDI',
      status: 'ACTIVE',
      amountWithdrawal: '1000.00',
    });

    db.prepare(
      `UPDATE investments SET
        status = ?, isin = ?, quantity = ?, unit_price_cents = ?, total_cents = ?,
        amount_cents = ?, amount_withdrawal_cents = ?, issuer = ?, issuer_cnpj = ?,
        rate = ?, rate_type = ?, purchase_date = ?, due_date = ?, taxes_cents = ?, taxes2_cents = ?
       WHERE id = 'inv-cdb'`,
    ).run(
      details.status,
      details.isin,
      details.quantity,
      details.unit_price_cents,
      details.total_cents,
      details.amount_cents,
      details.amount_withdrawal_cents,
      details.issuer,
      details.issuer_cnpj,
      details.rate,
      details.rate_type,
      details.purchase_date,
      details.due_date,
      details.taxes_cents,
      details.taxes2_cents,
    );

    const [investment] = listEnrichedInvestments(db, ['ACTIVE']);
    expect(investment?.rate).toBe(101.2);
    expect(investment?.rate_type).toBe('CDI');
    expect(investment?.issuer_cnpj).toBe('60.701.190/0001-04');
    expect(formatInvestmentRateLabel(investment?.rate, investment?.rate_type)).toBe('101.2% CDI');
  });

  it('filters investments by status with ACTIVE as the default', () => {
    const db = new DatabaseSync(':memory:');
    migrateDatabase(db);

    seedInvestment(db, {
      id: 'inv-active',
      itemId: 'item-1',
      type: 'EQUITY',
      subtype: 'STOCK',
      name: 'Active',
      code: 'SEQR11',
      rawJson: { status: 'ACTIVE', value: '100.00', quantity: 10, amount: '1000.00' },
    });
    seedInvestment(db, {
      id: 'inv-withdrawn',
      itemId: 'item-1',
      type: 'FIXED_INCOME',
      subtype: 'CDB',
      name: 'Withdrawn CDB',
      rawJson: {
        status: 'TOTAL_WITHDRAWAL',
        amountWithdrawal: '200.00',
        fixedIncome: { purchaseDate: '2024-05-01' },
      },
    });

    expect(listEnrichedInvestments(db, parseInvestmentStatusFilter(undefined))).toHaveLength(1);
    expect(
      listEnrichedInvestments(db, parseInvestmentStatusFilter('ACTIVE,TOTAL_WITHDRAWAL')),
    ).toHaveLength(2);
    expect(listEnrichedInvestments(db, parseInvestmentStatusFilter('all'))).toHaveLength(2);
  });

  it('renders equity and fixed income lines with correct amounts', () => {
    const db = new DatabaseSync(':memory:');
    migrateDatabase(db);

    seedInvestment(db, {
      id: 'inv-equity',
      itemId: 'item-1',
      type: 'EQUITY',
      subtype: 'STOCK',
      name: 'ISEN11',
      code: 'ISEN11',
      balanceCents: 7525050,
      rawJson: {
        status: 'ACTIVE',
        value: '115.77',
        quantity: 650,
        amount: '75250.50',
        balance: '75250.50',
        amountWithdrawal: '75250.50',
      },
    });
    seedInvestment(db, {
      id: 'inv-cdb',
      itemId: 'item-1',
      type: 'FIXED_INCOME',
      subtype: 'CDB',
      name: 'CDB - ITAU UNIBANCO S.A.',
      code: 'CDB22617BYS',
      balanceCents: 5710972,
      rawJson: {
        status: 'ACTIVE',
        value: '1.05',
        quantity: 55046,
        amount: '57708.86',
        balance: '57109.72',
        amountWithdrawal: '57109.72',
        purchaseDate: '2026-01-30T03:00:00.000Z',
        taxes: '599.14',
      },
    });

    const investments = listEnrichedInvestments(db, parseInvestmentStatusFilter('all'));
    const output = renderInvestmentsTree(investments, parseInvestmentGroupBy(undefined));

    expect(output).toContain('650 x');
    expect(output).toContain('R$\u00a0115,77');
    expect(output).toContain('R$\u00a075.250,50');
    expect(output).toContain('CDB22617BYS');
    expect(output).toContain('R$\u00a057.109,72');
    expect(output).toContain('2026-01-30');
    expect(output).toContain('taxes: 599,14');
  });

  it('serializes db, parsed, and raw_json sections for debugging', () => {
    const db = new DatabaseSync(':memory:');
    migrateDatabase(db);

    seedInvestment(db, {
      id: 'inv-equity',
      itemId: 'item-1',
      type: 'EQUITY',
      subtype: 'STOCK',
      name: 'ISEN11',
      code: 'ISEN11',
      balanceCents: 7525050,
      rawJson: { status: 'ACTIVE', value: '115.77', quantity: 650, amountWithdrawal: '75250.50' },
    });

    const [investment] = listEnrichedInvestments(db, ['ACTIVE']);
    if (!investment) {
      throw new Error('expected seeded investment');
    }

    const json = serializeInvestmentForJson(investment);
    expect(json['db']).toMatchObject({
      code: 'ISEN11',
      balance_cents: 7525050,
    });
    expect(json['parsed']).toMatchObject({
      unit_price_cents: 11577,
      total_cents: 7525050,
      quantity: 650,
      rate_label: null,
      issuer_label: null,
    });
    expect(json['raw_json']).toMatchObject({
      value: '115.77',
      quantity: 650,
    });
  });
});

describe('investment enrichment', () => {
  it('falls back to code when upstream name is blank', () => {
    const db = new DatabaseSync(':memory:');
    migrateDatabase(db);

    seedInvestment(db, {
      id: 'inv-equity',
      itemId: 'item-1',
      type: 'EQUITY',
      subtype: 'STOCK',
      name: '   ',
      code: 'SPXR11',
      rawJson: { status: 'ACTIVE', value: '100.00', quantity: 1, amount: '100.00' },
    });

    const [investment] = listEnrichedInvestments(db, ['ACTIVE']);
    expect(investment?.display_name).toBe('SPXR11');
    if (!investment) {
      throw new Error('expected seeded investment');
    }
    expect(enrichInvestmentRow(db, investment).issuer).toBeNull();
  });

  it('prefers amountWithdrawal when resolving totals', () => {
    expect(
      resolveInvestmentTotalCents({
        amountWithdrawal: '57109.72',
        amount: '57708.86',
        balance: '57109.72',
      }),
    ).toBe(5710972);
  });
});
