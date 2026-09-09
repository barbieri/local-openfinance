import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { apiJson } from '../../lib/api.js';
import { buildAnnotationLabelOptions } from '../../lib/label-select-options.js';
import { Dialog } from '../ui/Dialog.js';
import { IconPicker, MaterialIcon } from '../ui/IconPicker.js';

const DEFAULT_ICON = 'MdLabel';
const DEFAULT_COLOR = '#64748b';

export type LabelRecord = {
  readonly id: string;
  readonly name: string;
  readonly path: string;
  readonly icon: string;
  readonly color: string;
  readonly parent_id: string | null;
  readonly icon_override: string | null;
  readonly color_override: string | null;
  readonly usageCount: number;
};

type LabelEditDialogProps = {
  readonly label: LabelRecord | null;
  readonly mode: 'create' | 'edit';
  readonly byId: Record<string, LabelRecord>;
  readonly initialParentId?: string | null;
  readonly onClose: () => void;
};

function resolveParentPresentation(
  parentId: string,
  byId: Record<string, LabelRecord>,
): { readonly icon: string; readonly color: string } {
  const parent = byId[parentId];
  return {
    icon: parent?.icon ?? DEFAULT_ICON,
    color: parent?.color ?? DEFAULT_COLOR,
  };
}

function applyParentPresentation(
  nextParentId: string,
  byId: Record<string, LabelRecord>,
  options: {
    readonly inheritIcon: boolean;
    readonly inheritColor: boolean;
    readonly setIcon: (value: string) => void;
    readonly setColor: (value: string) => void;
  },
): void {
  const parentPresentation = nextParentId
    ? resolveParentPresentation(nextParentId, byId)
    : { icon: DEFAULT_ICON, color: DEFAULT_COLOR };

  if (options.inheritIcon) {
    options.setIcon(parentPresentation.icon);
  }
  if (options.inheritColor) {
    options.setColor(parentPresentation.color);
  }
}

function resolveEditParentInheritance(label: LabelRecord): {
  readonly inheritIcon: boolean;
  readonly inheritColor: boolean;
} {
  return {
    inheritIcon: label.icon_override === null,
    inheritColor: label.color_override === null,
  };
}

function buildLabelSavePayload(
  name: string,
  parentId: string,
  icon: string,
  color: string,
  byId: Record<string, LabelRecord>,
): {
  readonly name: string;
  readonly parentId: string | null;
  readonly icon: string | null;
  readonly color: string | null;
} {
  const parentPresentation = parentId ? resolveParentPresentation(parentId, byId) : null;

  return {
    name,
    parentId: parentId || null,
    icon: parentPresentation && icon === parentPresentation.icon ? null : icon,
    color: parentPresentation && color === parentPresentation.color ? null : color,
  };
}

function resolveLabelDialogTitle(
  mode: 'create' | 'edit',
  initialParentId: string | null | undefined,
  translate: (key: string) => string,
): string {
  if (mode === 'edit') {
    return translate('labels.edit');
  }
  if (initialParentId) {
    return translate('labels.createSubTitle');
  }
  return translate('labels.create');
}

function resolveLabelFormDefaults(
  mode: 'create' | 'edit',
  label: LabelRecord | null,
  initialParentId: string | null | undefined,
  byId: Record<string, LabelRecord>,
): {
  readonly name: string;
  readonly parentId: string;
  readonly icon: string;
  readonly color: string;
} {
  if (mode === 'edit' && label) {
    return {
      name: label.name,
      parentId: label.parent_id ?? '',
      icon: label.icon,
      color: label.color,
    };
  }

  const nextParentId = initialParentId ?? '';
  if (nextParentId) {
    const parentPresentation = resolveParentPresentation(nextParentId, byId);
    return {
      name: '',
      parentId: nextParentId,
      icon: parentPresentation.icon,
      color: parentPresentation.color,
    };
  }

  return {
    name: '',
    parentId: '',
    icon: DEFAULT_ICON,
    color: DEFAULT_COLOR,
  };
}

