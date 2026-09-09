import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { listEnrichedCreditCards, parseCreditCardGroupBy } from '../src/db/account-list-details.js';
import {
  renderCreditCardsTree,
  serializeCreditCardForJson,
} from '../src/db/credit-cards/present.js';
import { migrateDatabase } from '../src/db/migrate.js';

function seedCreditCard(
  db: DatabaseSync,
  input: {
    readonly id: string;
    readonly itemId: string;
    readonly subtype?: string | undefined;
    readonly name: string;
    readonly balanceCents?: number | undefined;
    readonly number?: string | undefined;
    readonly rawJson: Record<string, unknown>;
  },
): void {
  db.prepare(
    `INSERT INTO connections (item_id, connector_id, connector_name, status, raw_json, synced_at)
     VALUES (?, '601', 'Itaú', 'UPDATED', '{}', '2026-06-10T00:00:00.000Z')
     ON CONFLICT(item_id) DO NOTHING`,
  ).run(input.itemId);

  db.prepare(
    `INSERT INTO accounts (
      id, connection_item_id, type, subtype, name, number, balance_cents, currency, raw_json, synced_at
    ) VALUES (?, ?, 'CREDIT', ?, ?, ?, ?, 'BRL', ?, '2026-06-10T00:00:00.000Z')`,
  ).run(
    input.id,
    input.itemId,
    input.subtype ?? 'CREDIT_CARD',
    input.name,
    input.number ?? null,
    input.balanceCents ?? null,
    JSON.stringify(input.rawJson),
  );
}

describe('credit card list details', () => {
  it('defaults group-by to account and subtype', () => {
    expect(parseCreditCardGroupBy(undefined)).toEqual(['account', 'subtype']);
  });

  it('renders display name, type/subtype, card number, balance, and credit metadata', () => {
    const db = new DatabaseSync(':memory:');
    migrateDatabase(db);

    seedCreditCard(db, {
      id: 'card-1',
      itemId: 'item-1',
      name: 'Platinum Card',
      balanceCents: -150000,
      number: '************3725',
      rawJson: {
        creditData: {
          brand: 'MASTERCARD',
          level: 'PLATINUM',
          balanceCloseDate: '2026-06-15',
          balanceDueDate: '2026-06-20',
          minimumPayment: '150.00',
          availableCreditLimit: '4500.00',
          creditLimit: '5000.00',
          status: 'ACTIVE',
        },
      },
    });

    const { creditCards } = listEnrichedCreditCards(db, { limit: 10, offset: 0 });
    const output = renderCreditCardsTree(creditCards, parseCreditCardGroupBy(undefined));

    expect(output).toContain('Itaú');
    expect(output).toContain('MASTERCARD (3725)');
    expect(output).toContain('CREDIT');
    expect(output).toContain('CREDIT_CARD');
    expect(output).toContain('card ****3725');
    expect(output).toContain('-R$\u00a01.500,00');
    expect(output).toContain('limit R$\u00a05.000,00');
    expect(output).toContain('close 2026-06-15');
    expect(output).toContain('due 2026-06-20');
  });

  it('serializes db, parsed, and raw_json sections for debugging', () => {
    const db = new DatabaseSync(':memory:');
    migrateDatabase(db);

    seedCreditCard(db, {
      id: 'card-1',
      itemId: 'item-1',
      name: 'Platinum Card',
      balanceCents: -150000,
      number: '************3725',
      rawJson: {
        creditData: {
          brand: 'MASTERCARD',
          level: 'PLATINUM',
          creditLimit: '5000.00',
        },
      },
    });

    const { creditCards } = listEnrichedCreditCards(db, { limit: 10, offset: 0 });
    const [creditCard] = creditCards;
    if (!creditCard) {
      throw new Error('expected seeded credit card');
    }

    const json = serializeCreditCardForJson(creditCard);
    expect(json['db']).toMatchObject({
      id: 'card-1',
      type: 'CREDIT',
      subtype: 'CREDIT_CARD',
      balance_cents: -150000,
    });
    expect(json['parsed']).toMatchObject({
      display_name: 'MASTERCARD (3725)',
      credit_data: {
        brand: 'MASTERCARD',
        level: 'PLATINUM',
        credit_limit_cents: 500000,
      },
    });
  });
});
