type LabeledText = {
  readonly text: string;
  readonly color: string;
};

export type ResolvedSuggestionDigestRow = {
  readonly entryId: string;
  readonly date: string;
  readonly description: string;
  readonly amount: {
    readonly cents: number;
    readonly currency: string;
  };
  readonly originalCategory: LabeledText;
  readonly newCategory: LabeledText;
  readonly originalLabels: readonly LabeledText[];
  readonly newLabels: readonly LabeledText[];
  readonly score: number | null;
};

export type SuggestionDigestProjection = {
  readonly previousRows: readonly ResolvedSuggestionDigestRow[];
  readonly newRows: readonly ResolvedSuggestionDigestRow[];
  readonly publicBaseUrl: string | undefined;
};

export function projectSuggestionDigestRows(
  rows: readonly ResolvedSuggestionDigestRow[],
  previouslyPendingEntryIds: ReadonlySet<string>,
  publicBaseUrl?: string,
): SuggestionDigestProjection {
  const newRows: ResolvedSuggestionDigestRow[] = [];
  const previousRows: ResolvedSuggestionDigestRow[] = [];
  for (const row of rows) {
    if (!previouslyPendingEntryIds.has(row.entryId)) {
      newRows.push(row);
    } else {
      previousRows.push(row);
    }
  }
  return { newRows, previousRows, publicBaseUrl };
}
