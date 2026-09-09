export class JobAbortedError extends Error {
  constructor(message = 'Job aborted') {
    super(message);
    this.name = 'JobAbortedError';
  }
}

export function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw new JobAbortedError();
  }
}
