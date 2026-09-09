import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { OnChangeFn, SortingState } from '@tanstack/react-table';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import type { TransactionChartsState } from '../components/charts/TransactionCharts.js';
import type { DataTableRowGroup } from '../components/data-table/data-table-row-group.js';
import type { LabelRecord } from '../components/labels/LabelEditDialog.js';
import { buildTransactionTableColumns } from '../components/transactions/build-transaction-table-columns.js';
import type {
  DetectTransfersSummary,
  TransferPairProposal,
} from '../components/transactions/DetectTransfersDialog.js';
import type { TransactionColumnKey } from '../components/transactions/transactions-page-column-keys.js';
import { TRANSACTION_COLUMN_KEYS } from '../components/transactions/transactions-page-column-keys.js';
import type { TransactionRow } from '../components/transactions/transactions-page-types.js';
import { useTableUrlState } from '../hooks/use-table-url-state.js';
import { apiJson } from '../lib/api.js';
import { withLocaleQuery } from '../lib/api-locale.js';
import { resolveColumnBadgeDisplay } from '../lib/column-badge-display.js';
import { downloadCsv, downloadJson } from '../lib/export.js';
import { fetchAllFilteredTransactionRows } from '../lib/fetch-filtered-transaction-rows.js';
import { useAppNavigation } from '../lib/navigation.js';
import { applyShiftRangeSelection } from '../lib/shift-range-selection.js';
import {
  buildTransactionChartQuery,
  buildTransactionFilterSummary,
  buildTransactionListQuery,
  buildTransactionScopedQuery,
  clearTransactionFilterPart,
  DEFAULT_TRANSACTION_PAGE_SIZE,
  type TransactionFilterSummaryPart,
} from '../lib/transaction-filters.js';
import {
  buildTransactionRowGrouping,
  resolveTransactionGroupBy,
  resolveTransactionGroupByLabelKey,
  type TransactionGroupByField,
} from '../lib/transaction-row-grouping.js';
import {
  invalidateTransactionQueries,
  mergeTransactionFilterPatch,
  patchTransactionChartState,
} from './transactions-page-helpers.js';
import { useTransactionsPageUiState } from './transactions-page-state.js';
import { isUnclassifiedTransaction } from './transactions-page-utils.js';

type TransactionListResponse = {
  readonly rows: TransactionRow[];
  readonly total: number;
  readonly limit: number;
  readonly offset: number;
  readonly page: number;
  readonly pageCount: number;
};

const EMPTY_ACCOUNT_ROWS: readonly Record<string, unknown>[] = [];
const EMPTY_LABEL_BY_ID: Record<string, LabelRecord> = {};
const EMPTY_CATEGORY_BY_ID: Record<string, Record<string, unknown>> = {};
const EMPTY_TRANSACTION_ROWS: readonly TransactionRow[] = [];
const TRANSACTION_GROUP_SUMMARY_PREFIX = 'group:';

