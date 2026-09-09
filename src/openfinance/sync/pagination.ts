import { throwIfAborted } from '../../utils/job-abort.js';
import { readArray, readFieldString, readRecord } from '../money.js';

export type PaginatePageInfo = {
  readonly page: number;
  readonly totalPages: number;
  readonly rowsOnPage: number;
};

export type PaginateOptions<T> = {
  readonly onPage?: (info: PaginatePageInfo) => void;
  readonly shouldSkip?: (row: T) => boolean;
  /** Called after each page; return true to stop fetching further pages. */
  readonly shouldStopAfterPage?: (rows: readonly T[]) => boolean;
  readonly signal?: AbortSignal | undefined;
};

export async function paginateResults<T>(
  fetchPage: (
    page: number,
  ) => Promise<{ readonly rows: readonly unknown[]; readonly totalPages: number }>,
  consume: (row: T) => void,
  options?: PaginateOptions<T>,
): Promise<number> {
  let page = 1;
  let totalPages = 1;
  let count = 0;

  while (page <= totalPages) {
    throwIfAborted(options?.signal);

    const result = await fetchPage(page);
    totalPages = result.totalPages;
    const rows = result.rows as readonly T[];

    options?.onPage?.({ page, totalPages, rowsOnPage: rows.length });

    for (const item of rows) {
      if (options?.shouldSkip?.(item)) {
        continue;
      }
      consume(item);
      count += 1;
    }

    if (rows.length === 0) {
      break;
    }

    if (options?.shouldStopAfterPage?.(rows)) {
      break;
    }

    page += 1;
  }

  return count;
}

export function readPagedRows(
  result: Record<string, unknown>,
  page: number,
): {
  readonly rows: readonly unknown[];
  readonly totalPages: number;
} {
  const totalPagesRaw = result['totalPages'];
  return {
    rows: readArray(result['results']),
    totalPages: typeof totalPagesRaw === 'number' ? totalPagesRaw : page,
  };
}

export function readResultRecords(
  result: Record<string, unknown>,
): readonly Record<string, unknown>[] {
  return readArray(result['results'])
    .map((item) => readRecord(item))
    .filter((record): record is Record<string, unknown> => record !== null);
}

export function readNestedResultRecords(
  result: Record<string, unknown>,
): readonly Record<string, unknown>[] {
  const rows: Record<string, unknown>[] = [];
  for (const batch of readArray(result['results'])) {
    const batchRecord = readRecord(batch);
    for (const item of readArray(batchRecord?.['results'])) {
      const record = readRecord(item);
      if (record) {
        rows.push(record);
      }
    }
  }
  return rows;
}

export function readEntityId(record: Record<string, unknown>): string | null {
  return readFieldString(record, 'id') ?? readFieldString(record, 'account_id');
}
