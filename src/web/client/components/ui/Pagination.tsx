import { clsx } from 'clsx';
import { useTranslation } from 'react-i18next';

const MAX_VISIBLE_PAGES = 7;

function buildPageNumbers(page: number, pageCount: number): readonly (number | 'ellipsis')[] {
  if (pageCount <= MAX_VISIBLE_PAGES) {
    return Array.from({ length: pageCount }, (_, index) => index + 1);
  }

  const pages = new Set<number>([1, pageCount, page]);
  for (let offset = -1; offset <= 1; offset += 1) {
    const candidate = page + offset;
    if (candidate >= 1 && candidate <= pageCount) {
      pages.add(candidate);
    }
  }

  const sorted = [...pages];
  sorted.sort((left, right) => left - right);
  const result: (number | 'ellipsis')[] = [];
  for (let index = 0; index < sorted.length; index += 1) {
    const current = sorted[index];
    const previous = sorted[index - 1];
    if (current !== undefined && previous !== undefined && current - previous > 1) {
      result.push('ellipsis');
    }
    if (current !== undefined) {
      result.push(current);
    }
  }
  return result;
}

export function Pagination({
  page,
  pageCount,
  total,
  pageSize,
  onPageChange,
}: {
  readonly page: number;
  readonly pageCount: number;
  readonly total: number;
  readonly pageSize: number;
  readonly onPageChange: (page: number) => void;
}) {
  const { t } = useTranslation();
  if (pageCount <= 1) {
    return null;
  }

  const start = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const end = Math.min(page * pageSize, total);
  const pageNumbers = buildPageNumbers(page, pageCount);

  const navButtonClass =
    'rounded border border-border px-2 py-1 text-sm disabled:cursor-not-allowed disabled:opacity-40';

  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <p className="text-sm text-muted-foreground">
        {t('pagination.range', { start, end, total })}
      </p>
      <div className="flex flex-wrap items-center gap-1">
        <button
          type="button"
          className={navButtonClass}
          disabled={page <= 1}
          aria-label={t('pagination.first')}
          onClick={() => onPageChange(1)}
        >
          «
        </button>
        <button
          type="button"
          className={navButtonClass}
          disabled={page <= 1}
          aria-label={t('pagination.previous')}
          onClick={() => onPageChange(page - 1)}
        >
          ‹
        </button>
        {pageNumbers.map((entry, index) => {
          const previous = pageNumbers[index - 1];
          const next = pageNumbers[index + 1];
          if (entry === 'ellipsis') {
            return (
              <span
                key={`ellipsis-${String(previous)}-${String(next)}`}
                className="px-1 text-sm text-muted-foreground"
              >
                …
              </span>
            );
          }
          return (
            <button
              key={entry}
              type="button"
              className={clsx(
                'min-w-8 rounded border px-2 py-1 text-sm tabular-nums',
                entry === page
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'border-border hover:bg-accent/40',
              )}
              aria-current={entry === page ? 'page' : undefined}
              onClick={() => onPageChange(entry)}
            >
              {entry}
            </button>
          );
        })}
        <button
          type="button"
          className={navButtonClass}
          disabled={page >= pageCount}
          aria-label={t('pagination.next')}
          onClick={() => onPageChange(page + 1)}
        >
          ›
        </button>
        <button
          type="button"
          className={navButtonClass}
          disabled={page >= pageCount}
          aria-label={t('pagination.last')}
          onClick={() => onPageChange(pageCount)}
        >
          »
        </button>
      </div>
    </div>
  );
}
