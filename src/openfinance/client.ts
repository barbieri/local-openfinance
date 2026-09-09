import { formatUnknownError } from '../utils/format-error.js';
import { readOpenFinanceApiKey, readOpenFinanceBaseUrl } from '../utils/paths.js';

export type OpenFinanceResponse<T> = {
  readonly ok: boolean;
  readonly tool: string;
  readonly result: T;
};

export type OpenFinanceErrorKind = 'network' | 'http' | 'upstream' | 'invalid_response';

const MAX_ERROR_BODY_CHARS = 2000;

export class OpenFinanceClientError extends Error {
  readonly kind: OpenFinanceErrorKind;
  readonly status: number | null;
  readonly url: string;
  readonly body: string | null;

  constructor(options: {
    readonly message: string;
    readonly kind: OpenFinanceErrorKind;
    readonly url: string;
    readonly status?: number | null;
    readonly body?: string | null;
    readonly cause?: unknown;
  }) {
    super(options.message, options.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = 'OpenFinanceClientError';
    this.kind = options.kind;
    this.status = options.status ?? null;
    this.url = options.url;
    this.body = options.body ?? null;
  }
}

export class OpenFinanceClient {
  readonly #baseUrl: string;
  readonly #apiKey: string;

  constructor(baseUrl = readOpenFinanceBaseUrl(), apiKey = readOpenFinanceApiKey()) {
    if (!apiKey) {
      throw new Error('OPENFINANCE_API_KEY is required for Banco MCP API calls');
    }
    this.#baseUrl = baseUrl.replace(/\/$/u, '');
    this.#apiKey = apiKey;
  }

  async post<T>(endpoint: string, body: Record<string, unknown> = {}): Promise<T> {
    const url = `${this.#baseUrl}${endpoint.startsWith('/') ? endpoint : `/${endpoint}`}`;
    return this.#postWithRetry<T>(url, body, 0);
  }

  async #postWithRetry<T>(url: string, body: Record<string, unknown>, attempt: number): Promise<T> {
    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.#apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });
    } catch (error) {
      throw new OpenFinanceClientError({
        message: formatNetworkError(url, error),
        kind: 'network',
        url,
        cause: error,
      });
    }

    if (!response.ok) {
      const text = await response.text();
      if (isRetriableRateLimitResponse(response.status, text) && attempt < 7) {
        await sleep(readRetryAfterMs(text, 1000));
        return this.#postWithRetry<T>(url, body, attempt + 1);
      }
      throw new OpenFinanceClientError({
        message: formatHttpError(url, response.status, response.statusText, text),
        kind: 'http',
        url,
        status: response.status,
        body: text,
      });
    }

    const text = await response.text();

    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch (error) {
      throw new OpenFinanceClientError({
        message: [
          `Banco MCP returned non-JSON for POST ${url}.`,
          `Parse error: ${formatUnknownError(error)}`,
          formatBodySnippet(text),
        ]
          .filter(Boolean)
          .join('\n'),
        kind: 'invalid_response',
        url,
        status: response.status,
        body: text,
        cause: error,
      });
    }

    if (!parsed || typeof parsed !== 'object') {
      throw new OpenFinanceClientError({
        message: `Banco MCP response for POST ${url} was not a JSON object.`,
        kind: 'invalid_response',
        url,
        status: response.status,
        body: text,
      });
    }

    const envelope = parsed as OpenFinanceResponse<T> & {
      readonly error?: unknown;
      readonly message?: unknown;
    };
    if (!envelope.ok) {
      throw new OpenFinanceClientError({
        message: formatUpstreamOkFalse(url, envelope, text),
        kind: 'upstream',
        url,
        status: response.status,
        body: text,
      });
    }

    return envelope.result;
  }
}

export function formatNetworkError(url: string, error: unknown): string {
  const detail = formatUnknownError(error);
  const lines = [
    `Cannot reach Banco MCP (network error) for POST ${url}.`,
    detail,
    'Check OPENFINANCE_BASE_URL, DNS, TLS, proxy settings, and that api.mcp.ai is reachable from this machine.',
  ];
  return lines.join('\n');
}

