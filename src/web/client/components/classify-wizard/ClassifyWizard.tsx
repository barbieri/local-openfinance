import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { apiJson } from '../../lib/api.js';
import {
  buildAnnotationCategoryOptions,
  indentOptionLabel,
} from '../../lib/category-select-options.js';
import { CategorySelectField } from '../categories/CategorySelect.js';

type SuggestResponse = {
  readonly embeddingMatches: readonly { readonly categoryId: string | null }[];
  readonly classifierCategoryId: string | null;
};

type Entry = {
  readonly id: string;
  readonly display_name: string;
  readonly amount_cents: number;
  readonly currency: string;
  readonly local_date: string;
  readonly raw_json: string;
};

export function ClassifyWizard({
  entry,
  onClose,
  onSaved,
}: {
  readonly entry: Entry;
  readonly onClose: () => void;
  readonly onSaved: () => void;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [categoryId, setCategoryId] = useState('');
  const [subCategoryId, setSubCategoryId] = useState('');
  const [notes, setNotes] = useState('');

  const { data: categoriesData } = useQuery({
    queryKey: ['annotation-categories'],
    queryFn: () =>
      apiJson<{
        rows: readonly {
          readonly id: string;
          readonly name: string;
          readonly parentId: string | null;
        }[];
      }>('/api/annotation-categories'),
  });

  const categoryOptions = useMemo(
    () => buildAnnotationCategoryOptions(categoriesData?.rows ?? []),
    [categoriesData?.rows],
  );

  const subCategoryOptions = useMemo(() => {
    if (!categoryId) {
      return [];
    }
    const options: { value: string; label: string; depth: number }[] = [];
    for (const row of categoriesData?.rows ?? []) {
      if (row.parentId === categoryId) {
        options.push({ value: row.id, label: row.name, depth: 1 });
      }
    }
    return options;
  }, [categoriesData?.rows, categoryId]);

  const { data: suggestions } = useQuery({
    queryKey: ['classify-suggest', entry.id],
    queryFn: () =>
      apiJson<SuggestResponse>('/api/classify/suggest', {
        method: 'POST',
        body: JSON.stringify({ entryType: 'transaction', entryId: entry.id }),
      }),
  });

  const saveMutation = useMutation({
    mutationFn: () =>
      apiJson('/api/classify', {
        method: 'POST',
        body: JSON.stringify({
          entryType: 'transaction',
          entryId: entry.id,
          categoryId: categoryId || null,
          subCategoryId: subCategoryId || null,
          notes: notes || null,
        }),
      }),
    onSuccess: () => {
      toast.success(t('toast.success'));
      void queryClient.invalidateQueries({ queryKey: ['classify-suggest'] });
      onSaved();
    },
    onError: (error: Error) => {
      toast.error(t('toast.error'), { description: error.message, duration: Infinity });
    },
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="max-h-[90vh] w-full max-w-lg overflow-auto rounded-lg bg-background p-4 shadow-xl">
        <h2 className="mb-2 text-lg font-semibold">{t('classify.title')}</h2>
        <p className="text-sm text-muted-foreground">
          {entry.local_date} · {entry.display_name}
        </p>
        {suggestions?.classifierCategoryId && (
          <p className="mt-1 text-xs text-muted-foreground">
            Suggested: {suggestions.classifierCategoryId}
          </p>
        )}
        <div className="mt-3 space-y-2">
          <CategorySelectField
            id="classify-category"
            resetKey={entry.id}
            label={t('columns.category')}
            value={categoryId}
            onChange={(value) => {
              setCategoryId(value);
              setSubCategoryId('');
            }}
            options={categoryOptions}
            emptyLabel={t('filters.allCategories')}
          />
          {subCategoryOptions.length > 0 && (
            <div className="space-y-1">
              <label htmlFor="classify-subcategory" className="text-sm font-medium">
                {t('columns.subCategory')}
              </label>
              <select
                id="classify-subcategory"
                className="w-full rounded border border-input bg-background px-2 py-1 text-sm"
                value={subCategoryId}
                onChange={(e) => setSubCategoryId(e.target.value)}
              >
                <option value="">{t('filters.allCategories')}</option>
                {subCategoryOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {indentOptionLabel(option)}
                  </option>
                ))}
              </select>
            </div>
          )}
          <label className="block space-y-1">
            <span className="text-sm font-medium">{t('classify.notes')}</span>
            <input
              id="classify-notes"
              className="w-full rounded border border-input px-2 py-1 text-sm"
              placeholder={t('classify.notes')}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </label>
        </div>
        <details className="mt-3">
          <summary className="cursor-pointer text-sm">{t('classify.rawJson')}</summary>
          <pre className="mt-1 max-h-40 overflow-auto rounded bg-muted p-2 text-xs">
            {entry.raw_json}
          </pre>
        </details>
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" className="rounded border px-3 py-1 text-sm" onClick={onClose}>
            {t('classify.skip')}
          </button>
          <button
            type="button"
            className="rounded bg-primary px-3 py-1 text-sm text-primary-foreground"
            disabled={!categoryId || saveMutation.isPending}
            onClick={() => saveMutation.mutate()}
          >
            {t('classify.save')}
          </button>
        </div>
      </div>
    </div>
  );
}