export type TransactionsPageViewProps = {
  readonly t: ReturnType<typeof useTranslation>['t'];
  readonly locale: string;
  readonly data: TransactionListResponse | undefined;
  readonly isLoading: boolean;
  readonly isError: boolean;
  readonly listError: Error | null;
  readonly uiSidebarOpen: boolean;
  readonly setSidebarOpen: (open: boolean) => void;
  readonly filterSummaryParts: readonly TransactionFilterSummaryPart[];
  readonly labelById: Record<string, LabelRecord>;
  readonly categoryById: Record<string, Record<string, unknown>>;
  readonly clearFilterPart: (partId: string) => void;
  readonly chartQueryString: string;
  readonly chartState: TransactionChartsState;
  readonly handleChartStateChange: (patch: Partial<TransactionChartsState>) => void;
  readonly rows: readonly TransactionRow[];
  readonly rowGroups: readonly DataTableRowGroup[];
  readonly selectedIds: readonly string[];
  readonly selectedCount: number;
  readonly currentRowId: string | null;
  readonly unclassifiedVisibleCount: number;
  readonly handleSelectAllVisible: () => void;
  readonly handleSelectNone: () => void;
  readonly handleSelectUnclassifiedVisible: () => void;
  readonly handleSelectGroupRows: (rowIds: readonly string[], checked: boolean) => void;
  readonly toggleCurrentRowSelection: () => void;
  readonly openEditSelected: () => void;
  readonly openCurrentRow: () => void;
  readonly moveCurrentRow: (direction: 'previous' | 'next') => void;
  readonly columns: ReturnType<typeof buildTransactionTableColumns>;
  readonly openDetailEditor: (row: TransactionRow) => void;
  readonly sorting: SortingState;
  readonly handleSortingChange: OnChangeFn<SortingState>;
  readonly setPage: (page: number) => void;
  readonly filters: Record<string, string | string[]>;
  readonly accounts: readonly Record<string, unknown>[];
  readonly bills: readonly Record<string, unknown>[];
  readonly displayDate?: 'credit-purchase' | undefined;
  readonly groupBy: readonly TransactionGroupByField[];
  readonly toggleGroupBy: (field: TransactionGroupByField, checked: boolean) => void;
  readonly updateFilter: (key: string, value: string) => void;
  readonly updateFilters: (patch: Record<string, string | undefined>) => void;
  readonly visibleColumns: Set<TransactionColumnKey>;
  readonly toggleColumn: (key: TransactionColumnKey, checked: boolean) => void;
  readonly categoryColumnDisplay: ReturnType<typeof resolveColumnBadgeDisplay>;
  readonly labelsColumnDisplay: ReturnType<typeof resolveColumnBadgeDisplay>;
  readonly updateColumnDisplay: (
    patch: Partial<NonNullable<ReturnType<typeof useTableUrlState>[0]['display']>>,
  ) => void;
  readonly matchingTotal: number;
  readonly detectPending: boolean;
  readonly exportPending: boolean;
  readonly onDetectTransfers: () => void;
  readonly onExportJson: () => void;
  readonly onExportCsv: () => void;
  readonly detailTransaction: TransactionRow | null;
  readonly detailEditIds: readonly string[];
  readonly closeDetail: () => void;
  readonly handleDetailSaved: () => Promise<void>;
  readonly openTransactionById: (transactionId: string) => Promise<void>;
  readonly currentClassify: TransactionRow | undefined;
  readonly clearClassify: () => void;
  readonly onClassifySaved: () => void;
  readonly detectOpen: boolean;
  readonly detectProposals: readonly TransferPairProposal[];
  readonly detectSummary: DetectTransfersSummary | null;
  readonly accountNames: Record<string, string>;
  readonly closeDetect: () => void;
  readonly onDetectLinked: () => void;
};

