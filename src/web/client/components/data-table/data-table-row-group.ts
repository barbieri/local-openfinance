export type DataTableRowGroupAmountSummary = {
  readonly positiveCents: number;
  readonly negativeCents: number;
  readonly balanceCents: number;
  readonly currency: string | null;
  readonly mixedCurrencies: boolean;
};

export type DataTableRowGroupCategoryPresentation = {
  readonly name: string;
  readonly icon: string;
  readonly color: string;
  readonly path?: string;
};

export type DataTableRowGroupLabelPresentation = {
  readonly id: string;
  readonly name: string;
  readonly icon: string;
  readonly color: string;
  readonly path: string;
};

export type DataTableRowGroup = {
  readonly id: string;
  readonly field: string;
  readonly label: string;
  readonly count: number;
  readonly depth: number;
  readonly allRowIndexes: readonly number[];
  readonly rowIndexes?: readonly number[];
  readonly children?: readonly DataTableRowGroup[];
  readonly amountSummary: DataTableRowGroupAmountSummary;
  readonly categoryPresentation?: DataTableRowGroupCategoryPresentation;
  readonly labelPresentations?: readonly DataTableRowGroupLabelPresentation[];
};
