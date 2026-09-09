import type { DatabaseSync } from 'node:sqlite';
import {
  loadTransactionChartDataset,
  type TransactionChartDataset,
} from '../db/transaction-charts.js';
import { createTransactionWebListFilters } from '../db/transaction-query.js';
import type { ResolvedConfig, ResolvedReportConfig } from '../types.js';
import { resolveLocalTimeZone, toLocalDateKey } from '../utils/local-date.js';
import { IntelligenceToolError } from './intelligence-tool-error.js';
import { buildNetWorthSnapshot, type NetWorthSnapshot } from './net-worth.js';
import { type LocalDatePeriod, resolveReportWindowPeriod } from './period.js';
import { buildReportAnalysisPacket, type ReportAnalysis } from './report-analysis.js';
import type { ReportFact } from './report-analysis-types.js';
import {
  loadStoredReportTaxonomyPolicy,
  type ReportTaxonomyPolicy,
} from './report-taxonomy-policy.js';

export type ReportQueryScope = {
  readonly report: ResolvedReportConfig;
  readonly period: LocalDatePeriod;
  readonly timeZone: string;
};

export type ReportBriefing = {
  readonly period: LocalDatePeriod;
  readonly analysis: ReportAnalysis;
  readonly netWorth: NetWorthSnapshot;
  readonly [REPORT_BRIEFING_ACCESS]: ReportBriefingAccess;
};

export const REPORT_BRIEFING_ACCESS = Symbol('report-briefing-access');

export type ReportBriefingAccess = {
  readonly reportableFacts: readonly ReportFact[];
  readonly reportableTransactionIds: ReadonlySet<string>;
};

export function resolveReportQueryScope(
  resolved: ResolvedConfig,
  reportId: string,
  options: {
    readonly now?: Date | undefined;
    readonly timeZone?: string | undefined;
    readonly period?: LocalDatePeriod | undefined;
  } = {},
): ReportQueryScope {
  const report = resolved.config.reports.find((candidate) => candidate.id === reportId);
  if (!report) {
    throw new IntelligenceToolError('Report not found');
  }
  const timeZone = options.timeZone ?? resolveLocalTimeZone();
  const today = toLocalDateKey((options.now ?? new Date()).toISOString(), timeZone);
  return {
    report,
    period: options.period ?? resolveReportWindowPeriod(report.window, today),
    timeZone,
  };
}

export function buildReportBriefing(
  db: DatabaseSync,
  resolved: ResolvedConfig,
  scope: ReportQueryScope,
  policy?: ReportTaxonomyPolicy | undefined,
): ReportBriefing {
  const resolvedPolicy = policy ?? loadStoredReportTaxonomyPolicy(db, scope.report.id);
  if (!resolvedPolicy) {
    throw new IntelligenceToolError('Report taxonomy policy is not initialized');
  }
  const packet = buildReportAnalysisPacket({
    db,
    resolved,
    scope,
    policy: resolvedPolicy,
  });
  return {
    period: scope.period,
    analysis: packet.analysis,
    netWorth: buildNetWorthSnapshot(db, scope.report.id, scope.period, scope.report.accountIds),
    [REPORT_BRIEFING_ACCESS]: {
      reportableFacts: packet.reportableFacts,
      reportableTransactionIds: new Set(packet.reportableFacts.map((fact) => fact.id)),
    },
  };
}

export function baseReportTransactionFilters(scope: ReportQueryScope) {
  return createTransactionWebListFilters({
    accountIds: scope.report.accountIds.length > 0 ? scope.report.accountIds : 'all',
    classification: scope.report.includeUnannotated ? 'all' : 'classified',
    startDate: scope.period.start,
    endDate: scope.period.end,
    transfers: 'hide',
    useCreditPurchaseDate: true,
  });
}

export function loadReportTransactionChartDataset(
  db: DatabaseSync,
  scope: ReportQueryScope,
): TransactionChartDataset {
  return loadTransactionChartDataset(db, baseReportTransactionFilters(scope), scope.timeZone);
}
