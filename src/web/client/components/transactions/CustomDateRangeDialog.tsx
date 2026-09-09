import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  endOfTodayLocal,
  parseDateTimeLocal,
  startOfTodayLocal,
} from '../../lib/datetime-local.js';
import {
  FIXED_DATE_RANGE_SHORTCUTS,
  resolveBrowserTimeZone,
  resolveFixedDateRangeShortcut,
} from '../../lib/transaction-date-navigation.js';
import { Dialog } from '../ui/Dialog.js';

type CustomDateRangeDialogProps = {
  readonly open: boolean;
  readonly initialStart: string;
  readonly initialEnd: string;
  readonly onClose: () => void;
  readonly onApply: (start: string, end: string) => void;
};

type DateRangeValues = {
  readonly start: string;
  readonly end: string;
};

export function CustomDateRangeDialog({
  open,
  initialStart,
  initialEnd,
  onClose,
  onApply,
}: CustomDateRangeDialogProps) {
  const { t } = useTranslation();
  const [range, setRange] = useState<DateRangeValues>({
    start: initialStart || startOfTodayLocal(),
    end: initialEnd || endOfTodayLocal(),
  });
  const [error, setError] = useState<string | null>(null);
  const timeZone = useMemo(() => resolveBrowserTimeZone(), []);
  const { start, end } = range;

  const applyShortcut = (shortcutId: string): void => {
    const values = resolveFixedDateRangeShortcut(shortcutId, timeZone);
    if (!values) {
      return;
    }
    setRange({ start: values.start, end: values.end });
    setError(null);
  };

  const apply = (): void => {
    const startDate = parseDateTimeLocal(start);
    const endDate = parseDateTimeLocal(end);
    if (!startDate || !endDate) {
      setError(t('dateRange.invalid'));
      return;
    }
    if (startDate.getTime() > endDate.getTime()) {
      setError(t('dateRange.endBeforeStart'));
      return;
    }
    onApply(start, end);
  };

  return (
    <Dialog
      open={open}
      title={t('dateRange.title')}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="rounded border px-3 py-1 text-sm" onClick={onClose}>
            {t('dialog.cancel')}
          </button>
          <button
            type="button"
            className="rounded bg-primary px-3 py-1 text-sm text-primary-foreground"
            onClick={apply}
          >
            {t('dateRange.apply')}
          </button>
        </>
      }
    >
      <div className="space-y-3">
        <div className="space-y-2">
          <span className="text-xs font-medium text-muted-foreground">
            {t('dateRange.shortcuts')}
          </span>
          <div className="flex flex-wrap gap-1.5">
            {FIXED_DATE_RANGE_SHORTCUTS.map((shortcut) => (
              <button
                key={shortcut.id}
                type="button"
                className="rounded border border-input bg-background px-2 py-1 text-xs hover:bg-accent"
                onClick={() => applyShortcut(shortcut.id)}
              >
                {t(shortcut.labelKey)}
              </button>
            ))}
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-muted-foreground">{t('dateRange.start')}</span>
            <input
              type="datetime-local"
              className="rounded border border-input bg-background px-2 py-1"
              value={start}
              onChange={(event) => {
                setRange((prev) => ({ ...prev, start: event.target.value }));
                setError(null);
              }}
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-muted-foreground">{t('dateRange.end')}</span>
            <input
              type="datetime-local"
              className="rounded border border-input bg-background px-2 py-1"
              value={end}
              onChange={(event) => {
                setRange((prev) => ({ ...prev, end: event.target.value }));
                setError(null);
              }}
            />
          </label>
        </div>
      </div>
      {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
    </Dialog>
  );
}
