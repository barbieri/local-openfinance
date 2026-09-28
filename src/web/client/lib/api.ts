import { currentAuthGeneration, invalidateAuthForGeneration } from './auth.js';
import { webRequest } from './request.js';

type FetchInput = Parameters<typeof fetch>[0];

export async function apiFetch(input: FetchInput, init?: RequestInit): Promise<Response> {
  const authGeneration = currentAuthGeneration();
  const response = await webRequest(input, init);
  if (response.status === 401) {
    invalidateAuthForGeneration(authGeneration);
  }
  return response;
}

export async function apiJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await apiFetch(path, init);
  const text = await response.text();
  if (!response.ok) {
    throw new Error(readApiErrorMessage(text, response.statusText));
  }
  return parseJsonResponseBody<T>(path, text, response.headers.get('content-type'));
}

function parseJsonResponseBody<T>(path: string, text: string, contentType: string | null): T {
  if (!text.trim()) {
    throw new Error(`Empty response from ${path}`);
  }
  const normalizedContentType = contentType?.toLowerCase() ?? '';
  if (
    normalizedContentType.length > 0 &&
    !normalizedContentType.includes('application/json') &&
    !normalizedContentType.includes('+json')
  ) {
    throw new Error(
      `Expected JSON response from ${path} but got ${contentType}: ${text.slice(0, 200)}`,
    );
  }
  try {
    return JSON.parse(text) as T;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Invalid JSON';
    throw new Error(`Invalid JSON response from ${path}: ${message}`);
  }
}

function readApiErrorMessage(text: string, statusText: string): string {
  if (!text) {
    return statusText;
  }
  try {
    const body = JSON.parse(text) as { error?: string; message?: string };
    return body.error ?? body.message ?? text;
  } catch {
    return text;
  }
}
