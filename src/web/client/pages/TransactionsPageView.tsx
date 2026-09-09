import { useEffect, useMemo, useRef, useState } from 'react';
import { TransactionCharts } from '../components/charts/TransactionCharts.js';
import { DataTable } from '../components/data-table/DataTable.js';
import { TransactionGroupHeader } from '../components/transactions/TransactionGroupHeader.js';
import { TransactionMatchSummary } from '../components/transactions/TransactionMatchSummary.js';
import { TransactionPageDialogs } from '../components/transactions/TransactionPageDialogs.js';
import { TransactionShortcutsDialog } from '../components/transactions/TransactionShortcutsDialog.js';
import {
  TransactionSidebar,
  TransactionSidebarToggle,
} from '../components/transactions/TransactionSidebar.js';
import { TransactionsSelectionToolbar } from '../components/transactions/TransactionsSelectionToolbar.js';
import { Pagination } from '../components/ui/Pagination.js';
import {
  focusTransactionSearch,
  useTransactionPageShortcuts,
} from './use-transaction-page-shortcuts.js';
import type { TransactionsPageViewProps } from './use-transactions-page-controller.js';

export function TransactionsPageView({
  t,
  locale,
  data,
  isLoading,
  isError,
  listError,
  uiSidebarOpen,
  setSidebarOpen,
  filterSummaryParts,
  labelById,
  categoryById,
  clearFilterPart,
  chartQueryString,
  chartState,
  handleChartStateChange,
  rows,
  rowGroups,
  selectedIds,
  selectedCount,
  currentRowId,
  unclassifiedVisibleCount,
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
  accounts,
  bills,
  displayDate,
  groupBy,
  toggleGroupBy,
  updateFilter,
  updateFilters,
  visibleColumns,
  toggleColumn,
  categoryColumnDisplay,
  labelsColumnDisplay,
  updateColumnDisplay,
  matchingTotal,
  detectPending,
  exportPending,
  onDetectTransfers,
  onExportJson,
  onExportCsv,
  detailTransaction,
  detailEditIds,
  closeDetail,
  handleDetailSaved,
  openTransactionById,
  currentClassify,
  clearClassify,
  onClassifySaved,
  detectOpen,
  detectProposals,
  detectSummary,
  accountNames,
  closeDetect,
  onDetectLinked,
}: TransactionsPageViewProps) {
  const searchInputRef = useRef<HTMLInputElement>(null);
  const focusSearchRequestedRef = useRef(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const selectedIdSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const dialogOpen = Boolean(detailTransaction || currentClassify || detectOpen);

  useEffect(() => {
    if (!focusSearchRequestedRef.current || !uiSidebarOpen) {
      return;
    }
    focusSearchRequestedRef.current = false;
    focusTransactionSearch(searchInputRef.current);
  }, [uiSidebarOpen]);

  useEffect(() => {
    if (!currentRowId) {
      return;
    }
    document
      .querySelector(`[data-row-id="${CSS.escape(currentRowId)}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [currentRowId]);

  useTransactionPageShortcuts({
    dialogOpen,
    shortcutsOpen,
    setShortcutsOpen,
    uiSidebarOpen,
    setSidebarOpen,
    searchInputRef,
    focusSearchRequestedRef,
    openEditSelected,
    selectedCount,
    rowCount: rows.length,
    handleSelectNone,
    handleSelectAllVisible,
    handleSelectUnclassifiedVisible,
    toggleCurrentRowSelection,
    moveCurrentRow,
    openCurrentRow,
  });

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        {data && data.total > 0 ? (
          <TransactionMatchSummary
            total={data.total}
            filters={filters}
            filterSummaryParts={filterSummaryParts}
            t={t}
            locale={locale}
          />
        ) : (
          <span />
        )}
        <TransactionSidebarToggle
          open={uiSidebarOpen}
          onOpenChange={setSidebarOpen}
          filterSummaryParts={filterSummaryParts}
          labelById={labelById}
          categoryById={categoryById}
          accounts={accounts}
          onClearFilterPart={clearFilterPart}
        />
      </div>

      {!isLoading && (data?.total ?? 0) > 0 && (
        <TransactionCharts
          chartQueryString={chartQueryString}
          chartState={chartState}
          matchingTotal={data?.total}
          tableFilters={filters}
          onChartStateChange={handleChartStateChange}
          categoryById={categoryById}
          labelById={labelById}
        />
      )}

      {!isLoading && (
        <TransactionsSelectionToolbar
          rowCount={rows.length}
          selectedCount={selectedCount}
          unclassifiedCount={unclassifiedVisibleCount}
          onSelectAll={handleSelectAllVisible}
          onSelectNone={handleSelectNone}
          onSelectUnclassified={handleSelectUnclassifiedVisible}
          onEditSelected={openEditSelected}
        />
      )}

      {isError ? (
        <p className="text-sm text-destructive">{listError?.message ?? t('toast.error')}</p>
      ) : isLoading ? (
        <p>…</p>
      ) : (
        <DataTable
          columns={columns}
          data={rows}
          rowGroups={rowGroups}
          renderRowGroupHeader={(group) => (
            <TransactionGroupHeader
              group={group}
              rows={rows}
              selectedIds={selectedIds}
              onSelectRows={handleSelectGroupRows}
            />
          )}
          onRowClick={(row) => openDetailEditor(row)}
          getRowDataId={(row) => row.id}
          getRowClassName={(row) =>
            [
              selectedIdSet.has(row.id) ? 'bg-primary/10 hover:bg-primary/15' : undefined,
              currentRowId === row.id
                ? 'outline outline-2 outline-primary/60 outline-offset-[-2px]'
                : undefined,
            ]
              .filter(Boolean)
              .join(' ')
          }
          rowClickIgnoreColumnIds={['select', 'transfer']}
          stickyColumnClassNames={{
            select: 'sticky left-0 z-20 bg-background',
            date: 'sticky left-11 z-20 bg-background',
            amount: 'sticky right-0 z-20 bg-background',
          }}
          sorting={sorting}
          onSortingChange={handleSortingChange}
          manualSorting
        />
      )}

      {data && data.pageCount > 0 && (
        <Pagination
          page={data.page}
          pageCount={data.pageCount}
          total={data.total}
          pageSize={data.limit}
          onPageChange={setPage}
        />
      )}

      <TransactionSidebar
        open={uiSidebarOpen}
        onOpenChange={setSidebarOpen}
        filters={filters}
        accounts={accounts}
        bills={bills}
        displayDate={displayDate}
        groupBy={groupBy}
        onGroupByChange={toggleGroupBy}
        categoryById={categoryById}
        labelById={labelById}
        onChange={updateFilter}
        onFiltersChange={updateFilters}
        searchInputRef={searchInputRef}
        visibleColumns={visibleColumns}
        onToggleColumn={toggleColumn}
        categoryColumnDisplay={categoryColumnDisplay}
        labelsColumnDisplay={labelsColumnDisplay}
        onColumnDisplayChange={updateColumnDisplay}
        matchingTotal={matchingTotal}
        isLoading={isLoading}
        detectPending={detectPending}
        exportPending={exportPending}
        onDetectTransfers={onDetectTransfers}
        onExportJson={onExportJson}
        onExportCsv={onExportCsv}
      />

      <TransactionPageDialogs
        detailTransaction={detailTransaction}
        detailEditIds={detailEditIds}
        onCloseDetail={closeDetail}
        onDetailSaved={handleDetailSaved}
        onOpenTransaction={openTransactionById}
        currentClassify={currentClassify}
        onCloseClassify={clearClassify}
        onClassifySaved={onClassifySaved}
        detectOpen={detectOpen}
        detectProposals={detectProposals}
        detectSummary={detectSummary}
        accountNames={accountNames}
        onCloseDetect={closeDetect}
        onDetectLinked={onDetectLinked}
      />

      <TransactionShortcutsDialog open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
    </div>
  );
}
