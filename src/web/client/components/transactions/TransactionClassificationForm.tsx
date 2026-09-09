import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { apiJson } from '../../lib/api.js';
import { withLocaleQuery } from '../../lib/api-locale.js';
import {
  buildAnnotationCategoryOptions,
  buildOpenFinanceCategoryOptions,
  indentOptionLabel,
} from '../../lib/category-select-options.js';
import { resolveLabelsDisplay } from '../../lib/labels-display-utils.js';
import { CategoryPathBadge } from '../categories/CategoryPathBadge.js';
import { CategorySelect, CategorySelectField } from '../categories/CategorySelect.js';
import type { CategoryPresentation } from '../categories/category-badge-presentation.js';
import type { LabelRecord } from '../labels/LabelEditDialog.js';
import { LabelMultiSelect } from '../labels/LabelMultiSelect.js';
import { resolveTransactionEditCategoryIds } from './transaction-classification-form-state.js';
import type { TransactionDetailRow } from './transaction-detail-types.js';

function resolveApiCategoryPresentation(
  categoryId: string,
  byId: Record<
    string,
    {
      readonly path?: string;
      readonly presentation?: CategoryPresentation;
    }
  >,
): CategoryPresentation | null {
  const entry = byId[categoryId];
  if (!entry?.presentation) {
    return null;
  }
  return {
    ...entry.presentation,
    path: entry.path ?? entry.presentation.path,
  };
}

