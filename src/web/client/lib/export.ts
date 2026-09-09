export function downloadJson(filename: string, data: unknown): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  triggerDownload(filename, blob);
}

export function downloadCsv(filename: string, rows: readonly Record<string, unknown>[]): void {
  if (rows.length === 0) {
    return;
  }
  const headers = collectHeaders(rows);
  const lines = [headers.join(',')];
  for (const row of rows) {
    lines.push(headers.map((h) => escapeCsv(formatCell(row, h))).join(','));
  }
  const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
  triggerDownload(filename, blob);
}

function collectHeaders(rows: readonly Record<string, unknown>[]): string[] {
  const set = new Set<string>();
  for (const row of rows) {
    for (const key of Object.keys(row)) {
      set.add(key);
      if (key.endsWith('_cents') || key === 'amount_cents' || key === 'balance_cents') {
        const base = key.replace(/_cents$/, '');
        if (base !== key) {
          set.add(`${base}_currency`);
        }
      }
    }
  }
  const headers = [...set];
  headers.sort();
  return headers;
}

function formatCell(row: Record<string, unknown>, header: string): string {
  if (header.endsWith('_currency')) {
    const base = header.replace(/_currency$/, '');
    const centsKey = `${base}_cents`;
    if (centsKey in row) {
      return String(row['currency'] ?? 'BRL');
    }
  }
  const value = row[header];
  if (value === null || value === undefined) {
    return '';
  }
  if (typeof value === 'object') {
    return JSON.stringify(value);
  }
  return String(value);
}

function escapeCsv(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function triggerDownload(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
