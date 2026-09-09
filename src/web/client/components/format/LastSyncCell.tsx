import { useEntityRef } from '../../hooks/use-entity-ref.js';
import { FormattedSyncTime } from './sync-time.js';

export function LastSyncCell({ row }: { readonly row: Record<string, unknown> }) {
  const connectionId = String(row.connection_item_id ?? '');
  const { entity, isLoading } = useEntityRef('connections', connectionId || undefined);
  const accountSynced = String(row.synced_at ?? '').trim();
  const connectionSynced = String(entity?.synced_at ?? '').trim();
  const value = accountSynced || connectionSynced;

  if (!value && isLoading) {
    return <>…</>;
  }

  return <FormattedSyncTime value={value || undefined} />;
}
