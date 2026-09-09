type LabelLookup = {
  readonly id: string;
  readonly name: string;
  readonly path?: string;
};

export type LabelReferenceInput = {
  readonly labelIds?: readonly string[];
  readonly labelNames?: readonly string[];
};

export function resolveLabelIdsFromProposal(
  labelById: Record<string, LabelLookup>,
  proposal: LabelReferenceInput,
): string[] {
  const fromIds = (proposal.labelIds ?? []).filter((id) => Boolean(labelById[id]));
  if (fromIds.length > 0) {
    return [...new Set(fromIds)];
  }

  const normalizedPaths = new Map(
    Object.values(labelById).map((label) => [(label.path ?? label.name).toLowerCase(), label.id]),
  );
  const byName = groupLabelsByName(labelById);
  const resolved: string[] = [];

  for (const reference of proposal.labelNames ?? []) {
    const labelId = resolveSingleLabelReference(reference, normalizedPaths, byName, labelById);
    if (labelId) {
      resolved.push(labelId);
    }
  }

  return [...new Set(resolved)];
}

function groupLabelsByName(labelById: Record<string, LabelLookup>): Map<string, string[]> {
  const byName = new Map<string, string[]>();
  for (const label of Object.values(labelById)) {
    const key = label.name.toLowerCase();
    const group = byName.get(key) ?? [];
    group.push(label.id);
    byName.set(key, group);
  }
  return byName;
}

function resolveSingleLabelReference(
  reference: string,
  normalizedPaths: ReadonlyMap<string, string>,
  byName: ReadonlyMap<string, string[]>,
  labelById: Record<string, LabelLookup>,
): string | null {
  const trimmed = reference.trim();
  if (!trimmed) {
    return null;
  }

  const pathMatch = normalizedPaths.get(trimmed.toLowerCase());
  if (pathMatch) {
    return pathMatch;
  }

  const nameMatches = byName.get(trimmed.toLowerCase()) ?? [];
  if (nameMatches.length === 1) {
    return nameMatches[0] ?? null;
  }
  if (nameMatches.length <= 1) {
    return null;
  }

  const nested = nameMatches
    .map((id) => labelById[id])
    .filter((label): label is LabelLookup => Boolean(label?.path?.includes('>')));
  return nested.length === 1 ? (nested[0]?.id ?? null) : null;
}
