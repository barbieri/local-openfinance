export type FieldType = 'text' | 'integer' | 'number' | 'date';

export type FilterOperator = 'eq' | 'ne' | 'contains' | 'lt' | 'gt' | 'le' | 'ge';

export type FieldFilter = {
  readonly field: string;
  readonly operator: FilterOperator;
  readonly value: string;
};

export type ListEntityDefinition = {
  readonly name: string;
  readonly table: string;
  readonly alias?: string;
  readonly fields: Readonly<Record<string, { readonly type: FieldType; readonly column?: string }>>;
  readonly defaultOrderBy: string;
  readonly staticWhere?: string;
};

export type ListQueryInput = {
  readonly entity: ListEntityDefinition;
  readonly filters: readonly FieldFilter[];
  readonly limit: number;
  readonly offset: number;
};

export type ListQueryResult = {
  readonly total: number;
  readonly limit: number;
  readonly offset: number;
  readonly rows: readonly Record<string, unknown>[];
};

export const TEXT_OPERATORS: readonly FilterOperator[] = ['eq', 'ne', 'contains'];
export const COMPARABLE_OPERATORS: readonly FilterOperator[] = ['eq', 'ne', 'lt', 'gt', 'le', 'ge'];
