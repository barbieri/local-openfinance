import {
  flexRender,
  type OnChangeFn,
  type RowData,
  type SortingState,
} from '@tanstack/react-table';
import {
  type LegacyColumnDef as ColumnDef,
  getCoreRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  type LegacyRow as Row,
  useLegacyTable,
} from '@tanstack/react-table/legacy';
import { clsx } from 'clsx';
import { Fragment, type ReactNode, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { DataTableRowGroup } from './data-table-row-group.js';
import { SortableHeader } from './SortableHeader.js';
import { alignClass, contentAlignClass } from './sortable-header-utils.js';

type DataTableProps<T extends RowData> = {
  readonly columns: ColumnDef<T, unknown>[];
  readonly data: readonly T[];
  readonly rowGroups?: readonly DataTableRowGroup[];
  readonly renderRowGroupHeader?: (group: DataTableRowGroup) => ReactNode;
  readonly emptyMessage?: string;
  readonly onRowClick?: (row: T) => void;
  readonly getRowClassName?: (row: T) => string | undefined;
  readonly getRowDataId?: (row: T) => string | undefined;
  readonly rowClickIgnoreColumnIds?: readonly string[];
  readonly stickyColumnClassNames?: Readonly<Record<string, string>>;
  readonly cellClassNames?: Readonly<Record<string, string>>;
  readonly sorting?: SortingState;
  readonly onSortingChange?: OnChangeFn<SortingState>;
  readonly manualSorting?: boolean;
};

function resolveCellClassName(
  columnId: string,
  cellClassNames: Readonly<Record<string, string>>,
): string | undefined {
  return (
    cellClassNames[columnId] ??
    (columnId === 'description' || columnId === 'labels' ? 'hidden sm:table-cell' : undefined)
  );
}

export function DataTable<T extends RowData>({
  columns,
  data,
  rowGroups,
  renderRowGroupHeader,
  emptyMessage,
  onRowClick,
  getRowClassName,
  getRowDataId,
  rowClickIgnoreColumnIds = ['select'],
  stickyColumnClassNames = {},
  cellClassNames = {},
  sorting: controlledSorting,
  onSortingChange: controlledOnSortingChange,
  manualSorting = false,
}: DataTableProps<T>) {
  const { t } = useTranslation();
  const [internalSorting, setInternalSorting] = useState<SortingState>([]);
  const sorting = controlledSorting ?? internalSorting;
  const onSortingChange = controlledOnSortingChange ?? setInternalSorting;
  const rowClickIgnoreColumnIdSet = useMemo(
    () => new Set(rowClickIgnoreColumnIds),
    [rowClickIgnoreColumnIds],
  );
  const table = useLegacyTable({
    data: useMemo(() => [...data], [data]),
    columns,
    state: { sorting },
    onSortingChange,
    manualSorting,
    // Server-backed sorts should flip asc/desc; clearing sort would fall back to API defaults.
    enableSortingRemoval: !manualSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: manualSorting ? undefined : getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
  });

  const tableRows = table.getRowModel().rows;
  const columnCount = table.getVisibleLeafColumns().length;

  if (data.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">
        {emptyMessage ?? t('table.empty')}
      </p>
    );
  }

  const renderDataRow = (row: Row<T>) => (
    <tr
      key={row.id}
      data-row-id={getRowDataId?.(row.original)}
      role={onRowClick ? 'button' : undefined}
      tabIndex={onRowClick ? 0 : undefined}
      className={clsx(
        'border-t border-border/70 hover:bg-accent/30',
        onRowClick && 'cursor-pointer',
        getRowClassName?.(row.original),
      )}
      onClick={(event) => {
        if (!onRowClick) {
          return;
        }
        const target = event.target as HTMLElement;
        if (target.closest('[data-row-click-ignore="true"]')) {
          return;
        }
        onRowClick(row.original);
      }}
      onKeyDown={(event) => {
        if (!onRowClick || (event.key !== 'Enter' && event.key !== ' ')) {
          return;
        }
        const target = event.target as HTMLElement;
        if (target.closest('[data-row-click-ignore="true"]')) {
          return;
        }
        event.preventDefault();
        onRowClick(row.original);
      }}
    >
      {row.getVisibleCells().map((cell) => {
        const align = cell.column.columnDef.meta?.align ?? 'left';
        const isNumeric = cell.column.columnDef.meta?.isNumeric;
        const cellContent = flexRender(cell.column.columnDef.cell, cell.getContext());
        const ignoreClick = rowClickIgnoreColumnIdSet.has(cell.column.id);
        const stickyClassName = stickyColumnClassNames[cell.column.id];
        const cellClassName = resolveCellClassName(cell.column.id, cellClassNames);
        return (
          <td
            key={cell.id}
            data-row-click-ignore={ignoreClick ? 'true' : undefined}
            className={clsx(
              'px-3 py-1.5 align-middle',
              align === 'left' && alignClass(align),
              isNumeric && 'tabular-nums',
              stickyClassName,
              cellClassName,
            )}
          >
            {align === 'left' ? (
              cellContent
            ) : (
              <div className={contentAlignClass(align)}>{cellContent}</div>
            )}
          </td>
        );
      })}
    </tr>
  );

  const renderGroup = (group: DataTableRowGroup): ReactNode => (
    <Fragment key={`group-fragment-${group.id}`}>
      <tr key={`group-${group.id}`} className="border-t border-border bg-muted/40">
        <td colSpan={columnCount} className="px-3 py-2 text-sm">
          <div
            className="flex items-center justify-between gap-3"
            style={{ paddingLeft: `${group.depth * 1.25}rem` }}
          >
            {renderRowGroupHeader ? (
              renderRowGroupHeader(group)
            ) : (
              <>
                <span className="min-w-0 truncate font-medium">{group.label}</span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {t('table.groupRows', { count: group.count })}
                </span>
              </>
            )}
          </div>
        </td>
      </tr>
      {group.children?.map(renderGroup)}
      {group.rowIndexes?.map((index) => {
        const row = tableRows[index];
        return row ? renderDataRow(row) : null;
      })}
    </Fragment>
  );

  return (
    <div className="max-w-full overflow-x-auto rounded-md border border-border shadow-sm">
      <table className="w-full min-w-max text-sm">
        <thead className="bg-primary/10">
          {table.getHeaderGroups().map((headerGroup) => (
            <tr key={headerGroup.id} className="border-b-2 border-primary/20">
              {headerGroup.headers.map((header) => {
                const align = header.column.columnDef.meta?.align ?? 'left';
                const canSort = header.column.getCanSort();
                const sorted = header.column.getIsSorted();
                const stickyClassName = stickyColumnClassNames[header.column.id];
                const cellClassName = resolveCellClassName(header.column.id, cellClassNames);
                return (
                  <th
                    key={header.id}
                    role={canSort ? 'button' : undefined}
                    tabIndex={canSort ? 0 : undefined}
                    className={clsx(
                      'sticky top-0 z-10 bg-primary/10 px-3 py-2.5 text-xs font-semibold uppercase tracking-wide text-foreground/80 backdrop-blur-sm',
                      alignClass(align),
                      stickyClassName,
                      cellClassName,
                      canSort && 'cursor-pointer select-none hover:bg-primary/5',
                    )}
                    onClick={canSort ? header.column.getToggleSortingHandler() : undefined}
                    onKeyDown={(event) => {
                      if (!canSort || (event.key !== 'Enter' && event.key !== ' ')) {
                        return;
                      }
                      event.preventDefault();
                      header.column.toggleSorting();
                    }}
                  >
                    {canSort ? (
                      <SortableHeader
                        align={align}
                        sorted={sorted}
                        label={flexRender(header.column.columnDef.header, header.getContext())}
                      />
                    ) : (
                      <span className={contentAlignClass(align)}>
                        {flexRender(header.column.columnDef.header, header.getContext())}
                      </span>
                    )}
                  </th>
                );
              })}
            </tr>
          ))}
        </thead>
        <tbody>
          {rowGroups && rowGroups.length > 0
            ? rowGroups.map(renderGroup)
            : tableRows.map(renderDataRow)}
        </tbody>
      </table>
    </div>
  );
}
