import { useEntityRef } from '../../hooks/use-entity-ref.js';

export function ConnectionCell({
  connectionId,
}: {
  readonly connectionId: string | null | undefined;
}) {
  const { entity, isLoading } = useEntityRef('connections', connectionId ?? undefined);
  if (!connectionId) {
    return <>—</>;
  }
  if (isLoading) {
    return <>…</>;
  }
  return (
    <>
      {String(entity?.display_name ?? entity?.connector_name ?? entity?.label_name ?? connectionId)}
    </>
  );
}
