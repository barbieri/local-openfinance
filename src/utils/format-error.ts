/**
 * Build a user-facing multi-line error string from unknown thrown values.
 * Walks `Error.cause` and includes Node errno fields when present so network
 * failures like bare "fetch failed" become actionable.
 */
export function formatUnknownError(error: unknown, maxDepth = 5): string {
  if (error == null) {
    return 'Unknown error';
  }
  if (!(error instanceof Error)) {
    return String(error);
  }

  // OpenFinanceClientError already embeds URL, body, and cause detail in message.
  if (error.name === 'OpenFinanceClientError' && error.message.trim().length > 0) {
    return error.message;
  }

  return collectErrorLines(error, maxDepth).join('\n') || 'Unknown error';
}

function collectErrorLines(error: Error, maxDepth: number): string[] {
  const lines: string[] = [];
  let current: unknown = error;
  let depth = 0;

  while (current != null && depth < maxDepth) {
    if (!(current instanceof Error)) {
      appendUniqueLine(lines, String(current));
      break;
    }
    appendUniqueLine(lines, formatErrorNode(current));
    current = current.cause;
    depth += 1;
  }

  return lines;
}

function appendUniqueLine(lines: string[], detail: string): void {
  if (!detail) {
    return;
  }
  if (lines.includes(detail) || lines.some((line) => line.includes(detail))) {
    return;
  }
  lines.push(detail);
}

function formatErrorNode(error: Error): string {
  const extras = readErrorExtras(error);
  if (extras.length === 0) {
    return error.message || error.name;
  }
  const base = error.message || error.name;
  const suffix = extras.join(', ');
  // Avoid duplicating when the message already embeds the code/detail.
  if (base.includes(suffix) || extras.every((part) => base.includes(part))) {
    return base;
  }
  return `${base} (${suffix})`;
}

function readErrorExtras(error: Error): string[] {
  const record = error as Error & Record<string, unknown>;
  const extras: string[] = [];
  pushStringExtra(extras, record['code']);
  pushStringExtra(extras, record['errno'] != null ? String(record['errno']) : null);
  pushStringExtra(extras, record['syscall']);
  pushStringExtra(extras, record['hostname']);
  pushAddressExtra(extras, record);
  return extras;
}

function pushAddressExtra(extras: string[], record: Record<string, unknown>): void {
  if (record['address'] != null) {
    const port = record['port'];
    const address = String(record['address']);
    extras.push(port != null ? `${address}:${String(port)}` : address);
    return;
  }
  pushStringExtra(extras, record['port'] != null ? `port ${String(record['port'])}` : null);
}

function pushStringExtra(extras: string[], value: unknown): void {
  if (typeof value === 'string' && value.trim().length > 0) {
    extras.push(value.trim());
  }
}
