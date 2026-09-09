import { apiFetch } from './api.js';

function findSseDataLine(part: string): string | undefined {
  for (const line of part.split('\n')) {
    if (line.startsWith('data:')) {
      return line;
    }
  }
  return undefined;
}

export async function consumeSseStream<T>(
  path: string,
  onEvent: (event: T) => void,
  signal?: AbortSignal,
): Promise<void> {
  const response = await apiFetch(path, { method: 'GET', signal });
  if (!response.ok) {
    throw new Error(await response.text());
  }
  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error('No response body');
  }
  const decoder = new TextDecoder();
  let buffer = '';

  const readNext = async (): Promise<void> => {
    if (signal?.aborted) {
      return;
    }
    const { done, value } = await reader.read();
    if (done) {
      return;
    }
    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split('\n\n');
    buffer = parts.pop() ?? '';
    for (const part of parts) {
      const dataLine = findSseDataLine(part);
      if (!dataLine) {
        continue;
      }
      const payload = JSON.parse(dataLine.slice(5).trim()) as T;
      onEvent(payload);
    }
    return readNext();
  };

  await readNext();
}
