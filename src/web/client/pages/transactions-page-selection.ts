export function removeDeletedTransactionIds(
  selectedIds: readonly string[],
  deletedIds: readonly string[],
): readonly string[] {
  const deletedIdSet = new Set(deletedIds);
  return selectedIds.filter((id) => !deletedIdSet.has(id));
}
