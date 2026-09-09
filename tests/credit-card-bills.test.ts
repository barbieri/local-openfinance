import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import {
  listEnrichedCreditCardBills,
  parseCreditCardBillGroupBy,
} from '../src/db/credit-card-bill-details.js';
import {
  renderCreditCardBillsTree,
  serializeCreditCardBillForJson,
} from '../src/db/credit-card-bills/present.js';
import { migrateDatabase } from '../src/db/migrate.js';

function seedCreditCardBill(
  db: DatabaseSync,
  input: {
    readonly id: string;
    readonly accountId: string;
    readonly itemId: string;
    readonly dueDate: string;
    readonly totalAmountCents: number;
    readonly minimumPaymentCents?: number | undefined;
    readonly paymentStatus: string;
    readonly rawJson?: Record<string, unknown> | undefined;
  },
): void {
  db.prepare(
    `INSERT INTO connections (item_id, connector_id, connector_name, status, raw_json, synced_at)
     VALUES (?, '601', 'Itaú', 'UPDATED', '{}', '2026-06-10T00:00:00.000Z')
     ON CONFLICT(item_id) DO NOTHING`,
  ).run(input.itemId);

  db.prepare(
    `INSERT INTO accounts (id, connection_item_id, type, name, number, currency, raw_json, synced_at)
     VALUES (?, ?, 'CREDIT', 'Platinum Card', '************3725', 'BRL', ?, '2026-06-10T00:00:00.000Z')
     ON CONFLICT(id) DO NOTHING`,
  ).run(
    input.accountId,
    input.itemId,
    JSON.stringify({
      creditData: { brand: 'MASTERCARD', level: 'PLATINUM' },
    }),
  );

  db.prepare(
    `INSERT INTO credit_card_bills (
      id, account_id, due_date, total_amount_cents, minimum_payment_cents, payment_status, currency, raw_json, synced_at
    ) VALUES (?, ?, ?, ?, ?, ?, 'BRL', ?, '2026-06-10T00:00:00.000Z')`,
  ).run(
    input.id,
    input.accountId,
    input.dueDate,
    input.totalAmountCents,
    input.minimumPaymentCents ?? null,
    input.paymentStatus,
    JSON.stringify(
      input.rawJson ?? {
        dueDate: input.dueDate,
        totalAmount: (input.totalAmountCents / 100).toFixed(2),
        minimumPaymentAmount: input.minimumPaymentCents
          ? (input.minimumPaymentCents / 100).toFixed(2)
          : null,
        payment_status: input.paymentStatus,
      },
    ),
  );
}

describe('credit card bill list details', () => {
  it('defaults group-by to account and payment_status', () => {
    expect(parseCreditCardBillGroupBy(undefined)).toEqual(['account', 'payment_status']);
  });

  it('renders due date, total, minimum payment, and payment status prominently', () => {
    const db = new DatabaseSync(':memory:');
    migrateDatabase(db);

    seedCreditCardBill(db, {
      id: 'bill-1',
      accountId: 'card-1',
      itemId: 'item-1',
      dueDate: '2026-06-20T03:00:00.000Z',
      totalAmountCents: 150000,
      minimumPaymentCents: 15000,
      paymentStatus: 'OPEN',
    });
    seedCreditCardBill(db, {
      id: 'bill-2',
      accountId: 'card-1',
      itemId: 'item-1',
      dueDate: '2026-05-20T03:00:00.000Z',
      totalAmountCents: 90000,
      minimumPaymentCents: 9000,
      paymentStatus: 'PAID',
    });

    const { bills } = listEnrichedCreditCardBills(db, { limit: 10, offset: 0 });
    const output = renderCreditCardBillsTree(bills, parseCreditCardBillGroupBy(undefined));

    expect(output).toContain('MASTERCARD (3725)');
    expect(output).toContain('OPEN');
    expect(output).toContain('PAID');
    expect(output).toContain('due 2026-06-20');
    expect(output).toContain('due 2026-05-20');
    expect(output).toContain('total R$\u00a01.500,00');
    expect(output).toContain('min R$\u00a0150,00');
  });

  it('serializes db, parsed, and raw_json sections for debugging', () => {
    const db = new DatabaseSync(':memory:');
    migrateDatabase(db);

    seedCreditCardBill(db, {
      id: 'bill-1',
      accountId: 'card-1',
      itemId: 'item-1',
      dueDate: '2026-06-20T03:00:00.000Z',
      totalAmountCents: 150000,
      minimumPaymentCents: 15000,
      paymentStatus: 'OPEN',
    });

    const { bills } = listEnrichedCreditCardBills(db, { limit: 10, offset: 0 });
    const [bill] = bills;
    if (!bill) {
      throw new Error('expected seeded bill');
    }

    const json = serializeCreditCardBillForJson(bill);
    expect(json['db']).toMatchObject({
      id: 'bill-1',
      account_id: 'card-1',
      due_date: '2026-06-20T03:00:00.000Z',
      total_amount_cents: 150000,
      minimum_payment_cents: 15000,
      payment_status: 'OPEN',
    });
    expect(json['parsed']).toMatchObject({
      bill_label: '2026-06-20',
      account_display_name: 'MASTERCARD (3725)',
    });
  });
});