export function useTransactionsPageController(): TransactionsPageViewProps {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const { transactionFilters, clearTransactionFilters } = useAppNavigation();
  const [urlState, setUrlState] = useTableUrlState('transactions', {
    f: { d: 'this-month' },
    o: [{ id: 'date', desc: true }],
    p: 1,
    ps: DEFAULT_TRANSACTION_PAGE_SIZE,
  });
  const {
    ui,
    patchSelected,
    selectAllVisible,
    selectNone,
    openDetail,
    closeDetail,
    advanceDetailEdit,
    openDetect,
    closeDetect,
    setSidebarOpen,
    clearClassify,
    advanceClassify,
  } = useTransactionsPageUiState();
  const selectionAnchorIndexRef = useRef<number | null>(null);
  const displayOrderedIdsRef = useRef<readonly string[]>([]);

  const visibleColumns = useMemo(() => {
    const stored = urlState.c;
    if (!stored || stored.length === 0) {
      return new Set<TransactionColumnKey>(TRANSACTION_COLUMN_KEYS);
    }
    return new Set(stored as TransactionColumnKey[]);
  }, [urlState.c]);

  useEffect(() => {
    if (Object.keys(transactionFilters).length === 0) {
      return;
    }
    setUrlState((prev) => {
      const displayDate = transactionFilters['display.date'];
      const { 'display.date': _displayDate, ...rest } = transactionFilters;
      const nextFilters = { ...prev.f, ...rest };
      if (transactionFilters['start-date'] || transactionFilters['end-date']) {
        nextFilters['d'] = 'custom';
      } else if (transactionFilters['d'] && transactionFilters['d'] !== 'custom') {
        delete nextFilters['start-date'];
        delete nextFilters['end-date'];
      }
      return {
        ...prev,
        f: nextFilters,
        display:
          typeof displayDate === 'string' && displayDate === 'credit-purchase'
            ? { ...prev.display, date: 'credit-purchase' }
            : prev.display,
        p: 1,
      };
    });
    clearTransactionFilters();
  }, [transactionFilters, clearTransactionFilters, setUrlState]);

  const categoryColumnDisplay = resolveColumnBadgeDisplay(urlState.display?.category);
  const labelsColumnDisplay = resolveColumnBadgeDisplay(urlState.display?.labels);
  const groupBy = useMemo(() => resolveTransactionGroupBy(urlState.g), [urlState.g]);
  const effectiveVisibleColumns = useMemo(
    () => resolveEffectiveTransactionVisibleColumns(visibleColumns, groupBy),
    [groupBy, visibleColumns],
  );

  const updateColumnDisplay = (
    patch: Partial<NonNullable<typeof urlState.display>> & {
      readonly date?: 'credit-purchase' | undefined;
    },
  ): void => {
    setUrlState((prev) => {
      const nextDisplay = { ...prev.display, ...patch };
      if ('date' in patch && patch.date === undefined) {
        delete nextDisplay.date;
      }
      return { ...prev, display: nextDisplay, p: 1 };
    });
  };

  const handleChartStateChange = useCallback(
    (patch: Partial<TransactionChartsState>) => patchTransactionChartState(setUrlState, patch),
    [setUrlState],
  );

  const filters = urlState.f;
  const displayDate = urlState.display?.date;
  const queryString = useMemo(() => {
    const base = buildTransactionListQuery(urlState);
    const params = new URLSearchParams(base);
    params.set('locale', i18n.language);
    return params.toString();
  }, [i18n.language, urlState]);
  const chartQueryString = useMemo(() => buildTransactionChartQuery(urlState), [urlState]);

  const sorting = useMemo<SortingState>(() => {
    const spec = urlState.o?.[0];
    if (!spec) {
      return [{ id: 'date', desc: true }];
    }
    return [{ id: spec.id, desc: Boolean(spec.desc) }];
  }, [urlState.o]);

  const handleSortingChange: OnChangeFn<SortingState> = useCallback(
    (updater) => {
      setUrlState((prev) => {
        const current: SortingState = prev.o?.[0]
          ? [{ id: prev.o[0].id, desc: Boolean(prev.o[0].desc) }]
          : [{ id: 'date', desc: true }];
        const next = typeof updater === 'function' ? updater(current) : updater;
        const first = next[0];
        const fallbackSort = [{ id: 'date', desc: true }] as const;
        return {
          ...prev,
          p: 1,
          o: first ? [{ id: first.id, desc: Boolean(first.desc) }] : [...fallbackSort],
        };
      });
    },
    [setUrlState],
  );

  const setPage = useCallback(
    (page: number): void => {
      setUrlState((prev) => ({ ...prev, p: page }));
      patchSelected(() => []);
      selectionAnchorIndexRef.current = null;
    },
    [patchSelected, setUrlState],
  );

  const { data: accountsData } = useQuery({
    queryKey: ['accounts'],
    queryFn: () => apiJson<{ rows: Record<string, unknown>[] }>('/api/accounts'),
  });

  const { data: billsData } = useQuery({
    queryKey: ['credit-card-bills'],
    queryFn: () => apiJson<{ rows: Record<string, unknown>[] }>('/api/credit-card-bills'),
  });

  const { data: categoriesData } = useQuery({
    queryKey: ['categories', i18n.language],
    queryFn: () =>
      apiJson<{ byId: Record<string, Record<string, unknown>> }>(
        withLocaleQuery('/api/categories', i18n.language),
      ),
  });

  const { data: labelsData } = useQuery({
    queryKey: ['annotation-labels'],
    queryFn: () => apiJson<{ byId: Record<string, LabelRecord> }>('/api/annotation-labels'),
  });

  const labelById = labelsData?.byId ?? EMPTY_LABEL_BY_ID;
  const categoryById = categoriesData?.byId ?? EMPTY_CATEGORY_BY_ID;

  const filterSummaryParts = useMemo(() => {
    const filterParts = buildTransactionFilterSummary(
      filters,
      {
        accounts: accountsData?.rows ?? EMPTY_ACCOUNT_ROWS,
        bills: billsData?.rows ?? [],
        categoryById,
        labelById,
        locale: i18n.language,
        t,
      },
      { displayDate },
    );
    return [...filterParts, ...buildTransactionGroupSummaryParts(groupBy, t)];
  }, [
    accountsData?.rows,
    billsData?.rows,
    categoryById,
    displayDate,
    filters,
    groupBy,
    i18n.language,
    labelById,
    t,
  ]);

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['transactions', queryString],
    queryFn: () => apiJson<TransactionListResponse>(`/api/transactions?${queryString}`),
  });

  const lastListErrorKeyRef = useRef<string | null>(null);
  useEffect(() => {
    if (!isError || !error) {
      return;
    }
    const message = error instanceof Error ? error.message : String(error);
    const errorKey = `${queryString}:${message}`;
    if (lastListErrorKeyRef.current === errorKey) {
      return;
    }
    lastListErrorKeyRef.current = errorKey;
    toast.error(t('toast.error'), { description: message, duration: Infinity });
  }, [error, isError, queryString, t]);

  const [detectPending, setDetectPending] = useState(false);
  const [exportPending, setExportPending] = useState(false);
  const [currentRowId, setCurrentRowIdState] = useState<string | null>(null);
  const scopedQueryString = useMemo(() => buildTransactionScopedQuery(urlState), [urlState]);

  const runDetectTransfers = useCallback(async (): Promise<void> => {
    setDetectPending(true);
    try {
      const result = await apiJson<{
        proposals: TransferPairProposal[];
        summary: DetectTransfersSummary;
      }>(
        `/api/transfers/detect?${buildTransactionChartQuery({
          f: filters,
          display: { date: displayDate },
        })}`,
        {
          method: 'POST',
        },
      );
      openDetect(result.proposals, result.summary);
    } catch (error) {
      toast.error(t('toast.error'), {
        description: error instanceof Error ? error.message : String(error),
        duration: Infinity,
      });
    } finally {
      setDetectPending(false);
    }
  }, [displayDate, filters, openDetect, t]);

  const accountNames = useMemo(() => {
    const names: Record<string, string> = {};
    for (const account of accountsData?.rows ?? []) {
      const id = String(account['id'] ?? '');
      if (!id) {
        continue;
      }
      names[id] = String(account['display_name'] ?? account['name'] ?? id);
    }
    return names;
  }, [accountsData?.rows]);

  const rawRows = data?.rows ?? EMPTY_TRANSACTION_ROWS;
  const rowGrouping = useMemo(
    () =>
      buildTransactionRowGrouping({
        rows: rawRows,
        groupBy,
        accounts: accountsData?.rows ?? EMPTY_ACCOUNT_ROWS,
        locale: i18n.language,
        t,
      }),
    [accountsData?.rows, groupBy, i18n.language, rawRows, t],
  );
  const rows = rowGrouping.rows;
  useEffect(() => {
    displayOrderedIdsRef.current = rows.map((row) => row.id);
  }, [rows]);
  const selectedIdSet = useMemo(() => new Set(ui.selected), [ui.selected]);

  const handleRowSelectionChange = useCallback(
    (rowId: string, checked: boolean, shiftKey: boolean): void => {
      patchSelected((currentSelected) => {
        const result = applyShiftRangeSelection({
          orderedIds: displayOrderedIdsRef.current,
          targetId: rowId,
          checked,
          shiftKey,
          selected: currentSelected,
          anchorIndex: selectionAnchorIndexRef.current,
        });
        selectionAnchorIndexRef.current = result.anchorIndex;
        return result.selected;
      });
    },
    [patchSelected],
  );

  const columns = useMemo(
    () =>
      buildTransactionTableColumns({
        filters,
        selected: ui.selected,
        visibleColumns: effectiveVisibleColumns,
        categoryColumnDisplay,
        labelsColumnDisplay,
        handleRowSelectionChange,
        t,
        locale: i18n.language,
        usePurchaseDate: displayDate === 'credit-purchase',
      }),
    [
      categoryColumnDisplay,
      displayDate,
      effectiveVisibleColumns,
      filters,
      handleRowSelectionChange,
      i18n.language,
      labelsColumnDisplay,
      ui.selected,
      t,
    ],
  );

  const currentClassify = ui.classifyQueue[ui.classifyIndex];
  const visibleRowIds = useMemo(() => rows.map((row) => row.id), [rows]);
  const currentRow = useMemo(() => {
    if (!currentRowId) {
      return rows[0] ?? null;
    }
    return rows.find((row) => row.id === currentRowId) ?? rows[0] ?? null;
  }, [currentRowId, rows]);
  const resolvedCurrentRowId = currentRow?.id ?? null;

  const unclassifiedVisibleIds = useMemo(() => {
    const ids: string[] = [];
    for (const row of rows) {
      if (isUnclassifiedTransaction(row)) {
        ids.push(row.id);
      }
    }
    return ids;
  }, [rows]);
  const selectedRows = useMemo(
    () => rows.filter((row) => selectedIdSet.has(row.id)),
    [rows, selectedIdSet],
  );

  const resetSelectionAnchor = (): void => {
    selectionAnchorIndexRef.current = null;
  };

  const handleSelectAllVisible = (): void => {
    selectAllVisible(visibleRowIds);
    resetSelectionAnchor();
  };

  const handleSelectNone = (): void => {
    selectNone();
    resetSelectionAnchor();
  };

  const handleSelectUnclassifiedVisible = (): void => {
    selectAllVisible(unclassifiedVisibleIds);
    resetSelectionAnchor();
  };

  const handleSelectGroupRows = useCallback(
    (rowIds: readonly string[], checked: boolean): void => {
      patchSelected((currentSelected) => {
        const next = new Set(currentSelected);
        if (checked) {
          for (const rowId of rowIds) {
            next.add(rowId);
          }
        } else {
          for (const rowId of rowIds) {
            next.delete(rowId);
          }
        }
        return [...next];
      });
      selectionAnchorIndexRef.current = null;
    },
    [patchSelected],
  );

  const openDetailEditor = useCallback(
    (row: TransactionRow): void => {
      setCurrentRowIdState(row.id);
      if (selectedIdSet.has(row.id) && ui.selected.length > 1) {
        const ids: string[] = [];
        for (const item of rows) {
          if (selectedIdSet.has(item.id)) {
            ids.push(item.id);
          }
        }
        openDetail(row, ids, Math.max(0, ids.indexOf(row.id)));
      } else {
        openDetail(row, [row.id], 0);
      }
    },
    [openDetail, rows, selectedIdSet, ui.selected.length],
  );

  const openCurrentRow = useCallback((): void => {
    if (currentRow) {
      openDetailEditor(currentRow);
    }
  }, [currentRow, openDetailEditor]);

  const toggleCurrentRowSelection = useCallback((): void => {
    if (!currentRow) {
      return;
    }
    handleRowSelectionChange(currentRow.id, !selectedIdSet.has(currentRow.id), false);
  }, [currentRow, handleRowSelectionChange, selectedIdSet]);

  const moveCurrentRow = useCallback(
    (direction: 'previous' | 'next'): void => {
      if (rows.length === 0) {
        return;
      }
      const currentIndex = currentRow
        ? Math.max(
            0,
            rows.findIndex((row) => row.id === currentRow.id),
          )
        : 0;
      const delta = direction === 'previous' ? -1 : 1;
      const nextIndex = Math.min(rows.length - 1, Math.max(0, currentIndex + delta));
      setCurrentRowIdState(rows[nextIndex]?.id ?? null);
    },
    [currentRow, rows],
  );

  const openEditSelected = useCallback((): void => {
    const first = selectedRows[0];
    if (!first) {
      return;
    }
    openDetail(
      first,
      selectedRows.map((row) => row.id),
      0,
    );
  }, [openDetail, selectedRows]);

  const openTransactionById = useCallback(
    async (transactionId: string): Promise<void> => {
      const cached = data?.rows?.find((row) => row.id === transactionId);
      if (cached) {
        openDetail(cached, [transactionId], 0);
        return;
      }

      const response = await apiJson<{ transaction: TransactionRow }>(
        withLocaleQuery(`/api/transactions/${transactionId}`, i18n.language),
      );
      openDetail(response.transaction, [transactionId], 0);
    },
    [data?.rows, i18n.language, openDetail],
  );

  const handleDetailSaved = useCallback(async () => {
    await invalidateTransactionQueries(queryClient);
    const fresh = await queryClient.fetchQuery({
      queryKey: ['transactions', queryString],
      queryFn: () => apiJson<TransactionListResponse>(`/api/transactions?${queryString}`),
    });

    const nextIndex = ui.detailEditIndex + 1;
    if (nextIndex < ui.detailEditIds.length) {
      const nextId = ui.detailEditIds[nextIndex];
      const nextRow = fresh.rows.find((row) => row.id === nextId);
      if (nextRow) {
        advanceDetailEdit(nextRow, ui.detailEditIds, nextIndex);
        return;
      }
    }
    closeDetail();
  }, [
    advanceDetailEdit,
    closeDetail,
    queryClient,
    queryString,
    ui.detailEditIds,
    ui.detailEditIndex,
  ]);

  const updateFilters = (patch: Record<string, string | undefined>): void => {
    setUrlState({ ...urlState, f: mergeTransactionFilterPatch(filters, patch), p: 1 });
  };

  const clearFilterPart = useCallback(
    (partId: string): void => {
      setUrlState((prev) => {
        const groupByField = parseTransactionGroupSummaryPartId(partId);
        if (groupByField) {
          const nextGroupBy = resolveTransactionGroupBy(prev.g).filter(
            (field) => field !== groupByField,
          );
          return { ...prev, g: nextGroupBy.length > 0 ? nextGroupBy : undefined };
        }
        if (partId === 'display-date') {
          const nextDisplay = { ...prev.display };
          delete nextDisplay.date;
          return { ...prev, display: nextDisplay, p: 1 };
        }
        return {
          ...prev,
          f: mergeTransactionFilterPatch(prev.f, clearTransactionFilterPart(partId)),
          p: 1,
        };
      });
    },
    [setUrlState],
  );

  const updateFilter = (key: string, value: string): void => {
    updateFilters({ [key]: value || undefined });
  };

  const toggleGroupBy = (field: TransactionGroupByField, checked: boolean): void => {
    setUrlState((prev) => {
      const current = resolveTransactionGroupBy(prev.g);
      const next = checked ? [...current, field] : current.filter((value) => value !== field);
      return { ...prev, g: next.length > 0 ? next : undefined };
    });
  };

  const toggleColumn = (key: TransactionColumnKey, checked: boolean): void => {
    const next = new Set(visibleColumns);
    if (checked) {
      next.add(key);
    } else if (next.size > 1) {
      next.delete(key);
    }
    setUrlState({ ...urlState, c: [...next] });
  };

  const onClassifySaved = useCallback(() => {
    void invalidateTransactionQueries(queryClient);
    if (ui.classifyIndex + 1 < ui.classifyQueue.length) {
      advanceClassify();
    } else {
      clearClassify();
    }
  }, [advanceClassify, clearClassify, queryClient, ui.classifyIndex, ui.classifyQueue.length]);

  const onDetectLinked = useCallback(() => {
    void invalidateTransactionQueries(queryClient);
  }, [queryClient]);

  const exportFilteredRows = useCallback(
    async (kind: 'csv' | 'json'): Promise<void> => {
      setExportPending(true);
      try {
        const exportedRows = await fetchAllFilteredTransactionRows<Record<string, unknown>>({
          filterQuery: scopedQueryString,
          locale: i18n.language,
        });
        if (kind === 'json') {
          downloadJson('transactions.json', exportedRows);
          return;
        }
        downloadCsv('transactions.csv', exportedRows);
      } catch (error) {
        toast.error(t('toast.error'), {
          description: error instanceof Error ? error.message : String(error),
          duration: Infinity,
        });
      } finally {
        setExportPending(false);
      }
    },
    [i18n.language, scopedQueryString, t],
  );

  return {
    t,
    locale: i18n.language,
    data,
    isLoading,
    isError,
    listError: error instanceof Error ? error : isError ? new Error(String(error)) : null,
    uiSidebarOpen: ui.sidebarOpen,
    setSidebarOpen,
    filterSummaryParts,
    labelById,
    categoryById,
    clearFilterPart,
    chartQueryString,
    chartState: urlState.charts ?? {},
    handleChartStateChange,
    rows,
    rowGroups: rowGrouping.groups,
    selectedIds: ui.selected,
    selectedCount: ui.selected.length,
    currentRowId: resolvedCurrentRowId,
    unclassifiedVisibleCount: unclassifiedVisibleIds.length,
    handleSelectAllVisible,
    handleSelectNone,
    handleSelectUnclassifiedVisible,
    handleSelectGroupRows,
    toggleCurrentRowSelection,
    openEditSelected,
    openCurrentRow,
    moveCurrentRow,
    columns,
    openDetailEditor,
    sorting,
    handleSortingChange,
    setPage,
    filters,
    accounts: accountsData?.rows ?? EMPTY_ACCOUNT_ROWS,
    bills: billsData?.rows ?? [],
    displayDate: urlState.display?.date,
    groupBy,
    toggleGroupBy,
    updateFilter,
    updateFilters,
    visibleColumns,
    toggleColumn,
    categoryColumnDisplay,
    labelsColumnDisplay,
    updateColumnDisplay,
    matchingTotal: data?.total ?? 0,
    detectPending,
    exportPending,
    onDetectTransfers: () => runDetectTransfers(),
    onExportJson: () => {
      void exportFilteredRows('json');
    },
    onExportCsv: () => {
      void exportFilteredRows('csv');
    },
    detailTransaction: ui.detailTransaction,
    detailEditIds: ui.detailEditIds,
    closeDetail,
    handleDetailSaved,
    openTransactionById,
    currentClassify,
    clearClassify,
    onClassifySaved,
    detectOpen: ui.detectOpen,
    detectProposals: ui.detectProposals,
    detectSummary: ui.detectSummary,
    accountNames,
    closeDetect,
    onDetectLinked,
  };
}

