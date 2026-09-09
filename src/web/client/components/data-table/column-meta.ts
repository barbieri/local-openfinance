import type { CellData, RowData, TableFeatures } from '@tanstack/react-table';

declare module '@tanstack/react-table' {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface ColumnMeta<
    TFeatures extends TableFeatures,
    TData extends RowData,
    TValue extends CellData,
  > {
    align?: 'left' | 'right' | 'center';
    isNumeric?: boolean;
  }
}

type ColumnPresentation = {
  readonly enableSorting: boolean;
  readonly meta: {
    readonly align: 'right';
    readonly isNumeric: boolean;
  };
};

export function numericColumn<_T extends RowData>(): ColumnPresentation {
  return {
    meta: { align: 'right', isNumeric: true },
    enableSorting: true,
  };
}

export function actionsColumn<_T extends RowData>(): ColumnPresentation {
  return {
    meta: { align: 'right', isNumeric: false },
    enableSorting: false,
  };
}
