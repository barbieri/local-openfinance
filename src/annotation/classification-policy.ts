export type ConfirmedAnnotationState = {
  readonly categoryId: string | null;
  readonly subCategoryId: string | null;
  readonly labels: readonly unknown[];
  readonly notes: string | null;
};

export type ConfirmedTransactionClassificationState = {
  readonly categoryOverrideId: string | null;
  readonly annotation: ConfirmedAnnotationState | null;
};

export type ConfirmedClassificationTerm =
  | { readonly kind: 'categoryOverride' }
  | { readonly kind: 'annotationField'; readonly field: 'categoryId' | 'subCategoryId' | 'notes' }
  | { readonly kind: 'annotationLabels' };

export const CONFIRMED_CLASSIFICATION_TERMS = [
  { kind: 'categoryOverride' },
  { kind: 'annotationField', field: 'categoryId' },
  { kind: 'annotationField', field: 'subCategoryId' },
  { kind: 'annotationField', field: 'notes' },
  { kind: 'annotationLabels' },
] as const satisfies readonly ConfirmedClassificationTerm[];

export function isConfirmedTransactionClassification(
  state: ConfirmedTransactionClassificationState,
): boolean {
  return CONFIRMED_CLASSIFICATION_TERMS.some((term) => {
    switch (term.kind) {
      case 'categoryOverride':
        return state.categoryOverrideId !== null;
      case 'annotationField':
        if (!state.annotation) return false;
        if (term.field === 'notes') return Boolean(state.annotation.notes?.trim());
        return state.annotation[term.field] !== null;
      case 'annotationLabels':
        return (state.annotation?.labels.length ?? 0) > 0;
      default:
        return false;
    }
  });
}

export function confirmedOverrideSql(alias: string): string {
  return `${alias}.category_id IS NOT NULL`;
}

export function confirmedAnnotationSql(annotationAlias: string, labelsAlias: string): string {
  const terms: string[] = [];
  for (const term of CONFIRMED_CLASSIFICATION_TERMS) {
    if (term.kind !== 'categoryOverride') {
      terms.push(compileClassificationTermSql(term, annotationAlias, labelsAlias));
    }
  }
  return `(${terms.join('\n OR ')})`;
}

export function buildConfirmedTransactionClassificationSql(
  options: {
    readonly transactionAlias?: string;
    readonly overrideAlias?: string;
    readonly annotationAlias?: string;
    readonly labelsAlias?: string;
  } = {},
): string {
  const transactionAlias = options.transactionAlias ?? 't';
  const overrideAlias = options.overrideAlias ?? 'tco_filter';
  const annotationAlias = options.annotationAlias ?? 'ea_filter';
  const labelsAlias = options.labelsAlias ?? 'eal_filter';
  const overrideTerm = CONFIRMED_CLASSIFICATION_TERMS.find(
    (term) => term.kind === 'categoryOverride',
  );
  if (!overrideTerm) {
    throw new Error('Confirmed classification policy must include a category override term');
  }
  return `(
    EXISTS (
      SELECT 1
      FROM transaction_category_overrides ${overrideAlias}
      WHERE ${overrideAlias}.transaction_id = ${transactionAlias}.id
        AND ${compileClassificationTermSql(overrideTerm, annotationAlias, labelsAlias, overrideAlias)}
    )
    OR EXISTS (
      SELECT 1
      FROM entry_annotations ${annotationAlias}
      WHERE ${annotationAlias}.entry_type = 'transaction'
        AND ${annotationAlias}.entry_id = ${transactionAlias}.id
        AND ${confirmedAnnotationSql(annotationAlias, labelsAlias)}
    )
  )`;
}

function compileClassificationTermSql(
  term: ConfirmedClassificationTerm,
  annotationAlias: string,
  labelsAlias: string,
  overrideAlias = 'tco',
): string {
  switch (term.kind) {
    case 'categoryOverride':
      return confirmedOverrideSql(overrideAlias);
    case 'annotationField':
      if (term.field === 'categoryId') return `${annotationAlias}.category_id IS NOT NULL`;
      if (term.field === 'subCategoryId') return `${annotationAlias}.sub_category_id IS NOT NULL`;
      return `NULLIF(TRIM(${annotationAlias}.notes), '') IS NOT NULL`;
    case 'annotationLabels':
      return `EXISTS (
        SELECT 1
        FROM entry_annotation_labels ${labelsAlias}
        WHERE ${labelsAlias}.annotation_id = ${annotationAlias}.id
      )`;
  }
}