function parseSyncedPresentationKey(
  key: string | null,
): { readonly icon: string; readonly color: string } | null {
  if (!key) {
    return null;
  }
  const colonIndex = key.indexOf(':');
  if (colonIndex === -1) {
    return null;
  }
  return {
    icon: key.slice(0, colonIndex),
    color: key.slice(colonIndex + 1),
  };
}

function useLabelEditFormState(
  mode: 'create' | 'edit',
  label: LabelRecord | null,
  initialParentId: string | null | undefined,
  byId: Record<string, LabelRecord>,
) {
  const formSourceKey =
    mode === 'edit' && label ? `edit:${label.id}` : `create:${initialParentId ?? ''}`;

  type LabelEditFormState = {
    readonly name: string;
    readonly parentId: string;
    readonly icon: string;
    readonly color: string;
    readonly syncedFormSourceKey: string | null;
    readonly syncedPresentationKey: string | null;
  };

  const [formState, setFormState] = useState<LabelEditFormState>({
    name: '',
    parentId: '',
    icon: DEFAULT_ICON,
    color: DEFAULT_COLOR,
    syncedFormSourceKey: null,
    syncedPresentationKey: null,
  });

  const { name, parentId, icon, color } = formState;

  const effectiveParentId = mode === 'create' ? ((parentId || initialParentId) ?? '') : '';

  const presentationKey =
    mode === 'create' && effectiveParentId
      ? (() => {
          const presentation = resolveParentPresentation(effectiveParentId, byId);
          return `${presentation.icon}:${presentation.color}`;
        })()
      : '';

  if (formSourceKey !== formState.syncedFormSourceKey) {
    const defaults = resolveLabelFormDefaults(mode, label, initialParentId, byId);
    setFormState({
      name: defaults.name,
      parentId: defaults.parentId,
      icon: defaults.icon,
      color: defaults.color,
      syncedFormSourceKey: formSourceKey,
      syncedPresentationKey: presentationKey,
    });
  } else if (
    mode === 'create' &&
    presentationKey !== '' &&
    presentationKey !== formState.syncedPresentationKey
  ) {
    const parentPresentation = resolveParentPresentation(effectiveParentId, byId);
    const previousPresentation = parseSyncedPresentationKey(formState.syncedPresentationKey);
    const inheritIcon =
      previousPresentation === null || formState.icon === previousPresentation.icon;
    const inheritColor =
      previousPresentation === null || formState.color === previousPresentation.color;

    setFormState((prev) => ({
      ...prev,
      icon: inheritIcon ? parentPresentation.icon : prev.icon,
      color: inheritColor ? parentPresentation.color : prev.color,
      syncedPresentationKey: presentationKey,
    }));
  }

  const setName = (nextName: string): void => {
    setFormState((prev) => ({ ...prev, name: nextName }));
  };
  const setParentId = (nextParentId: string): void => {
    setFormState((prev) => ({ ...prev, parentId: nextParentId }));
  };
  const setIcon = (nextIcon: string): void => {
    setFormState((prev) => ({ ...prev, icon: nextIcon }));
  };
  const setColor = (nextColor: string): void => {
    setFormState((prev) => ({ ...prev, color: nextColor }));
  };

  return { name, setName, parentId, setParentId, icon, setIcon, color, setColor };
}

