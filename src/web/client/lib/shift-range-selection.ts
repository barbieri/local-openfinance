export function applyShiftRangeSelection(options: {
  readonly orderedIds: readonly string[];
  readonly targetId: string;
  readonly checked: boolean;
  readonly shiftKey: boolean;
  readonly selected: readonly string[];
  readonly anchorIndex: number | null;
}): { readonly selected: string[]; readonly anchorIndex: number | null } {
  const { orderedIds, targetId, checked, shiftKey, selected, anchorIndex } = options;
  const targetIndex = orderedIds.indexOf(targetId);
  if (targetIndex === -1) {
    return { selected: [...selected], anchorIndex: anchorIndex ?? null };
  }

  if (shiftKey && anchorIndex !== null) {
    const start = Math.min(anchorIndex, targetIndex);
    const end = Math.max(anchorIndex, targetIndex);
    const selectedSet = new Set(selected);
    for (const id of orderedIds.slice(start, end + 1)) {
      if (checked) {
        selectedSet.add(id);
      } else {
        selectedSet.delete(id);
      }
    }
    return { selected: [...selectedSet], anchorIndex: targetIndex };
  }

  const selectedSet = new Set(selected);
  if (checked) {
    selectedSet.add(targetId);
  } else {
    selectedSet.delete(targetId);
  }
  return { selected: [...selectedSet], anchorIndex: targetIndex };
}
