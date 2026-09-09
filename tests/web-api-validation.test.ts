import { Ajv2020 } from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';
import webApiSchema from '../schemas/web-api.schema.json' with { type: 'json' };
import { normalizeTransferConfirmBody } from '../src/transfers/detect.js';

const ajv = new Ajv2020({ allErrors: true });
ajv.addSchema(webApiSchema);

function validate(kind: string, body: unknown): boolean {
  const validateFn = ajv.getSchema(
    `https://github.com/barbieri/local-openfinance/schemas/web-api.schema.json#/$defs/${kind}`,
  );
  if (!validateFn) {
    throw new Error(`Missing schema: ${kind}`);
  }
  return validateFn(body) === true;
}

describe('web-api.schema.json', () => {
  it('accepts a valid transaction classification body', () => {
    expect(
      validate('saveTransactionClassification', {
        categoryOverrideId: 'food',
        labelIds: ['travel'],
        notes: 'Hotel',
        applyToInstallmentSiblings: true,
      }),
    ).toBe(true);
  });

  it('rejects unknown classification fields', () => {
    expect(
      validate('saveTransactionClassification', {
        categoryId: 'food',
        unexpected: true,
      }),
    ).toBe(false);
  });

  it('rejects oversized label id arrays', () => {
    expect(
      validate('saveEntryAnnotation', {
        entryType: 'transaction',
        entryId: 'tx-1',
        labelIds: Array.from({ length: 51 }, (_, index) => `label-${index}`),
      }),
    ).toBe(false);
  });

  it('validates transfer confirm pair shape', () => {
    const leg = {
      id: 'tx-1',
      accountId: 'acc-1',
      occurredAt: '2026-06-01T12:00:00.000Z',
      amountCents: -1000,
      merchantName: null,
      description: null,
    };
    expect(
      validate('transferConfirm', {
        pairs: [
          {
            source: leg,
            destination: { ...leg, id: 'tx-2', amountCents: 1000 },
            kind: 'internal_transfer',
            confidence: 0.9,
            amountConfidence: 0.95,
            timeConfidence: 0.85,
          },
        ],
      }),
    ).toBe(true);
    expect(validate('transferConfirm', { pairs: [{ source: leg }] })).toBe(false);
  });

  it('accepts transfer confirm pairs after stripping detect-only leg fields', () => {
    const leg = {
      id: 'tx-1',
      accountId: 'acc-1',
      accountType: 'BANK',
      occurredAt: '2026-06-01T12:00:00.000Z',
      amountCents: -1000,
      merchantName: null,
      description: null,
    };
    const normalized = normalizeTransferConfirmBody({
      pairs: [
        {
          source: leg,
          destination: { ...leg, id: 'tx-2', amountCents: 1000 },
          kind: 'internal_transfer',
          confidence: 0.9,
          amountConfidence: 0.95,
          timeConfidence: 0.85,
        },
      ],
    });
    expect(validate('transferConfirm', normalized)).toBe(true);
    expect(validate('transferConfirm', { pairs: [{ source: leg }] })).toBe(false);
  });
});
