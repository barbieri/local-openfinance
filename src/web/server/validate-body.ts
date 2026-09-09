import { Ajv2020 } from 'ajv/dist/2020.js';
import type { Context } from 'hono';
import { HTTPException } from 'hono/http-exception';
import webApiSchema from '../../../schemas/web-api.schema.json' with { type: 'json' };

const ajv = new Ajv2020({ allErrors: true });
ajv.addSchema(webApiSchema);

const validators = {
  saveTransactionClassification: ajv.compile({
    $ref: 'https://github.com/barbieri/local-openfinance/schemas/web-api.schema.json#/$defs/saveTransactionClassification',
  }),
  saveEntryAnnotation: ajv.compile({
    $ref: 'https://github.com/barbieri/local-openfinance/schemas/web-api.schema.json#/$defs/saveEntryAnnotation',
  }),
  categoryOverride: ajv.compile({
    $ref: 'https://github.com/barbieri/local-openfinance/schemas/web-api.schema.json#/$defs/categoryOverride',
  }),
  transferConfirm: ajv.compile({
    $ref: 'https://github.com/barbieri/local-openfinance/schemas/web-api.schema.json#/$defs/transferConfirm',
  }),
  transferLink: ajv.compile({
    $ref: 'https://github.com/barbieri/local-openfinance/schemas/web-api.schema.json#/$defs/transferLink',
  }),
  setTransactionBillLink: ajv.compile({
    $ref: 'https://github.com/barbieri/local-openfinance/schemas/web-api.schema.json#/$defs/setTransactionBillLink',
  }),
  saveIntelligenceMemory: ajv.compile({
    $ref: 'https://github.com/barbieri/local-openfinance/schemas/web-api.schema.json#/$defs/saveIntelligenceMemory',
  }),
  saveReportRegeneration: ajv.compile({
    $ref: 'https://github.com/barbieri/local-openfinance/schemas/web-api.schema.json#/$defs/saveReportRegeneration',
  }),
  executeIntelligenceTool: ajv.compile({
    $ref: 'https://github.com/barbieri/local-openfinance/schemas/web-api.schema.json#/$defs/executeIntelligenceTool',
  }),
} as const;

export type WebApiBodyKind = keyof typeof validators;

export function validateWebApiBody<T>(kind: WebApiBodyKind, body: unknown): T {
  const validate = validators[kind];
  if (!validate(body)) {
    throw new HTTPException(400, {
      message: ajv.errorsText(validate.errors, { separator: '; ' }),
    });
  }

  return body as T;
}

export async function parseValidatedJsonBody<T>(c: Context, kind: WebApiBodyKind): Promise<T> {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    throw new HTTPException(400, { message: 'Invalid JSON body' });
  }

  return validateWebApiBody<T>(kind, body);
}
