import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  type FilterMultiSelectItem,
  toLabelPresentation,
} from '../../lib/filter-multi-select-items.js';
import { collectDescendantLabelIds } from '../../lib/label-descendants.js';
import { buildAnnotationLabelOptions } from '../../lib/label-select-options.js';
import { matchesSearch } from '../../lib/normalize.js';
import { useSearchQuery } from '../../lib/use-search-query.js';
import { LabelBadge } from '../labels/LabelBadge.js';
import { Dialog } from '../ui/Dialog.js';
import { EditIconButton } from '../ui/EditIconButton.js';
import { MaterialIcon } from '../ui/IconPicker.js';
import { Tooltip } from '../ui/Tooltip.js';

type FilterMultiSelectFieldProps = {
  readonly label: string;
  readonly dialogTitle: string;
  readonly emptyLabel: string;
  readonly searchPlaceholder: string;
  readonly value: readonly string[];
  readonly onChange: (value: readonly string[]) => void;
  readonly items: readonly FilterMultiSelectItem[];
  readonly cascadeChildrenOnSelect?: boolean;
  readonly singleSelection?: boolean;
};

function FilterIconBadge({
  item,
  onClick,
}: {
  readonly item: FilterMultiSelectItem;
  readonly onClick?: () => void;
}) {
  const chipStyle = {
    color: item.color,
    backgroundColor: `${item.color}20`,
  };
  const badge = (
    <span
      className={`inline-flex size-7 items-center justify-center rounded-md ${onClick ? 'cursor-pointer hover:opacity-80' : 'cursor-default'}`}
      style={chipStyle}
    >
      <MaterialIcon name={item.icon} size={18} />
    </span>
  );

  if (onClick) {
    return (
      <Tooltip content={item.path}>
        <button type="button" className="rounded-md" onClick={onClick}>
          {badge}
        </button>
      </Tooltip>
    );
  }

  return <Tooltip content={item.path}>{badge}</Tooltip>;
}