function buildTransactionGroupSummaryParts(
  groupBy: readonly TransactionGroupByField[],
  t: ReturnType<typeof useTranslation>['t'],
): readonly TransactionFilterSummaryPart[] {
  return groupBy.map((field) => ({
    id: `${TRANSACTION_GROUP_SUMMARY_PREFIX}${field}`,
    label: t('filters.groupRows'),
    value: t(resolveTransactionGroupByLabelKey(field)),
  }));
}

function parseTransactionGroupSummaryPartId(partId: string): TransactionGroupByField | null {
  if (!partId.startsWith(TRANSACTION_GROUP_SUMMARY_PREFIX)) {
    return null;
  }
  const field = partId.slice(TRANSACTION_GROUP_SUMMARY_PREFIX.length);
  return resolveTransactionGroupBy([field])[0] ?? null;
}

function resolveEffectiveTransactionVisibleColumns(
  visibleColumns: ReadonlySet<TransactionColumnKey>,
  groupBy: readonly TransactionGroupByField[],
): Set<TransactionColumnKey> {
  const effective = new Set(visibleColumns);
  for (const field of groupBy) {
    const column = resolveGroupedTransactionColumnKey(field);
    if (column) {
      effective.delete(column);
    }
  }
  if (effective.size === 0) {
    effective.add('select');
  }
  return effective;
}

function resolveGroupedTransactionColumnKey(
  field: TransactionGroupByField,
): TransactionColumnKey | null {
  switch (field) {
    case 'date':
      return 'date';
    case 'account':
      return 'account';
    case 'category':
      return 'category';
    case 'label':
      return 'labels';
    case 'merchant':
      return 'merchant';
    case 'connection':
      return null;
  }
}