export function LabelEditDialog({
  label,
  mode,
  byId,
  initialParentId = null,
  onClose,
}: LabelEditDialogProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { name, setName, parentId, setParentId, icon, setIcon, color, setColor } =
    useLabelEditFormState(mode, label, initialParentId, byId);

  const parentOptions = useMemo(() => {
    const rows = Object.values(byId).filter((row) => row.id !== label?.id);
    return buildAnnotationLabelOptions(
      rows.map((row) => ({
        id: row.id,
        name: row.name,
        parentId: row.parent_id,
        path: row.path,
      })),
    );
  }, [byId, label?.id]);

  const handleParentChange = (nextParentId: string): void => {
    setParentId(nextParentId);

    if (mode === 'edit' && label) {
      applyParentPresentation(nextParentId, byId, {
        ...resolveEditParentInheritance(label),
        setIcon,
        setColor,
      });
      return;
    }

    applyParentPresentation(nextParentId, byId, {
      inheritIcon: true,
      inheritColor: true,
      setIcon,
      setColor,
    });
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      const payload = buildLabelSavePayload(name, parentId, icon, color, byId);
      if (mode === 'create') {
        return apiJson('/api/annotation-labels', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
      }
      return apiJson(`/api/annotation-labels/${label?.id}`, {
        method: 'PUT',
        body: JSON.stringify(payload),
      });
    },
    onSuccess: () => {
      toast.success(t('toast.success'));
      void queryClient.invalidateQueries({ queryKey: ['annotation-labels'] });
      onClose();
    },
    onError: (error: Error) => {
      toast.error(t('toast.error'), { description: error.message, duration: Infinity });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => apiJson(`/api/annotation-labels/${label?.id}`, { method: 'DELETE' }),
    onSuccess: () => {
      toast.success(t('toast.success'));
      void queryClient.invalidateQueries({ queryKey: ['annotation-labels'] });
      onClose();
    },
    onError: (error: Error) => {
      toast.error(t('toast.error'), { description: error.message, duration: Infinity });
    },
  });

  const open = mode === 'create' || label !== null;
  const inUse = (label?.usageCount ?? 0) > 0;
  const hasChildren =
    label !== null && Object.values(byId).some((row) => row.parent_id === label.id);
  const deleteBlocked = inUse || hasChildren;
  const parentPresentation = parentId ? resolveParentPresentation(parentId, byId) : null;
  const inheritsPresentation =
    parentPresentation !== null &&
    icon === parentPresentation.icon &&
    color === parentPresentation.color;
  const dialogTitle = resolveLabelDialogTitle(mode, initialParentId, t);

  return (
    <Dialog
      open={open}
      title={dialogTitle}
      onClose={onClose}
      footer={
        <>
          {mode === 'edit' && label && (
            <button
              type="button"
              className="mr-auto rounded border border-destructive px-3 py-1 text-sm text-destructive disabled:opacity-50"
              disabled={deleteMutation.isPending || deleteBlocked}
              title={deleteBlocked ? t('labels.deleteBlocked') : undefined}
              onClick={() => deleteMutation.mutate()}
            >
              {t('labels.delete')}
            </button>
          )}
          <button type="button" className="rounded border px-3 py-1 text-sm" onClick={onClose}>
            {t('classify.skip')}
          </button>
          <button
            type="button"
            className="rounded bg-primary px-3 py-1 text-sm text-primary-foreground disabled:opacity-50"
            disabled={!name.trim() || saveMutation.isPending}
            onClick={() => saveMutation.mutate()}
          >
            {t('classify.save')}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        {mode === 'edit' && label && deleteBlocked && (
          <p className="text-sm text-muted-foreground">{t('labels.deleteBlocked')}</p>
        )}
        <label className="block space-y-1">
          <span className="text-sm font-medium">{t('dialog.displayName')}</span>
          <input
            className="w-full rounded border border-input px-2 py-1 text-sm"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <label className="block space-y-1">
          <span className="text-sm font-medium">{t('labels.parent')}</span>
          <select
            className="w-full rounded border border-input bg-background px-2 py-1 text-sm"
            value={parentId}
            onChange={(e) => handleParentChange(e.target.value)}
          >
            <option value="">{t('labels.noParent')}</option>
            {parentOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        {inheritsPresentation && (
          <p className="text-xs text-muted-foreground">{t('labels.inheritsPresentation')}</p>
        )}
        <label className="block space-y-1">
          <span className="text-sm font-medium">{t('dialog.color')}</span>
          <div className="flex items-center gap-2">
            <input
              type="color"
              className="h-9 w-14 cursor-pointer rounded border border-input"
              value={color}
              onChange={(e) => setColor(e.target.value)}
            />
            <span className="font-mono text-xs text-muted-foreground">{color}</span>
            <span
              className="inline-flex items-center rounded p-1"
              style={{ backgroundColor: `${color}22`, color }}
            >
              <MaterialIcon name={icon} className="size-5" />
            </span>
          </div>
        </label>
        <div className="space-y-1">
          <span className="text-sm font-medium">{t('dialog.icon')}</span>
          <IconPicker value={icon} onChange={setIcon} />
        </div>
      </div>
    </Dialog>
  );
}