export function formatHttpError(
  url: string,
  status: number,
  statusText: string,
  body: string,
): string {
  const statusLabel = statusText ? `${status} ${statusText}` : String(status);
  const hint = httpStatusHint(status);
  const bodyLine = formatBodySnippet(body);
  const lines = [`Banco MCP returned HTTP ${statusLabel} for POST ${url}.`, bodyLine, hint].filter(
    (line): line is string => Boolean(line),
  );
  return lines.join('\n');
}

export function isRetriableRateLimitResponse(status: number, body: string): boolean {
  return status === 429 || (status === 500 && /(?:rate[ -]?limit|fila cheia)/iu.test(body));
}

function formatUpstreamOkFalse(
  url: string,
  envelope: {
    readonly tool?: unknown;
    readonly result?: unknown;
    readonly error?: unknown;
    readonly message?: unknown;
  },
  rawBody: string,
): string {
  const tool =
    typeof envelope.tool === 'string' && envelope.tool.trim().length > 0
      ? envelope.tool
      : 'unknown tool';
  const detail =
    summarizeUnknown(envelope.error) ??
    summarizeUnknown(envelope.message) ??
    summarizeUnknown(envelope.result) ??
    formatBodySnippet(rawBody);
  return [`Banco MCP tool ${tool} returned ok=false for POST ${url}.`, detail]
    .filter(Boolean)
    .join('\n');
}

function httpStatusHint(status: number): string | null {
  if (status === 401 || status === 403) {
    return 'Check OPENFINANCE_API_KEY and that the key still has access to this workspace.';
  }
  if (status === 404) {
    return 'Check OPENFINANCE_BASE_URL; the path may be wrong for this Banco MCP deployment.';
  }
  if (status === 429) {
    return 'Banco MCP rate limit exceeded after retries. Wait and try again.';
  }
  if (status >= 500) {
    return 'Upstream Banco MCP or bank connector failed. Retry later or check status at banco.mcp.ai.';
  }
  return null;
}

function formatBodySnippet(body: string): string | null {
  const trimmed = body.trim();
  if (!trimmed) {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(trimmed);
    const summarized = summarizeUnknown(parsed);
    if (summarized) {
      return summarized.length > MAX_ERROR_BODY_CHARS
        ? `${summarized.slice(0, MAX_ERROR_BODY_CHARS)}…`
        : summarized;
    }
  } catch {
    // fall through to raw body
  }
  if (trimmed.length > MAX_ERROR_BODY_CHARS) {
    return `Response body: ${trimmed.slice(0, MAX_ERROR_BODY_CHARS)}…`;
  }
  return `Response body: ${trimmed}`;
}

function summarizeUnknown(value: unknown): string | null {
  if (value == null) {
    return null;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  if (typeof value === 'object') {
    return summarizeObject(value as Record<string, unknown>);
  }
  return String(value);
}

function summarizeObject(record: Record<string, unknown>): string | null {
  const preferred =
    summarizeUnknown(record['message']) ??
    summarizeUnknown(record['error']) ??
    summarizeUnknown(record['detail']) ??
    summarizeUnknown(record['details']);
  if (preferred) {
    const code = record['code'];
    if (typeof code === 'string' || typeof code === 'number') {
      return `${preferred} (code: ${String(code)})`;
    }
    return preferred;
  }
  try {
    return JSON.stringify(record);
  } catch {
    return String(record);
  }
}

function readRetryAfterMs(body: string, fallbackMs: number): number {
  try {
    const parsed = JSON.parse(body) as {
      readonly error?: { readonly retry_after_ms?: number };
    };
    const retryAfterMs = parsed.error?.retry_after_ms;
    return typeof retryAfterMs === 'number' && retryAfterMs > 0 ? retryAfterMs : fallbackMs;
  } catch {
    return fallbackMs;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
