import { useCallback, useState } from 'react';

type UseSearchQueryOptions = {
  readonly resetKey?: unknown;
};

type SearchQueryState = {
  readonly query: string;
  readonly prevResetKey: unknown;
};

export function useSearchQuery(options?: UseSearchQueryOptions): {
  readonly query: string;
  readonly setQuery: (value: string) => void;
  readonly clearQuery: () => void;
} {
  const resetKey = options?.resetKey;
  const [state, setState] = useState<SearchQueryState>({
    query: '',
    prevResetKey: resetKey,
  });

  if (resetKey !== undefined && resetKey !== state.prevResetKey) {
    setState({ query: '', prevResetKey: resetKey });
  }

  const setQuery = useCallback((query: string) => {
    setState((prev) => ({ ...prev, query }));
  }, []);

  const clearQuery = useCallback(() => {
    setState((prev) => ({ ...prev, query: '' }));
  }, []);

  return { query: state.query, setQuery, clearQuery };
}
