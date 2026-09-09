import { describe, expect, it } from 'vitest';
import {
  formatHttpError,
  formatNetworkError,
  isRetriableRateLimitResponse,
  OpenFinanceClientError,
} from '../src/openfinance/client.js';
import { formatUnknownError } from '../src/utils/format-error.js';

describe('formatUnknownError', () => {
  it('includes Error.cause chain and Node errno fields', () => {
    const root = Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:443'), {
      code: 'ECONNREFUSED',
      syscall: 'connect',
      address: '127.0.0.1',
      port: 443,
    });
    const outer = new TypeError('fetch failed', { cause: root });
    const message = formatUnknownError(outer);
    expect(message).toContain('fetch failed');
    expect(message).toContain('ECONNREFUSED');
    expect(message).toContain('127.0.0.1:443');
  });

  it('stringifies non-Error values', () => {
    expect(formatUnknownError('boom')).toBe('boom');
    expect(formatUnknownError(null)).toBe('Unknown error');
  });
});

describe('OpenFinanceClient error formatting', () => {
  it('recognizes Banco MCP queue-limit errors surfaced as HTTP 500 as retriable', () => {
    expect(isRetriableRateLimitResponse(429, '')).toBe(true);
    expect(
      isRetriableRateLimitResponse(
        500,
        'Pluggy rate-limit: 2 req/s por aplicação excedido (fila cheia).',
      ),
    ).toBe(true);
    expect(isRetriableRateLimitResponse(500, 'upstream service failure')).toBe(false);
  });

  it('formats network failures with URL and action hints', () => {
    const cause = Object.assign(new Error('getaddrinfo ENOTFOUND api.mcp.ai'), {
      code: 'ENOTFOUND',
      hostname: 'api.mcp.ai',
    });
    const message = formatNetworkError(
      'https://api.mcp.ai/api/openfinance/connections/list',
      new TypeError('fetch failed', { cause }),
    );
    expect(message).toContain('Cannot reach Banco MCP');
    expect(message).toContain('connections/list');
    expect(message).toContain('ENOTFOUND');
    expect(message).toContain('OPENFINANCE_BASE_URL');
  });

  it('formats HTTP errors with status, body, and auth hint', () => {
    const message = formatHttpError(
      'https://api.mcp.ai/api/openfinance/connections/list',
      401,
      'Unauthorized',
      JSON.stringify({ error: { message: 'invalid api key', code: 'unauthorized' } }),
    );
    expect(message).toContain('HTTP 401 Unauthorized');
    expect(message).toContain('invalid api key');
    expect(message).toContain('OPENFINANCE_API_KEY');
  });

  it('builds OpenFinanceClientError messages used by job failure path', () => {
    const error = new OpenFinanceClientError({
      message: formatHttpError(
        'https://api.mcp.ai/api/openfinance/accounts/list',
        502,
        'Bad Gateway',
        '{"message":"upstream bank timeout"}',
      ),
      kind: 'http',
      url: 'https://api.mcp.ai/api/openfinance/accounts/list',
      status: 502,
      body: '{"message":"upstream bank timeout"}',
    });
    expect(formatUnknownError(error)).toContain('upstream bank timeout');
    expect(formatUnknownError(error)).toContain('502');
  });
});
