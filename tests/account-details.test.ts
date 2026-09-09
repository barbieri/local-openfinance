import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import {
  extractCardLastFourDigits,
  formatAccountTypeSubtype,
  formatCreditCardAccountDetails,
  formatCreditCardDisplayName,
  parseAccountRawJson,
  parseTransferNumber,
  resolveDefaultAccountDisplayName,
} from '../src/db/account-details.js';
import {
  enrichListRows,
  resolveAccountDisplayName,
  resolveConnectionDisplayName,
} from '../src/db/connection-labels.js';
import { accountsEntity } from '../src/db/list/entities.js';
import { migrateDatabase } from '../src/db/migrate.js';

describe('account raw_json details', () => {
  it('parses bank transfer numbers into branch and account parts', () => {
    expect(parseTransferNumber('341/1234/56789-0')).toEqual({
      transferNumber: '341/1234/56789-0',
      bankNumber: '341',
      branch: '1234',
      account: '56789-0',
    });
  });

  it('formats credit card details with brand, level, and last four digits', () => {
    expect(
      formatCreditCardAccountDetails('************3725', {
        level: 'PLATINUM',
        brand: 'MASTERCARD',
        balance_close_date: null,
        balance_due_date: null,
        minimum_payment_cents: null,
        available_credit_limit_cents: null,
        credit_limit_cents: null,
        status: null,
      }),
    ).toBe('MASTERCARD PLATINUM 3725');
  });

  it('extracts credit card details from creditData', () => {
    const details = parseAccountRawJson({
      type: 'CREDIT',
      creditData: {
        level: 'PLATINUM',
        brand: 'MASTERCARD',
        balanceCloseDate: '2026-06-15',
        balanceDueDate: '2026-06-20',
        minimumPayment: '150.00',
        availableCreditLimit: '4500.00',
        creditLimit: '5000.00',
        status: 'ACTIVE',
      },
    });

    expect(details.creditData).toEqual({
      level: 'PLATINUM',
      brand: 'MASTERCARD',
      balance_close_date: '2026-06-15',
      balance_due_date: '2026-06-20',
      minimum_payment_cents: 15000,
      available_credit_limit_cents: 450000,
      credit_limit_cents: 500000,
      status: 'ACTIVE',
    });
  });

  it('formats credit cards with last-four digits when available', () => {
    expect(extractCardLastFourDigits('************3725')).toBe('3725');
    expect(formatCreditCardDisplayName('MASTERCARD', 'PLATINUM', '************3725')).toBe(
      'MASTERCARD (3725)',
    );
    expect(formatCreditCardDisplayName('VISA', 'PLATINUM', null)).toBe('VISA (PLATINUM)');
  });

  it('formats type and subtype for display labels', () => {
    expect(formatAccountTypeSubtype('BANK', 'CHECKING_ACCOUNT')).toBe('BANK/CHECKING_ACCOUNT');
    expect(formatAccountTypeSubtype('BANK', 'SAVINGS_ACCOUNT')).toBe('BANK/SAVINGS_ACCOUNT');
    expect(formatAccountTypeSubtype('CREDIT', null)).toBe('CREDIT');
  });

  it('uses transferNumber as the default bank account display name', () => {
    const details = parseAccountRawJson({
      type: 'BANK',
      bankData: {
        transferNumber: '341/1234/56789-0',
      },
    });

    expect(
      resolveDefaultAccountDisplayName('BANK', 'Checking', null, 'acct-1', null, details),
    ).toBe('341/1234/56789-0');
  });
});

describe('account list enrichment', () => {
  it('enriches bank and credit rows from raw_json', () => {
    const db = new DatabaseSync(':memory:');
    migrateDatabase(db);

    db.prepare(
      `INSERT INTO connections (item_id, connector_id, connector_name, status, raw_json, synced_at)
       VALUES ('item-1', '341', 'Itaú', 'UPDATED', '{}', '2026-06-10T00:00:00.000Z')`,
    ).run();

    db.prepare(
      `INSERT INTO accounts (id, connection_item_id, type, name, number, currency, raw_json, synced_at)
       VALUES (
         'bank-1', 'item-1', 'BANK', 'Checking', NULL, 'BRL',
         ?, '2026-06-10T00:00:00.000Z'
       )`,
    ).run(
      JSON.stringify({
        bankData: { transferNumber: '341/1234/56789-0' },
      }),
    );

    db.prepare(
      `INSERT INTO accounts (id, connection_item_id, type, name, number, currency, raw_json, synced_at)
       VALUES (
         'card-1', 'item-1', 'CREDIT', 'Platinum Card', '************3725', 'BRL',
         ?, '2026-06-10T00:00:00.000Z'
       )`,
    ).run(
      JSON.stringify({
        number: '************3725',
        creditData: {
          level: 'PLATINUM',
          brand: 'MASTERCARD',
          balanceCloseDate: '2026-06-15',
          balanceDueDate: '2026-06-20',
          minimumPayment: '150.00',
          availableCreditLimit: '4500.00',
          creditLimit: '5000.00',
          status: 'ACTIVE',
        },
      }),
    );

    db.prepare(
      `INSERT INTO accounts (id, connection_item_id, type, name, number, currency, raw_json, synced_at)
       VALUES (
         'card-2', 'item-1', 'CREDIT', 'Visa Card', '************7750', 'BRL',
         ?, '2026-06-10T00:00:00.000Z'
       )`,
    ).run(
      JSON.stringify({
        number: '************7750',
        creditData: {
          level: 'PLATINUM',
          brand: 'VISA',
        },
      }),
    );

    expect(resolveAccountDisplayName(db, 'bank-1')).toBe('341/1234/56789-0');
    expect(resolveAccountDisplayName(db, 'card-1')).toBe('MASTERCARD (3725)');
    expect(resolveConnectionDisplayName(db, 'item-1')).toBe(
      '341/1234/56789-0 · MASTERCARD (3725) · VISA (7750)',
    );

    const rows = enrichListRows(db, accountsEntity.name, [
      {
        id: 'bank-1',
        connection_item_id: 'item-1',
        type: 'BANK',
        name: 'Checking',
        currency: 'BRL',
        raw_json: JSON.stringify({
          bankData: { transferNumber: '341/1234/56789-0' },
        }),
        synced_at: '2026-06-10T00:00:00.000Z',
      },
      {
        id: 'card-1',
        connection_item_id: 'item-1',
        type: 'CREDIT',
        name: 'Platinum Card',
        number: '************3725',
        currency: 'BRL',
        raw_json: JSON.stringify({
          creditData: {
            level: 'PLATINUM',
            brand: 'MASTERCARD',
            balanceCloseDate: '2026-06-15',
            balanceDueDate: '2026-06-20',
            minimumPayment: '150.00',
            availableCreditLimit: '4500.00',
            creditLimit: '5000.00',
            status: 'ACTIVE',
          },
        }),
        synced_at: '2026-06-10T00:00:00.000Z',
      },
    ]);

    expect(rows[0]?.['branch']).toBe('1234');
    expect(rows[0]?.['account']).toBe('56789-0');
    expect(rows[0]?.['transfer_number']).toBe('341/1234/56789-0');
    expect(rows[1]?.['display_name']).toBe('MASTERCARD (3725)');
    expect(rows[1]?.['credit_data']).toEqual({
      level: 'PLATINUM',
      brand: 'MASTERCARD',
      balance_close_date: '2026-06-15',
      balance_due_date: '2026-06-20',
      minimum_payment_cents: 15000,
      available_credit_limit_cents: 450000,
      credit_limit_cents: 500000,
      status: 'ACTIVE',
    });
  });
});
