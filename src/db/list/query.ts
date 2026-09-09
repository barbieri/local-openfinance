import type { DatabaseSync, SQLInputValue } from 'node:sqlite';
import {
  COMPARABLE_OPERATORS,
  type FieldFilter,
  type FieldType,
  type FilterOperator,
  type ListQueryInput,
  type ListQueryResult,
  TEXT_OPERATORS,
} from './types.js';

export class ListQueryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ListQueryError';
  }
}

export function runListQuery(db: DatabaseSync, input: ListQueryInput): ListQueryResult {
  const alias = input.entity.alias ?? input.entity.table;
  const whereParts: string[] = [];
  const params: SQLInputValue[] = [];

  if (input.entity.staticWhere) {
    whereParts.push(input.entity.staticWhere);
  }

  for (const filter of input.filters) {
    const fieldDef = input.entity.fields[filter.field];
    if (!fieldDef) {
      throw new ListQueryError(`Unknown filter field ${filter.field} for ${input.entity.name}`);
    }

    const column = fieldDef.column ?? filter.field;
    const sql = buildFilterClause(`${alias}.${column}`, fieldDef.type, filter, params);
    whereParts.push(sql);
  }

  const whereSql = whereParts.length > 0 ? `WHERE ${whereParts.join(' AND ')}` : '';
  const countRow = db
    .prepare(`SELECT COUNT(*) AS total FROM ${input.entity.table} AS ${alias} ${whereSql}`)
    .get(...params) as { readonly total: number };

  const rows = db
    .prepare(
      `SELECT ${alias}.* FROM ${input.entity.table} AS ${alias} ${whereSql} ORDER BY ${input.entity.defaultOrderBy} LIMIT ? OFFSET ?`,
    )
    .all(...params, input.limit, input.offset) as Record<string, unknown>[];

  return {
    total: countRow.total,
    limit: input.limit,
    offset: input.offset,
    rows,
  };
}

function buildFilterClause(
  columnSql: string,
  fieldType: FieldType,
  filter: FieldFilter,
  params: SQLInputValue[],
): string {
  assertOperatorAllowed(fieldType, filter.operator);

  switch (filter.operator) {
    case 'contains':
      params.push(`%${escapeLike(filter.value)}%`);
      return `${columnSql} LIKE ? ESCAPE '\\'`;
    case 'eq':
      params.push(coerceValue(fieldType, filter.value));
      return `${columnSql} = ?`;
    case 'ne':
      params.push(coerceValue(fieldType, filter.value));
      return `${columnSql} <> ?`;
    case 'lt':
      params.push(coerceValue(fieldType, filter.value));
      return `${columnSql} < ?`;
    case 'gt':
      params.push(coerceValue(fieldType, filter.value));
      return `${columnSql} > ?`;
    case 'le':
      params.push(coerceValue(fieldType, filter.value));
      return `${columnSql} <= ?`;
    case 'ge':
      params.push(coerceValue(fieldType, filter.value));
      return `${columnSql} >= ?`;
    default:
      throw new ListQueryError(`Unsupported operator ${filter.operator satisfies never}`);
  }
}

function assertOperatorAllowed(fieldType: FieldType, operator: FilterOperator): void {
  if (operator === 'contains') {
    if (fieldType !== 'text') {
      throw new ListQueryError(`Operator contains is only valid for text fields`);
    }
    return;
  }

  if (fieldType === 'text' && !TEXT_OPERATORS.includes(operator)) {
    throw new ListQueryError(`Operator ${operator} is not valid for text field`);
  }

  if (fieldType !== 'text' && !COMPARABLE_OPERATORS.includes(operator)) {
    throw new ListQueryError(`Operator ${operator} is not valid for ${fieldType} field`);
  }
}

function coerceValue(fieldType: FieldType, value: string): string | number {
  if (fieldType === 'integer') {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed)) {
      throw new ListQueryError(`Expected integer value, got ${value}`);
    }
    return parsed;
  }

  if (fieldType === 'number') {
    const parsed = Number.parseFloat(value);
    if (!Number.isFinite(parsed)) {
      throw new ListQueryError(`Expected numeric value, got ${value}`);
    }
    return parsed;
  }

  return value;
}

function escapeLike(value: string): string {
  return value.replace(/\\/gu, '\\\\').replace(/%/gu, '\\%').replace(/_/gu, '\\_');
}
