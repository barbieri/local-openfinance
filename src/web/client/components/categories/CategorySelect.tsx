import { useId, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { HierarchicalSelectOption } from '../../lib/category-select-options.js';
import { matchesSearch } from '../../lib/normalize.js';
import { useSearchQuery } from '../../lib/use-search-query.js';
import { CategoryBadge } from './CategoryBadge.js';

type CategorySelectProps = {
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly options: readonly HierarchicalSelectOption[];
  readonly emptyLabel: string;
  readonly className?: string;
  readonly id?: string;
  readonly resetKey?: unknown;
  readonly searchable?: boolean;
  readonly showSelected?: boolean;
};

function formatOptionDisplayText(option: HierarchicalSelectOption): string {
  return option.label;
}

function optionPresentation(option: HierarchicalSelectOption) {
  if (!option.presentation) {
    return null;
  }
  return {
    ...option.presentation,
    path: option.presentation.path ?? option.label,
  };
}

function CategorySelectOptionLabel({ option }: { readonly option: HierarchicalSelectOption }) {
  const presentation = optionPresentation(option);
  if (presentation) {
    return <CategoryBadge presentation={presentation} />;
  }
  return <span className="text-sm">{formatOptionDisplayText(option)}</span>;
}

export function CategorySelect({
  value,
  onChange,
  options,
  emptyLabel,
  className,
  id,
  resetKey,
  searchable = true,
  showSelected = true,
}: CategorySelectProps) {
  const { t } = useTranslation();
  const autoId = useId();
  const groupName = id ?? autoId;
  const { query, setQuery, clearQuery } = useSearchQuery({ resetKey });

  const selectedOption = useMemo(
    () => options.find((option) => option.value === value) ?? null,
    [options, value],
  );

  const filteredOptions = useMemo(() => {
    if (!query.trim()) {
      return options;
    }
    return options.filter((option) => {
      return (
        matchesSearch(option.label, query) ||
        matchesSearch(option.value, query) ||
        (option.presentation?.path ? matchesSearch(option.presentation.path, query) : false)
      );
    });
  }, [options, query]);

  const select = (optionValue: string): void => {
    onChange(optionValue);
    clearQuery();
  };

  return (
    <div className={className ?? 'min-w-0 max-w-full space-y-2'}>
      {showSelected && (
        <div className="text-sm">
          {selectedOption ? (
            <CategorySelectOptionLabel option={selectedOption} />
          ) : (
            <span className="text-muted-foreground">{emptyLabel}</span>
          )}
        </div>
      )}
      {searchable && (
        <input
          type="search"
          className="w-full rounded border border-input bg-background px-2 py-1 text-sm"
          placeholder={t('filters.searchCategories')}
          aria-label={t('filters.searchCategories')}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      )}
      <div className="max-h-40 min-w-0 overflow-x-hidden overflow-y-auto rounded border border-input bg-background p-2">
        {options.length === 0 ? (
          <p className="text-xs text-muted-foreground">{t('filters.noItems')}</p>
        ) : (
          <ul className="min-w-0 space-y-1">
            <li>
              <label className="flex min-w-0 cursor-pointer items-center gap-2 rounded px-1 py-0.5 hover:bg-accent/40">
                <input
                  type="radio"
                  className="shrink-0"
                  name={groupName}
                  aria-label={emptyLabel}
                  checked={!value}
                  onChange={() => select('')}
                />
                <span className="min-w-0 flex-1 text-sm text-muted-foreground">{emptyLabel}</span>
              </label>
            </li>
            {filteredOptions.length === 0 ? (
              <li>
                <p className="px-1 py-0.5 text-xs text-muted-foreground">
                  {t('filters.noSearchResults')}
                </p>
              </li>
            ) : (
              filteredOptions.map((option) => (
                <li key={option.value}>
                  <label className="flex min-w-0 cursor-pointer items-center gap-2 rounded px-1 py-0.5 hover:bg-accent/40">
                    <input
                      type="radio"
                      className="shrink-0"
                      name={groupName}
                      aria-label={option.label}
                      checked={value === option.value}
                      onChange={() => select(option.value)}
                    />
                    <span className="min-w-0 flex-1 overflow-hidden">
                      <CategorySelectOptionLabel option={option} />
                    </span>
                  </label>
                </li>
              ))
            )}
          </ul>
        )}
      </div>
    </div>
  );
}

export function CategorySelectField({
  label,
  id,
  resetKey,
  ...props
}: CategorySelectProps & { readonly label: string }) {
  const fieldId = id ?? 'category-select';
  return (
    <div className="flex flex-col gap-1 text-xs min-w-0 max-w-full">
      <span className="font-medium text-muted-foreground">{label}</span>
      <CategorySelect {...props} id={fieldId} resetKey={resetKey} />
    </div>
  );
}
