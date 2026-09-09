import { confidenceColor, resolveConfidencePercent } from '../utils/confidence.js';
import { getNumberFormat } from '../utils/intl-formatters.js';
import { escapeHtml } from './email.js';
import type {
  ResolvedSuggestionDigestRow,
  SuggestionDigestProjection,
} from './sync-suggestion-digest-projection.js';

type LabeledText = {
  readonly text: string;
  readonly color: string;
};

function formatMoney(amountCents: number, currency: string): string {
  return getNumberFormat('pt-BR', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amountCents / 100);
}

function formatDateForRow(date: string): string {
  const parsed = new Date(`${date}T12:00:00.000Z`);
  return `${String(parsed.getUTCDate()).padStart(2, '0')}/${String(parsed.getUTCMonth() + 1).padStart(2, '0')}`;
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

export function renderSuggestionDigestHtml(digestRows: SuggestionDigestProjection): string {
  const triageLink = buildDigestLink(digestRows.publicBaseUrl, '/#/triage');
  const renderRows = (rows: readonly ResolvedSuggestionDigestRow[]) =>
    rows
      .map(
        (row) => `<tr>
  <td><a href="${escapeHtml(buildDigestLink(digestRows.publicBaseUrl, `/#/transaction/${row.entryId}`))}">${escapeHtml(formatDateForRow(row.date))}</a></td>
  <td>${escapeHtml(formatMoney(row.amount.cents, row.amount.currency))}</td>
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
  <thead><tr><th>Data</th><th>Valor</th><th>Descrição</th><th>Categoria original</th><th>Nova categoria</th><th>Etiquetas originais</th><th>Novas etiquetas</th><th>Score</th></tr></thead>
  <tbody>${renderRows(rows)}</tbody></table>`;
  return `<style>table{border-collapse:collapse;width:100%;border:1px solid #cbd5e1}th{background:#fff;color:#0f172a;text-align:left;padding:10px;border-bottom:1px solid #e2e8f0}td{border-top:1px solid #e2e8f0;padding:10px;vertical-align:top}h2{color:#0f172a;margin:20px 0 8px}.empty{color:#64748b}</style>
<h1 style="color:#0f172a">Sugestões de classificação geradas no sync</h1>
<p style="color:#64748b">Novas sugestões desta rodada e sugestões pendentes anteriores.</p>
${table('Novas sugestões desta rodada', digestRows.newRows)}
${digestRows.previousRows.length > 0 ? table('Sugestões pendentes anteriores', digestRows.previousRows) : ''}
<p style="margin-top:20px"><a href="${escapeHtml(triageLink)}">Abrir triagem</a></p>`;
}

export function buildSuggestionDigestText(digestRows: SuggestionDigestProjection): string {
  const header =
    '| Data | Valor | Descrição | Categoria original | Nova categoria | Etiquetas originais | Novas etiquetas | Score |\n| --- | --- | --- | --- | --- | --- | --- | --- |';
  const rows = (items: readonly ResolvedSuggestionDigestRow[]) =>
    items.map(
      (row) =>
        `| ${markdownCell(formatDateForLink(row.date, digestRows.publicBaseUrl, row.entryId))} | ${markdownCell(formatMoney(row.amount.cents, row.amount.currency))} | ${markdownCell(row.description)} | ${markdownCell(row.originalCategory.text)} | ${markdownCell(row.newCategory.text)} | ${markdownCell(joinOrEmptyText(row.originalLabels))} | ${markdownCell(joinOrEmptyText(row.newLabels))} | ${markdownCell(formatScore(row.score))} |`,
    );
  return `Digest de sugestões de classificação\n\nNovas sugestões desta rodada\n${header}\n${rows(digestRows.newRows).join('\n')}\n\nSugestões pendentes anteriores\n${header}\n${rows(digestRows.previousRows).join('\n')}\n\nAcesso rápido: ${triageLink(digestRows.publicBaseUrl)}\n`;
}

function joinOrEmptyText(values: readonly LabeledText[], empty = '—'): string {
  return values.length > 0 ? values.map((value) => value.text).join(' • ') : empty;
}

function formatDateForLink(
  date: string,
  publicBaseUrl: string | undefined,
  entryId: string,
): string {
  const href = buildDigestLink(publicBaseUrl, `/#/transaction/${entryId}`);
  return `[${formatDateForRow(date)}](${href})`;
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
