import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import {
  listEnrichedLoans,
  parseLoanDetails,
  parseLoanGroupBy,
  resolveLoanOutstandingBalanceCents,
} from '../src/db/loan-details.js';
import { renderLoansTree, serializeLoanForJson } from '../src/db/loans/present.js';
import { migrateDatabase } from '../src/db/migrate.js';

function seedLoan(
  db: DatabaseSync,
  input: {
    readonly id: string;
    readonly itemId: string;
    readonly type: string;
    readonly contractNumber: string;
    readonly contractAmountCents?: number | undefined;
    readonly rawJson: Record<string, unknown>;
  },
): void {
  db.prepare(
    `INSERT INTO connections (item_id, connector_id, connector_name, status, raw_json, synced_at)
     VALUES (?, '601', 'Itaú', 'UPDATED', '{}', '2026-06-10T00:00:00.000Z')
     ON CONFLICT(item_id) DO NOTHING`,
  ).run(input.itemId);

  db.prepare(
    `INSERT INTO loans (
      id, connection_item_id, type, contract_amount_cents, due_date, contract_number, currency, raw_json, synced_at
    ) VALUES (?, ?, ?, ?, ?, ?, 'BRL', ?, '2026-06-10T00:00:00.000Z')`,
  ).run(
    input.id,
    input.itemId,
    input.type,
    input.contractAmountCents ?? null,
    typeof input.rawJson['dueDate'] === 'string' ? input.rawJson['dueDate'] : null,
    input.contractNumber,
    JSON.stringify(input.rawJson),
  );
}

describe('loan details', () => {
  it('parses contractAmount and dueDate from raw_json', () => {
    const details = parseLoanDetails({
      productName: 'Personal Loan',
      contractAmount: '150000.00',
      outstandingBalance: '45230.10',
      paidInstallments: 12,
      totalNumberOfInstallments: 36,
      dueDate: '2031-01-06T03:00:00.000Z',
      companyName: 'Itaú Unibanco',
    });

    expect(details.name).toBe('Personal Loan');
    expect(details.contract_amount_cents).toBe(15000000);
    expect(details.due_date).toBe('2031-01-06T03:00:00.000Z');
    expect(details.outstanding_balance_cents).toBe(4523010);
    expect(details.creditor).toBe('Itaú Unibanco');
  });

  it('defaults group-by to account, type, and name only', () => {
    expect(parseLoanGroupBy(undefined)).toEqual(['account', 'type', 'name']);
  });

  it('renders contract amount and due date prominently', () => {
    const db = new DatabaseSync(':memory:');
    migrateDatabase(db);

    seedLoan(db, {
      id: 'loan-1',
      itemId: 'item-1',
      type: 'PERSONAL',
      contractNumber: 'CTR-123',
      contractAmountCents: 15000000,
      rawJson: {
        productName: 'Personal Loan',
        contractAmount: '150000.00',
        outstandingBalance: '45230.10',
        paidInstallments: 12,
        totalNumberOfInstallments: 36,
        dueDate: '2031-01-06T03:00:00.000Z',
        companyName: 'Itaú Unibanco',
      },
    });

    const loans = listEnrichedLoans(db);
    const output = renderLoansTree(loans, parseLoanGroupBy(undefined));

    expect(output).toContain('Itaú');
    expect(output).toContain('PERSONAL');
    expect(output).toContain('CTR-123');
    expect(output).toContain('R$\u00a0150.000,00');
    expect(output).toContain('due 2031-01-06');
    expect(output).not.toContain('UNKNOWN');
  });

  it('serializes db, parsed, and raw_json sections for debugging', () => {
    const db = new DatabaseSync(':memory:');
    migrateDatabase(db);

    seedLoan(db, {
      id: 'loan-1',
      itemId: 'item-1',
      type: 'PERSONAL',
      contractNumber: 'CTR-123',
      contractAmountCents: 15000000,
      rawJson: {
        contractAmount: '150000.00',
        dueDate: '2031-01-06T03:00:00.000Z',
        outstandingBalance: '45230.10',
      },
    });

    const [loan] = listEnrichedLoans(db);
    if (!loan) {
      throw new Error('expected seeded loan');
    }

    const json = serializeLoanForJson(loan);
    expect(json['db']).toMatchObject({
      contract_number: 'CTR-123',
      contract_amount_cents: 15000000,
      due_date: '2031-01-06T03:00:00.000Z',
    });
    expect(json['parsed']).toMatchObject({
      contract_amount_cents: 15000000,
      due_date: '2031-01-06T03:00:00.000Z',
      display_name: 'CTR-123',
    });
  });

  it('prefers outstanding balance fields when resolving optional balance', () => {
    expect(
      resolveLoanOutstandingBalanceCents({
        outstandingBalance: '45230.10',
        contractAmount: '150000.00',
      }),
    ).toBe(4523010);
  });
});
