import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { apiJson } from '../../lib/api.js';
import { Dialog } from '../ui/Dialog.js';
import { IconPicker, MaterialIcon } from '../ui/IconPicker.js';

type CategoryRecord = {
  readonly id: string;
  readonly path: string;
  readonly name: string;
  readonly name_translated: string | null;
  readonly presentation: {
    readonly name: string;
    readonly icon: string;
    readonly color: string;
  };
  readonly label: {
    readonly name?: string;
    readonly icon?: string;
    readonly color?: string;
  } | null;
};

type CategoryEditDialogProps = {
  readonly category: CategoryRecord | null;
  readonly onClose: () => void;
};

type CategoryEditFormState = {
  readonly sourceKey: string;
  readonly name: string;
  readonly icon: string;
  readonly color: string;
};

const EMPTY_CATEGORY_FORM: CategoryEditFormState = {
  sourceKey: '',
  name: '',
  icon: 'MdCategory',
  color: '#3d8b6a',
};

function resolveCategoryEditForm(category: CategoryRecord): CategoryEditFormState {
  return {
    sourceKey: category.id,
    name: category.label?.name ?? category.presentation.name,
    icon: category.label?.icon ?? category.presentation.icon,
    color: category.label?.color ?? category.presentation.color,
  };
}

export function CategoryEditDialog({ category, onClose }: CategoryEditDialogProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const sourceKey = category?.id ?? '';
  const [form, setForm] = useState<CategoryEditFormState>(EMPTY_CATEGORY_FORM);

  if (sourceKey && category && form.sourceKey !== sourceKey) {
    setForm(resolveCategoryEditForm(category));
  }

  const mutation = useMutation({
    mutationFn: () =>
      apiJson(`/api/categories/${category?.id}/label`, {
        method: 'PUT',
        body: JSON.stringify({ name: form.name || null, icon: form.icon, color: form.color }),
      }),
    onSuccess: () => {
      toast.success(t('toast.success'));
      void queryClient.invalidateQueries({ queryKey: ['categories'] });
      onClose();
    },
    onError: (error: Error) => {
      toast.error(t('toast.error'), { description: error.message, duration: Infinity });
    },
  });

  return (
    <Dialog
      open={category !== null}
      title={t('dialog.editCategory')}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="rounded border px-3 py-1 text-sm" onClick={onClose}>
            {t('classify.skip')}
          </button>
          <button
            type="button"
            className="rounded bg-primary px-3 py-1 text-sm text-primary-foreground"
            disabled={mutation.isPending || !category}
            onClick={() => mutation.mutate()}
          >
            {t('classify.save')}
          </button>
        </>
      }
    >
      {category && (
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">{category.path}</p>
          <label className="block space-y-1">
            <span className="text-sm font-medium">{t('dialog.displayName')}</span>
            <input
              className="w-full rounded border border-input px-2 py-1 text-sm"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </label>
          <label className="block space-y-1">
            <span className="text-sm font-medium">{t('dialog.color')}</span>
            <div className="flex items-center gap-2">
              <input
                type="color"
                className="h-9 w-14 cursor-pointer rounded border border-input"
                value={form.color}
                onChange={(e) => setForm({ ...form, color: e.target.value })}
              />
              <span className="font-mono text-xs text-muted-foreground">{form.color}</span>
              <span
                className="inline-flex items-center rounded p-1"
                style={{ backgroundColor: `${form.color}22`, color: form.color }}
              >
                <MaterialIcon name={form.icon} className="size-5" />
              </span>
            </div>
          </label>
          <div className="space-y-1">
            <span className="text-sm font-medium">{t('dialog.icon')}</span>
            <IconPicker value={form.icon} onChange={(icon) => setForm({ ...form, icon })} />
          </div>
        </div>
      )}
    </Dialog>
  );
}
