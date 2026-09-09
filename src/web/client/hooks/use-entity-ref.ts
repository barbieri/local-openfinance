import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { apiJson } from '../lib/api.js';
import { withLocaleQuery } from '../lib/api-locale.js';

type AccountsResponse = {
  readonly rows: readonly Record<string, unknown>[];
  readonly byId: Record<string, Record<string, unknown>>;
};

type ConnectionsResponse = {
  readonly rows: readonly Record<string, unknown>[];
  readonly byId: Record<string, Record<string, unknown>>;
};

type CategoriesResponse = {
  readonly tree: readonly unknown[];
  readonly byId: Record<string, Record<string, unknown>>;
};

export function useReferenceData() {
  const { i18n } = useTranslation();
  const { data: connectionsData, isLoading: connectionsLoading } = useQuery({
    queryKey: ['connections'],
    queryFn: () => apiJson<ConnectionsResponse>('/api/connections'),
  });
  const { data: accountsData, isLoading: accountsLoading } = useQuery({
    queryKey: ['accounts'],
    queryFn: () => apiJson<AccountsResponse>('/api/accounts'),
  });
  const { data: categoriesData, isLoading: categoriesLoading } = useQuery({
    queryKey: ['categories', i18n.language],
    queryFn: () => apiJson<CategoriesResponse>(withLocaleQuery('/api/categories', i18n.language)),
  });

  return {
    connectionsData,
    connectionsLoading,
    accountsData,
    accountsLoading,
    categoriesData,
    categoriesLoading,
  };
}

export function useEntityRef(
  mapName: 'connections' | 'accounts' | 'categories',
  id: string | null | undefined,
): { entity: Record<string, unknown> | null; isLoading: boolean } {
  const {
    connectionsData,
    connectionsLoading,
    accountsData,
    accountsLoading,
    categoriesData,
    categoriesLoading,
  } = useReferenceData();

  const isLoading =
    mapName === 'connections'
      ? connectionsLoading
      : mapName === 'accounts'
        ? accountsLoading
        : categoriesLoading;

  if (isLoading) {
    return { entity: null, isLoading: true };
  }

  if (!id) {
    return { entity: null, isLoading: false };
  }

  const data =
    mapName === 'connections'
      ? connectionsData
      : mapName === 'accounts'
        ? accountsData
        : categoriesData;

  const entity = data?.byId[id] ?? null;
  return { entity, isLoading: false };
}
