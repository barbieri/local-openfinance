import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { buildStrongPeerSqlPredicate } from '../src/db/transaction-history-query.js';
import {
  collectCounterpartyDocumentKeys,
  collectPeerDocumentKeys,
  extractTransactionDocumentKeys,
  formatDocumentKey,
  readPaymentDocumentsFromRawJson as readPaymentDocumentsFromRawJsonCore,
  resolveStrongSharedPeerDocumentKey,
} from '../src/openfinance/payment-document.js';
import {
  formatPaymentDocumentValue,
  readPaymentDocumentsFromRawJson,
  readTransactionCardNumber,
} from '../src/web/client/lib/payment-document.js';

describe('payment document helpers', () => {
  it('keeps SQL and in-memory peer policy equivalent', () => {
    const holder = 'cpf:39053344705';
    const merchant = 'cnpj:11222333000181';
    const cases = [
      {
        target: {
          payerDocumentKey: holder,
          receiverDocumentKey: holder,
          merchantDocumentKey: null,
        },
        targetAmountCents: -1000,
        candidate: {
          payerDocumentKey: holder,
          receiverDocumentKey: holder,
          merchantDocumentKey: null,
        },
        candidateAmountCents: -2000,
        expected: true,
      },
      {
        target: {
          payerDocumentKey: holder,
          receiverDocumentKey: merchant,
          merchantDocumentKey: null,
        },
        targetAmountCents: -1000,
        candidate: {
          payerDocumentKey: holder,
          receiverDocumentKey: merchant,
          merchantDocumentKey: null,
        },
        candidateAmountCents: -2000,
        expected: true,
      },
      {
        target: {
          payerDocumentKey: holder,
          receiverDocumentKey: null,
          merchantDocumentKey: merchant,
        },
        targetAmountCents: -1000,
        candidate: {
          payerDocumentKey: merchant,
          receiverDocumentKey: holder,
          merchantDocumentKey: null,
        },
        candidateAmountCents: 2000,
        expected: true,
      },
    ] as const;

    for (const testCase of cases) {
      const inMemory =
        resolveStrongSharedPeerDocumentKey(
          testCase.target,
          testCase.targetAmountCents,
          testCase.candidate,
          testCase.candidateAmountCents,
        ) !== null;
      const db = new DatabaseSync(':memory:');
      db.exec(
        `CREATE TABLE candidates (
           amount_cents INTEGER,
           payer_document_key TEXT,
           receiver_document_key TEXT,
           merchant_document_key TEXT
         )`,
      );
      const predicate = buildStrongPeerSqlPredicate(
        testCase.target,
        testCase.targetAmountCents,
        't',
      );
      db.prepare(
        `INSERT INTO candidates (
           amount_cents, payer_document_key, receiver_document_key, merchant_document_key
         ) VALUES (?, ?, ?, ?)`,
      ).run(
        testCase.candidateAmountCents,
        testCase.candidate.payerDocumentKey,
        testCase.candidate.receiverDocumentKey,
        testCase.candidate.merchantDocumentKey,
      );
      const sql = db
        .prepare(`SELECT 1 FROM candidates t WHERE ${predicate.sql}`)
        .get(...predicate.params);
      db.close();

      expect(inMemory).toBe(testCase.expected);
      expect(sql !== undefined).toBe(testCase.expected);
    }
  });

  it('formats CPF values for display', () => {
    expect(formatPaymentDocumentValue('CPF', '39053344705')).toBe('390.533.447-05');
  });

  it('builds normalized searchable document keys', () => {
    expect(formatDocumentKey('CPF', '390.533.447-05')).toBe('cpf:39053344705');
    expect(formatDocumentKey('CNPJ', '11.222.333/0001-81')).toBe('cnpj:11222333000181');
    expect(formatDocumentKey('CNPJ', 'DISTRIBUIDOR02')).toBeNull();
  });

  it('extracts peer document keys from merchant and paymentData', () => {
    const keys = extractTransactionDocumentKeys({
      merchant: { cnpj: '73042962000420' },
      paymentData: {
        payer: {
          documentNumber: { type: 'CPF', value: '390.533.447-05' },
        },
        receiver: {
          documentNumber: { type: 'CNPJ', value: '11.222.333/0001-81' },
        },
      },
    });
    expect(keys).toEqual({
      payerDocumentKey: 'cpf:39053344705',
      receiverDocumentKey: 'cnpj:11222333000181',
      merchantDocumentKey: 'cnpj:73042962000420',
    });
    expect(collectPeerDocumentKeys(keys)).toEqual([
      'cpf:39053344705',
      'cnpj:11222333000181',
      'cnpj:73042962000420',
    ]);
    // Counterparty roles still used to decide which shared keys are strong.
    expect(collectCounterpartyDocumentKeys(keys, -15000)).toEqual([
      'cnpj:73042962000420',
      'cnpj:11222333000181',
    ]);
    expect(collectCounterpartyDocumentKeys(keys, 15000)).toEqual([
      'cnpj:73042962000420',
      'cpf:39053344705',
    ]);
  });

  it('accepts shared counterparty CNPJ but rejects shared self CPF alone', () => {
    const selfCpf = 'cpf:39053344705';
    const parking = {
      payerDocumentKey: selfCpf,
      receiverDocumentKey: 'cnpj:00000000000191',
      merchantDocumentKey: 'cnpj:00000000000191',
    };
    const emdurb = {
      payerDocumentKey: selfCpf,
      receiverDocumentKey: 'cnpj:11444777000161',
      merchantDocumentKey: 'cnpj:11444777000161',
    };
    const samePeer = {
      payerDocumentKey: selfCpf,
      receiverDocumentKey: 'cnpj:11444777000161',
      merchantDocumentKey: 'cnpj:11444777000161',
    };

    expect(resolveStrongSharedPeerDocumentKey(emdurb, -400, parking, -400)).toBeNull();
    expect(resolveStrongSharedPeerDocumentKey(emdurb, -400, samePeer, -1800)).toBe(
      'cnpj:11444777000161',
    );
  });

  it('rejects self CPF when debit only has payer and credit lists same CPF as payer', () => {
    const selfCpf = 'cpf:39053344705';
    const cardDebit = {
      payerDocumentKey: selfCpf,
      receiverDocumentKey: null,
      merchantDocumentKey: null,
    };
    const pixReceived = {
      payerDocumentKey: selfCpf,
      receiverDocumentKey: null,
      merchantDocumentKey: null,
    };
    // THE ONE-style debit vs "Pix recebido" credit — must not peer-match on holder CPF.
    expect(
      resolveStrongSharedPeerDocumentKey(cardDebit, -4_860_014, pixReceived, 10_000),
    ).toBeNull();
    expect(resolveStrongSharedPeerDocumentKey(cardDebit, -4_860_014, cardDebit, -1_000)).toBeNull();
  });

  it('matches opposite-direction true counterparty (debit receiver vs credit payer)', () => {
    const company = 'cnpj:11222333000181';
    const outbound = {
      payerDocumentKey: 'cpf:39053344705',
      receiverDocumentKey: company,
      merchantDocumentKey: company,
    };
    const inbound = {
      payerDocumentKey: company,
      receiverDocumentKey: 'cpf:39053344705',
      merchantDocumentKey: null,
    };
    expect(resolveStrongSharedPeerDocumentKey(outbound, -1000, inbound, 1000)).toBe(company);
  });

  it('requires the same personal-document role across accounts', () => {
    const holder = 'cpf:39053344705';
    const ownDebit = {
      payerDocumentKey: holder,
      receiverDocumentKey: null,
      merchantDocumentKey: null,
    };
    const ownCredit = {
      payerDocumentKey: holder,
      receiverDocumentKey: null,
      merchantDocumentKey: null,
    };
    expect(resolveStrongSharedPeerDocumentKey(ownDebit, -1000, ownCredit, 1000)).toBeNull();
  });

  it('reads payer and receiver documents from paymentData', () => {
    const rawJson = JSON.stringify({
      paymentData: {
        payer: {
          documentNumber: {
            type: 'CPF',
            value: '39053344705',
          },
        },
        receiver: {
          type: 'CPF',
          value: '12345678901',
        },
      },
    });

    expect(readPaymentDocumentsFromRawJson(rawJson)).toEqual({
      payer: { type: 'CPF', value: '39053344705' },
      receiver: { type: 'CPF', value: '12345678901' },
      receiverName: null,
    });
  });

  it('reads string receiver names from paymentData', () => {
    const rawJson = JSON.stringify({
      paymentData: { receiver: 'Joao Silva' },
    });
    expect(readPaymentDocumentsFromRawJsonCore(rawJson)).toEqual({
      payer: null,
      receiver: null,
      receiverName: 'Joao Silva',
    });
  });

  it('reads card numbers from credit card metadata or credit accounts', () => {
    expect(
      readTransactionCardNumber(
        JSON.stringify({ creditCardMetadata: { cardNumber: '1234' } }),
        null,
      ),
    ).toBe('1234');
    expect(
      readTransactionCardNumber('{}', {
        type: 'CREDIT',
        number: '•••• 5678',
      }),
    ).toBe('•••• 5678');
  });
});
