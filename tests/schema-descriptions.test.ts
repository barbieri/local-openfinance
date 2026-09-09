import { describe, expect, it } from 'vitest';
import configSchema from '../schemas/config.schema.json' with { type: 'json' };

const schemaKeywords = new Set([
  '$ref',
  'additionalProperties',
  'allOf',
  'anyOf',
  'const',
  'enum',
  'items',
  'oneOf',
  'properties',
  'type',
]);

describe('JSON Schema descriptions', () => {
  it('documents repository schema nodes with descriptions', () => {
    expect(collectMissingDescriptions(configSchema, 'config.schema.json')).toEqual([]);
  });
});

function collectMissingDescriptions(value: unknown, path: string): readonly string[] {
  const missing: string[] = [];
  visitSchema(value, path, missing);
  return missing;
}

function visitSchema(value: unknown, path: string, missing: string[]): void {
  if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) {
      visitSchema(item, `${path}[${index}]`, missing);
    }
    return;
  }

  if (!value || typeof value !== 'object') {
    return;
  }

  const node = value as { readonly description?: unknown } & Record<string, unknown>;
  if (isSchemaNode(node) && typeof node.description !== 'string') {
    missing.push(path);
  }

  for (const [key, child] of Object.entries(node)) {
    visitSchema(child, `${path}.${key}`, missing);
  }
}

function isSchemaNode(node: Record<string, unknown>): boolean {
  return Object.entries(node).some(([key, value]) => {
    if (!schemaKeywords.has(key)) {
      return false;
    }

    if (key === 'type' || key === '$ref') {
      return typeof value === 'string' || Array.isArray(value);
    }

    if (key === 'oneOf' || key === 'anyOf' || key === 'allOf' || key === 'enum') {
      return Array.isArray(value);
    }

    if (key === 'properties' || key === 'items') {
      return value !== null && typeof value === 'object';
    }

    return true;
  });
}
