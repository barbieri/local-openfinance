import { confidenceColor, resolveConfidencePercent } from '../utils/confidence.js';
import { getNumberFormat } from '../utils/intl-formatters.js';
import { localText } from '../utils/locale-text.js';
import { escapeHtml } from './email.js';
import type {
  ResolvedSuggestionDigestRow,
  SuggestionDigestProjection,
} from './sync-suggestion-digest-projection.js';

type LabeledText = {
  readonly text: string;
  readonly color: string;
};

function formatMoney(amountCents: number, currency: string, language: string): string {
  return getNumberFormat(language, {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amountCents / 100);
}

function formatDateForRow(date: string, language: string): string {
  return new Intl.DateTimeFormat(language, {
    day: '2-digit',
    month: '2-digit',
    timeZone: 'UTC',
  }).format(new Date(`${date}T12:00:00.000Z`));
}

function buildDigestLink(publicBaseUrl: string | undefined, hash: string): string {
  return publicBaseUrl ? `${publicBaseUrl.replace(/\/+$/u, '')}${hash}` : hash;
}

function formatLabeledText(value: LabeledText): string {
  return `<span style="color:${escapeHtml(value.color)}">${escapeHtml(value.text)}</span>`;
}

function joinOrEmpty(values: readonly LabeledText[], empty = '—'): string {
  return values.length > 0 ? values.map(formatLabeledText).join(' • ') : empty;
}

export function renderSuggestionDigestHtml(
  digestRows: SuggestionDigestProjection,
  language: string,
): string {
  const triageLink = buildDigestLink(digestRows.publicBaseUrl, '/#/triage');
  const renderRows = (rows: readonly ResolvedSuggestionDigestRow[]) =>
    rows
      .map(
        (row) => `<tr>
  <td><a href="${escapeHtml(buildDigestLink(digestRows.publicBaseUrl, `/#/transaction/${row.entryId}`))}">${escapeHtml(formatDateForRow(row.date, language))}</a></td>
  <td>${escapeHtml(formatMoney(row.amount.cents, row.amount.currency, language))}</td>
  <td>${escapeHtml(row.description)}</td>
  <td>${formatLabeledText(row.originalCategory)}</td>
  <td>${formatLabeledText(row.newCategory)}</td>
  <td>${joinOrEmpty(row.originalLabels)}</td>
  <td>${joinOrEmpty(row.newLabels)}</td>
  <td style="color: ${confidenceColor(row.score)}; font-weight: 600">${escapeHtml(formatScore(row.score))}</td>
</tr>`,
      )
      .join('\n');
  const table = (
    title: string,
    rows: readonly ResolvedSuggestionDigestRow[],
  ) => `<h2>${title}</h2><table>
  <thead><tr><th>${localText(language, 'syncSuggestionDigest.column.date')}</th><th>${localText(language, 'syncSuggestionDigest.column.amount')}</th><th>${localText(language, 'syncSuggestionDigest.column.description')}</th><th>${localText(language, 'syncSuggestionDigest.column.originalCategory')}</th><th>${localText(language, 'syncSuggestionDigest.column.newCategory')}</th><th>${localText(language, 'syncSuggestionDigest.column.originalLabels')}</th><th>${localText(language, 'syncSuggestionDigest.column.newLabels')}</th><th>${localText(language, 'syncSuggestionDigest.column.score')}</th></tr></thead>
  <tbody>${renderRows(rows)}</tbody></table>`;
  return `<style>table{border-collapse:collapse;width:100%;border:1px solid #cbd5e1}th{background:#fff;color:#0f172a;text-align:left;padding:10px;border-bottom:1px solid #e2e8f0}td{border-top:1px solid #e2e8f0;padding:10px;vertical-align:top}h2{color:#0f172a;margin:20px 0 8px}.empty{color:#64748b}</style>
<h1 style="color:#0f172a">${localText(language, 'syncSuggestionDigest.title')}</h1>
<p style="color:#64748b">${localText(language, 'syncSuggestionDigest.intro')}</p>
${table(localText(language, 'syncSuggestionDigest.newHeading'), digestRows.newRows)}
${digestRows.previousRows.length > 0 ? table(localText(language, 'syncSuggestionDigest.previousHeading'), digestRows.previousRows) : ''}
<p style="margin-top:20px"><a href="${escapeHtml(triageLink)}">${localText(language, 'syncSuggestionDigest.openTriage')}</a></p>`;
}

export function buildSuggestionDigestText(
  digestRows: SuggestionDigestProjection,
  language: string,
): string {
  const header = `| ${localText(language, 'syncSuggestionDigest.column.date')} | ${localText(language, 'syncSuggestionDigest.column.amount')} | ${localText(language, 'syncSuggestionDigest.column.description')} | ${localText(language, 'syncSuggestionDigest.column.originalCategory')} | ${localText(language, 'syncSuggestionDigest.column.newCategory')} | ${localText(language, 'syncSuggestionDigest.column.originalLabels')} | ${localText(language, 'syncSuggestionDigest.column.newLabels')} | ${localText(language, 'syncSuggestionDigest.column.score')} |\n| --- | --- | --- | --- | --- | --- | --- | --- |`;
  const rows = (items: readonly ResolvedSuggestionDigestRow[]) =>
    items.map(
      (row) =>
        `| ${markdownCell(formatDateForLink(row.date, digestRows.publicBaseUrl, row.entryId, language))} | ${markdownCell(formatMoney(row.amount.cents, row.amount.currency, language))} | ${markdownCell(row.description)} | ${markdownCell(row.originalCategory.text)} | ${markdownCell(row.newCategory.text)} | ${markdownCell(joinOrEmptyText(row.originalLabels))} | ${markdownCell(joinOrEmptyText(row.newLabels))} | ${markdownCell(formatScore(row.score))} |`,
    );
  return `${localText(language, 'syncSuggestionDigest.textTitle')}\n\n${localText(language, 'syncSuggestionDigest.newHeading')}\n${header}\n${rows(digestRows.newRows).join('\n')}\n\n${localText(language, 'syncSuggestionDigest.previousHeading')}\n${header}\n${rows(digestRows.previousRows).join('\n')}\n\n${localText(language, 'syncSuggestionDigest.quickAccess')}: ${triageLink(digestRows.publicBaseUrl)}\n`;
}

function joinOrEmptyText(values: readonly LabeledText[], empty = '—'): string {
  return values.length > 0 ? values.map((value) => value.text).join(' • ') : empty;
}

function formatDateForLink(
  date: string,
  publicBaseUrl: string | undefined,
  entryId: string,
  language: string,
): string {
  const href = buildDigestLink(publicBaseUrl, `/#/transaction/${entryId}`);
  return `[${formatDateForRow(date, language)}](${href})`;
}

function triageLink(publicBaseUrl: string | undefined): string {
  return buildDigestLink(publicBaseUrl, '/#/triage');
}

function markdownCell(value: string): string {
  return value.replaceAll('|', '\\|').replaceAll(/\r?\n/gu, ' ');
}

function formatScore(score: number | null): string {
  return score === null ? '—' : `${resolveConfidencePercent(score)}%`;
}
