import { useTranslation } from 'react-i18next';
import { Dialog } from '../ui/Dialog.js';

type TransactionShortcutsDialogProps = {
  readonly open: boolean;
  readonly onClose: () => void;
};

const SHORTCUT_ROWS = [
  { keys: ['/'], labelKey: 'transactions.shortcuts.openSearch' },
  { keys: ['E'], labelKey: 'transactions.shortcuts.editSelected' },
  { keys: ['S'], labelKey: 'transactions.shortcuts.toggleAllSelection' },
  { keys: ['U'], labelKey: 'transactions.shortcuts.selectUnclassified' },
  { keys: ['X'], labelKey: 'transactions.shortcuts.toggleRowSelection' },
  { keys: ['Up', 'Down'], labelKey: 'transactions.shortcuts.navigateRows' },
  { keys: ['Enter', 'Return'], labelKey: 'transactions.shortcuts.editCurrentRow' },
  { keys: ['?', 'H'], labelKey: 'transactions.shortcuts.showHelp' },
  { keys: ['Esc'], labelKey: 'transactions.shortcuts.closeHelp' },
] as const;

export function TransactionShortcutsDialog({ open, onClose }: TransactionShortcutsDialogProps) {
  const { t } = useTranslation();

  return (
    <Dialog open={open} title={t('transactions.shortcuts.title')} onClose={onClose}>
      <div className="space-y-2">
        {SHORTCUT_ROWS.map((row) => (
          <div key={row.labelKey} className="grid grid-cols-[minmax(7rem,auto)_1fr] gap-3 text-sm">
            <div className="flex flex-wrap gap-1">
              {row.keys.map((key) => (
                <kbd
                  key={key}
                  className="min-w-7 rounded border border-border bg-muted px-1.5 py-0.5 text-center font-mono text-xs text-foreground"
                >
                  {key}
                </kbd>
              ))}
            </div>
            <span>{t(row.labelKey)}</span>
          </div>
        ))}
      </div>
    </Dialog>
  );
}
