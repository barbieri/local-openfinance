import { useDeferredValue, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { matchesSearch } from '../../lib/normalize.js';
import { useSearchQuery } from '../../lib/use-search-query.js';
import { MATERIAL_ICON_NAMES, resolveMaterialIcon } from './icon-picker-icons.js';

type IconPickerProps = {
  readonly value: string;
  readonly onChange: (iconId: string) => void;
};

export function IconPicker({ value, onChange }: IconPickerProps) {
  const { t } = useTranslation();
  const { query, setQuery, clearQuery } = useSearchQuery();
  const deferredQuery = useDeferredValue(query);

  const icons = useMemo(() => {
    const normalizedQuery = deferredQuery.trim();
    if (!normalizedQuery) {
      return MATERIAL_ICON_NAMES;
    }
    return MATERIAL_ICON_NAMES.filter((name) =>
      matchesSearch(name.replace(/^Md/, ''), normalizedQuery),
    );
  }, [deferredQuery]);

  return (
    <div className="space-y-2">
      <input
        type="search"
        className="w-full rounded border border-input bg-background px-2 py-1 text-sm"
        placeholder={t('iconPicker.searchPlaceholder')}
        aria-label={t('iconPicker.search')}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <p className="text-xs text-muted-foreground">
        {icons.length} Material icons
        {deferredQuery.trim() ? ` matching “${deferredQuery.trim()}”` : ''}
      </p>
      <div className="grid max-h-48 grid-cols-6 gap-1 overflow-auto rounded border border-border p-2">
        {icons.map((name) => {
          const Icon = resolveMaterialIcon(name);
          const selected = value === name;
          return (
            <button
              key={name}
              type="button"
              title={name}
              className={`flex flex-col items-center gap-0.5 rounded p-1 text-xs ${selected ? 'bg-primary text-primary-foreground' : 'hover:bg-accent'}`}
              onClick={() => {
                onChange(name);
                clearQuery();
              }}
            >
              <Icon className="size-5" />
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function MaterialIcon({
  name,
  className,
  size,
}: {
  readonly name: string;
  readonly className?: string;
  readonly size?: number;
}) {
  const Icon = resolveMaterialIcon(name);
  return <Icon className={className} size={size} aria-hidden />;
}