function FilterMultiSelectDialog({
  open,
  title,
  searchPlaceholder,
  value,
  onChange,
  items,
  cascadeChildrenOnSelect,
  singleSelection,
  onClose,
}: {
  readonly open: boolean;
  readonly title: string;
  readonly searchPlaceholder: string;
  readonly value: readonly string[];
  readonly onChange: (value: readonly string[]) => void;
  readonly items: readonly FilterMultiSelectItem[];
  readonly cascadeChildrenOnSelect: boolean;
  readonly singleSelection: boolean;
  readonly onClose: () => void;
}) {
  const { t } = useTranslation();
  const { query, setQuery, clearQuery } = useSearchQuery({ resetKey: open });
  const selectedIdSet = useMemo(() => new Set(value), [value]);

  const byId = useMemo(() => new Map(items.map((item) => [item.id, item])), [items]);
  const options = useMemo(
    () =>
      buildAnnotationLabelOptions(
        items.map((item) => ({
          id: item.id,
          name: item.name,
          parentId: item.parentId,
          path: item.path,
        })),
      ),
    [items],
  );

  const filteredOptions = useMemo(() => {
    if (!query.trim()) {
      return options;
    }
    return options.filter((option) => {
      const item = byId.get(option.value);
      if (!item) {
        return matchesSearch(option.label, query);
      }
      return (
        matchesSearch(item.path, query) ||
        matchesSearch(item.name, query) ||
        matchesSearch(item.id, query)
      );
    });
  }, [byId, options, query]);

  const toggle = (itemId: string): void => {
    if (singleSelection) {
      onChange(value.includes(itemId) ? [] : [itemId]);
      clearQuery();
      onClose();
      return;
    }
    if (value.includes(itemId)) {
      onChange(value.filter((id) => id !== itemId));
    } else {
      const next = new Set(value);
      next.add(itemId);
      if (cascadeChildrenOnSelect) {
        for (const descendantId of collectDescendantLabelIds(itemId, items)) {
          next.add(descendantId);
        }
      }
      onChange([...next]);
    }
    clearQuery();
  };

  const selectAll = (): void => {
    const next = new Set(value);
    for (const option of filteredOptions) {
      next.add(option.value);
      if (cascadeChildrenOnSelect) {
        for (const descendantId of collectDescendantLabelIds(option.value, items)) {
          next.add(descendantId);
        }
      }
    }
    onChange([...next]);
  };

  const unselectAll = (): void => {
    if (query.trim()) {
      const filteredIds = new Set(filteredOptions.map((option) => option.value));
      onChange(value.filter((id) => !filteredIds.has(id)));
      return;
    }
    onChange([]);
  };

  return (
    <Dialog
      open={open}
      title={title}
      onClose={() => {
        clearQuery();
        onClose();
      }}
      size="lg"
      footer={
        singleSelection ? null : (
          <>
            <button
              type="button"
              className="rounded border border-border px-3 py-1 text-sm hover:bg-accent"
              onClick={selectAll}
            >
              {t('filters.selectAll')}
            </button>
            <button
              type="button"
              className="rounded border border-border px-3 py-1 text-sm hover:bg-accent"
              onClick={unselectAll}
            >
              {t('filters.unselectAll')}
            </button>
          </>
        )
      }
    >
      <div className="space-y-3">
        <input
          type="search"
          className="w-full rounded border border-input bg-background px-2 py-1 text-sm"
          placeholder={searchPlaceholder}
          aria-label={searchPlaceholder}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div className="max-h-96 overflow-auto rounded border border-input bg-background p-2">
          {items.length === 0 ? (
            <p className="text-xs text-muted-foreground">{t('filters.noItems')}</p>
          ) : filteredOptions.length === 0 ? (
            <p className="text-xs text-muted-foreground">{t('filters.noSearchResults')}</p>
          ) : (
            <ul className="space-y-1">
              {filteredOptions.map((option) => {
                const item = byId.get(option.value);
                return (
                  <li key={option.value} style={{ paddingLeft: `${option.depth * 12}px` }}>
                    <label className="flex cursor-pointer items-center gap-2 rounded px-1 py-0.5 hover:bg-accent/40">
                      <input
                        type="checkbox"
                        checked={selectedIdSet.has(option.value)}
                        onChange={() => toggle(option.value)}
                      />
                      {item ? (
                        <LabelBadge label={toLabelPresentation(item)} />
                      ) : (
                        <span className="text-sm">{option.label}</span>
                      )}
                    </label>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </Dialog>
  );
}

export function FilterMultiSelectField({
  label,
  dialogTitle,
  emptyLabel,
  searchPlaceholder,
  value,
  onChange,
  items,
  cascadeChildrenOnSelect = false,
  singleSelection = false,
}: FilterMultiSelectFieldProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const byId = useMemo(() => new Map(items.map((item) => [item.id, item])), [items]);
  const selected = value
    .map((id) => byId.get(id))
    .filter((item): item is FilterMultiSelectItem => item !== undefined);

  const openDialog = (): void => {
    setOpen(true);
  };

  return (
    <>
      <div className="flex flex-col gap-1 text-xs">
        <span className="font-medium text-muted-foreground">{label}</span>
        <div className="flex flex-wrap items-center gap-1">
          {selected.length === 0 ? (
            <button
              type="button"
              className="text-sm text-muted-foreground hover:text-foreground"
              onClick={openDialog}
            >
              {emptyLabel}
            </button>
          ) : (
            <div className="flex flex-wrap items-center gap-1">
              {selected.map((item) => (
                <FilterIconBadge key={item.id} item={item} onClick={openDialog} />
              ))}
            </div>
          )}
          <EditIconButton label={t('filters.editSelection')} onClick={openDialog} />
        </div>
      </div>

      <FilterMultiSelectDialog
        open={open}
        title={dialogTitle}
        searchPlaceholder={searchPlaceholder}
        value={value}
        onChange={onChange}
        items={items}
        cascadeChildrenOnSelect={cascadeChildrenOnSelect}
        singleSelection={singleSelection}
        onClose={() => setOpen(false)}
      />
    </>
  );
}