export function TransactionClassificationForm({
  transaction,
  categoryOverrideId,
  onCategoryOverrideIdChange,
  annotationCategoryId,
  onAnnotationCategoryIdChange,
  annotationSubCategoryId,
  onAnnotationSubCategoryIdChange,
  selectedLabelIds,
  onSelectedLabelIdsChange,
  notes,
  onNotesChange,
  enabled = true,
}: {
  readonly transaction: TransactionDetailRow;
  readonly categoryOverrideId: string;
  readonly onCategoryOverrideIdChange: (value: string) => void;
  readonly annotationCategoryId: string;
  readonly onAnnotationCategoryIdChange: (value: string) => void;
  readonly annotationSubCategoryId: string;
  readonly onAnnotationSubCategoryIdChange: (value: string) => void;
  readonly selectedLabelIds: readonly string[];
  readonly onSelectedLabelIdsChange: (value: readonly string[]) => void;
  readonly notes: string;
  readonly onNotesChange: (value: string) => void;
  readonly enabled?: boolean;
}) {
  const { t, i18n } = useTranslation();

  const { data: categoriesData } = useQuery({
    queryKey: ['categories', i18n.language],
    queryFn: () =>
      apiJson<{
        byId: Record<
          string,
          {
            readonly id: string;
            readonly name: string;
            readonly name_translated: string | null;
            readonly parent_id: string | null;
            readonly path?: string;
            readonly presentation?: CategoryPresentation;
          }
        >;
      }>(withLocaleQuery('/api/categories', i18n.language)),
    enabled,
  });

  const { data: annotationCategoriesData } = useQuery({
    queryKey: ['annotation-categories'],
    queryFn: () =>
      apiJson<{
        rows: readonly {
          readonly id: string;
          readonly name: string;
          readonly parentId: string | null;
        }[];
      }>('/api/annotation-categories'),
    enabled,
  });

  const { data: annotationLabelsData } = useQuery({
    queryKey: ['annotation-labels'],
    queryFn: () => apiJson<{ byId: Record<string, LabelRecord> }>('/api/annotation-labels'),
    enabled,
  });

  const labelById = annotationLabelsData?.byId ?? {};

  const openFinanceCategoryOptions = useMemo(
    () => buildOpenFinanceCategoryOptions(categoriesData?.byId ?? {}),
    [categoriesData?.byId],
  );
  const annotationCategoryOptions = useMemo(
    () => buildAnnotationCategoryOptions(annotationCategoriesData?.rows ?? []),
    [annotationCategoriesData?.rows],
  );

  const { resolvedAnnotationCategoryId } = resolveTransactionEditCategoryIds(
    categoryOverrideId,
    annotationCategoryId,
  );

  const annotationSubCategoryOptions = useMemo(() => {
    if (!resolvedAnnotationCategoryId) {
      return [];
    }
    const options: { value: string; label: string; depth: number }[] = [];
    for (const row of annotationCategoriesData?.rows ?? []) {
      if (row.parentId === resolvedAnnotationCategoryId) {
        options.push({ value: row.id, label: row.name, depth: 1 });
      }
    }
    return options;
  }, [annotationCategoriesData?.rows, resolvedAnnotationCategoryId]);

  const correctedCategoryPresentation = useMemo(() => {
    if (!categoryOverrideId) {
      return null;
    }
    return (
      resolveApiCategoryPresentation(categoryOverrideId, categoriesData?.byId ?? {}) ??
      transaction.category_presentation ??
      null
    );
  }, [categoriesData?.byId, categoryOverrideId, transaction.category_presentation]);

  const effectiveCategoryPresentation = useMemo(() => {
    if (categoryOverrideId && categoryOverrideId !== transaction.category_id) {
      return correctedCategoryPresentation;
    }
    return transaction.original_category_presentation ?? transaction.category_presentation ?? null;
  }, [
    categoryOverrideId,
    correctedCategoryPresentation,
    transaction.category_id,
    transaction.category_presentation,
    transaction.original_category_presentation,
  ]);

  const annotationCategoryRows = annotationCategoriesData?.rows ?? [];
  const hasAnnotationCategories = annotationCategoryRows.length > 0;

  const selectedLabelPresentations = selectedLabelIds
    .map((labelId) => labelById[labelId])
    .filter((label): label is LabelRecord => label !== undefined);

  const labelPreview = resolveLabelsDisplay(
    {
      annotation: resolvedAnnotationCategoryId
        ? {
            category:
              annotationCategoryRows.find((row) => row.id === resolvedAnnotationCategoryId)?.name ??
              null,
            subCategory:
              annotationCategoryRows.find((row) => row.id === annotationSubCategoryId)?.name ??
              null,
            labels: selectedLabelPresentations.map((label) => label.path ?? label.name),
          }
        : null,
    },
    t('labels.separator'),
  );

  return (
    <div className="min-w-0 space-y-4">
      <div className="grid min-w-0 gap-4 md:grid-cols-2">
        <section className="min-w-0 space-y-2 rounded-md border border-border p-3">
          <h3 className="font-medium">{t('transactionDetail.openFinanceCategory')}</h3>
          <div className="min-w-0 max-w-full">
            <CategoryPathBadge presentation={effectiveCategoryPresentation} />
          </div>
          <CategorySelect
            id="transaction-category-override"
            resetKey={transaction.id}
            value={categoryOverrideId}
            onChange={onCategoryOverrideIdChange}
            options={openFinanceCategoryOptions}
            emptyLabel={t('transactionDetail.useOriginalCategory')}
            showSelected={false}
          />
        </section>

        <section className="min-w-0 space-y-2 rounded-md border border-border p-3">
          <h3 className="font-medium">{t('columns.labels')}</h3>
          {hasAnnotationCategories ? (
            <>
              <p className="text-xs text-muted-foreground">
                {t('transactionDetail.classifyCategoryHint')}
              </p>
              <CategorySelectField
                id="annotation-category"
                resetKey={transaction.id}
                label={t('transactionDetail.classifyCategory')}
                value={annotationCategoryId}
                onChange={(value) => {
                  onAnnotationCategoryIdChange(value);
                  onAnnotationSubCategoryIdChange('');
                }}
                options={annotationCategoryOptions}
                emptyLabel={t('transactionDetail.noClassifyCategory')}
                showSelected={false}
              />
              {annotationSubCategoryOptions.length > 0 && (
                <div className="space-y-1">
                  <label htmlFor="annotation-subcategory" className="text-sm font-medium">
                    {t('transactionDetail.classifySubCategory')}
                  </label>
                  <select
                    id="annotation-subcategory"
                    className="w-full rounded border border-input bg-background px-2 py-1 text-sm"
                    value={annotationSubCategoryId}
                    onChange={(event) => onAnnotationSubCategoryIdChange(event.target.value)}
                  >
                    <option value="">{t('transactionDetail.noClassifySubCategory')}</option>
                    {annotationSubCategoryOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {indentOptionLabel(option)}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </>
          ) : null}
          <LabelMultiSelect
            value={selectedLabelIds}
            onChange={onSelectedLabelIdsChange}
            byId={labelById}
            searchable
            resetKey={transaction.id}
          />
          {selectedLabelPresentations.length === 0 && labelPreview.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {labelPreview.map((label) => (
                <span
                  key={label}
                  className="rounded-full bg-secondary px-2 py-0.5 text-xs text-secondary-foreground"
                >
                  {label}
                </span>
              ))}
            </div>
          )}
        </section>
      </div>

      <label className="block min-w-0 space-y-1 rounded-md border border-border p-3">
        <span className="text-sm font-medium">{t('classify.notes')}</span>
        <textarea
          className="min-h-20 w-full rounded border border-input px-2 py-1 text-sm"
          value={notes}
          onChange={(event) => onNotesChange(event.target.value)}
        />
      </label>
    </div>
  );
}
