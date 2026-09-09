import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { collectDescendantLabelIds } from '../../lib/label-descendants.js';
import { buildAnnotationLabelOptions } from '../../lib/label-select-options.js';
import { matchesSearch } from '../../lib/normalize.js';
import { useSearchQuery } from '../../lib/use-search-query.js';
import { LabelBadge, LabelBadgeList, type LabelPresentation } from './LabelBadge.js';

type LabelRecord = LabelPresentation & {
  readonly parent_id?: string | null;
};

type LabelMultiSelectProps = {
  readonly value: readonly string[];
  readonly onChange: (value: readonly string[]) => void;
  readonly byId: Record<string, LabelRecord>;
  readonly className?: string;
  readonly searchable?: boolean;
  readonly cascadeChildrenOnSelect?: boolean;
  readonly resetKey?: unknown;
};

export function LabelMultiSelect({
  value,
  onChange,
  byId,
  className,
  searchable = true,
  cascadeChildrenOnSelect = false,
  resetKey,
}: LabelMultiSelectProps) {
  const { t } = useTranslation();
  const { query, setQuery, clearQuery } = useSearchQuery({ resetKey });
  const rows = Object.values(byId);
  const selectedIdSet = useMemo(() => new Set(value), [value]);
  const options = buildAnnotationLabelOptions(
    rows.map((row) => ({
      id: row.id,
      name: row.name,
      parentId: row.parent_id ?? null,
      path: row.path,
    })),
  );
  const selected = value
    .map((id) => byId[id])
    .filter((label): label is LabelRecord => label !== undefined);

  const filteredOptions = useMemo(() => {
    if (!query.trim()) {
      return options;
    }
    return options.filter((option) => {
      const label = byId[option.value];
      if (!label) {
        return matchesSearch(option.label, query);
      }
      return (
        matchesSearch(label.path, query) ||
        matchesSearch(label.name, query) ||
        matchesSearch(label.id, query)
      );
    });
  }, [byId, options, query]);

  const toggle = (labelId: string): void => {
    if (selectedIdSet.has(labelId)) {
      onChange(value.filter((id) => id !== labelId));
    } else {
      const next = new Set(value);
      next.add(labelId);
      if (cascadeChildrenOnSelect) {
        for (const descendantId of collectDescendantLabelIds(labelId, rows)) {
          next.add(descendantId);
        }
      }
      onChange([...next]);
    }
    clearQuery();
  };

  const removeLabel = (labelId: string): void => {
    onChange(value.filter((id) => id !== labelId));
  };

  return (
    <div className={className ?? 'min-w-0 max-w-full space-y-2'}>
      {selected.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <LabelBadgeList labels={selected} onRemove={removeLabel} />
          <button
            type="button"
            className="text-xs text-muted-foreground underline-offset-2 hover:underline"
            onClick={() => onChange([])}
          >
            {t('labels.unselectAll')}
          </button>
        </div>
      )}
      {searchable && (
        <input
          type="search"
          className="w-full rounded border border-input bg-background px-2 py-1 text-sm"
          placeholder={t('filters.searchLabels')}
          aria-label={t('filters.searchLabels')}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      )}
      <div className="max-h-40 min-w-0 overflow-x-hidden overflow-y-auto rounded border border-input bg-background p-2">
        {options.length === 0 ? (
          <p className="text-xs text-muted-foreground">{t('labels.empty')}</p>
        ) : filteredOptions.length === 0 ? (
          <p className="text-xs text-muted-foreground">{t('labels.noSearchResults')}</p>
        ) : (
          <ul className="min-w-0 space-y-1">
            {filteredOptions.map((option) => {
              const label = byId[option.value];
              return (
                <li key={option.value}>
                  <label className="flex min-w-0 cursor-pointer items-center gap-2 rounded px-1 py-0.5 hover:bg-accent/40">
                    <input
                      type="checkbox"
                      className="shrink-0"
                      checked={selectedIdSet.has(option.value)}
                      onChange={() => toggle(option.value)}
                    />
                    <span className="min-w-0 flex-1 overflow-hidden">
                      {label ? (
                        <LabelBadge label={label} />
                      ) : (
                        <span className="block truncate text-sm">{option.label}</span>
                      )}
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

export function LabelMultiSelectField({
  label,
  ...props
}: LabelMultiSelectProps & { readonly label: string }) {
  return (
    <div className="flex flex-col gap-1 text-xs">
      <span className="font-medium text-muted-foreground">{label}</span>
      <LabelMultiSelect {...props} />
    </div>
  );
}
