import { useTranslation } from 'react-i18next';
import { CollapsibleSidebar } from '../../components/ui/CollapsibleSidebar.js';
import { CollapsibleSidebarToggle } from '../../components/ui/CollapsibleSidebarToggle.js';
import { SidebarSection } from '../../components/ui/SidebarSection.js';
import { InvestmentViewSummaryParts } from './InvestmentViewSummary.js';
import {
  INVESTMENT_COLUMN_KEYS,
  INVESTMENT_GROUP_BY_FIELDS,
  type InvestmentColumnKey,
  type InvestmentGroupBy,
  type InvestmentViewSummaryPart,
  investmentGroupByLabelKey,
} from './investments-page-helpers.js';

type InvestmentSidebarProps = {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly search: string;
  readonly onSearchChange: (search: string) => void;
  readonly statusFilter: string;
  readonly onStatusFilterChange: (statusFilter: string) => void;
  readonly groupBy: InvestmentGroupBy;
  readonly onGroupByChange: (groupBy: InvestmentGroupBy) => void;
  readonly singleStatusFilter: boolean;
  readonly visibleColumns: ReadonlySet<InvestmentColumnKey>;
  readonly onToggleColumn: (key: InvestmentColumnKey, checked: boolean) => void;
};

export function InvestmentSidebar({
  open,
  onOpenChange,
  search,
  onSearchChange,
  statusFilter,
  onStatusFilterChange,
  groupBy,
  onGroupByChange,
  singleStatusFilter,
  visibleColumns,
  onToggleColumn,
}: InvestmentSidebarProps) {
  const { t } = useTranslation();

  return (
    <CollapsibleSidebar
      open={open}
      onOpenChange={onOpenChange}
      title={t('sidebar.investmentsPanel')}
      closeLabel={t('sidebar.closePanel')}
    >
      <div className="space-y-3">
        <SidebarSection title={t('filters.sectionSearch')}>
          <input
            type="search"
            className="w-full rounded border border-input bg-background px-2 py-1 text-sm"
            placeholder={t('filters.searchInvestments')}
            aria-label={t('filters.searchInvestments')}
            value={search}
            onChange={(event) => onSearchChange(event.target.value)}
          />
        </SidebarSection>

        <SidebarSection title={t('filters.sectionScope')}>
          <label className="flex flex-col gap-1 text-sm">
            <span>{t('filters.status')}</span>
            <select
              className="rounded border border-input bg-background px-2 py-1 text-sm"
              value={statusFilter}
              onChange={(event) => onStatusFilterChange(event.target.value)}
            >
              <option value="ACTIVE">{t('filters.statusActive')}</option>
              <option value="all">{t('filters.statusAll')}</option>
              <option value="ACTIVE,TOTAL_WITHDRAWAL">{t('filters.statusActiveWithdrawn')}</option>
            </select>
          </label>
        </SidebarSection>

        <SidebarSection title={t('filters.groupRows')} defaultOpen={false}>
          <label className="flex flex-col gap-1 text-sm">
            <span>{t('filters.groupRows')}</span>
            <select
              className="rounded border border-input bg-background px-2 py-1 text-sm"
              value={groupBy}
              onChange={(event) => onGroupByChange(event.target.value as InvestmentGroupBy)}
            >
              {INVESTMENT_GROUP_BY_FIELDS.map((field) =>
                field === 'status' && singleStatusFilter ? null : (
                  <option key={field} value={field}>
                    {t(investmentGroupByLabelKey(field))}
                  </option>
                ),
              )}
            </select>
          </label>
        </SidebarSection>

        <SidebarSection title={t('filters.columns')} defaultOpen={false}>
          <div className="space-y-2">
            {INVESTMENT_COLUMN_KEYS.map((key) =>
              key === 'status' && singleStatusFilter ? null : (
                <label key={key} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={visibleColumns.has(key)}
                    onChange={(event) => onToggleColumn(key, event.target.checked)}
                  />
                  {t(`columns.${key}`)}
                </label>
              ),
            )}
          </div>
        </SidebarSection>
      </div>
    </CollapsibleSidebar>
  );
}

export function InvestmentSidebarToggle({
  open,
  onOpenChange,
  viewSummary,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly viewSummary: readonly InvestmentViewSummaryPart[];
}) {
  const { t } = useTranslation();

  if (open) {
    return null;
  }

  return (
    <CollapsibleSidebarToggle
      label={t('sidebar.investmentsPanel')}
      onClick={() => onOpenChange(true)}
      summary={<InvestmentViewSummaryParts parts={viewSummary} />}
    />
  );
}
