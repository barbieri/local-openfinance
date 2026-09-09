import type { DatabaseSync } from 'node:sqlite';
import type { ResolvedConfig } from '../../types.js';
import type { BackgroundJobManager } from './background-jobs.js';

export type WebServerContext = {
  readonly db: DatabaseSync;
  readonly resolved: ResolvedConfig;
  readonly jobs: BackgroundJobManager;
};

export function buildByIdMap<T extends { readonly id: string }>(
  rows: readonly T[],
): Record<string, T> {
  return Object.fromEntries(rows.map((row) => [row.id, row]));
}

export function buildConnectionById(
  rows: readonly Record<string, unknown>[],
): Record<string, Record<string, unknown>> {
  return Object.fromEntries(rows.map((row) => [String(row['item_id']), row]));
}
