import process from 'node:process';
import type { FieldFilter, FilterOperator } from './types.js';

const FILTER_PATTERN =
  /^--(?<field>[a-zA-Z_][a-zA-Z0-9_]*)\.(?<operator>contains|eq|ne|lt|gt|le|ge)=(?<value>.*)$/u;

export function parseFieldFiltersFromArgv(argv: readonly string[] = process.argv): FieldFilter[] {
  const filters: FieldFilter[] = [];

  for (const arg of argv) {
    const match = FILTER_PATTERN.exec(arg);
    const groups = match?.groups;
    const field = groups?.['field'];
    const operator = groups?.['operator'];
    const value = groups?.['value'];
    if (!field || !operator || value === undefined) {
      continue;
    }

    filters.push({
      field,
      operator: operator as FilterOperator,
      value: decodeFilterValue(value),
    });
  }

  return filters;
}

function decodeFilterValue(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
