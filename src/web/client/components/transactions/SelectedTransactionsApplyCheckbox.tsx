import { useTranslation } from 'react-i18next';

export function SelectedTransactionsApplyCheckbox({
  count,
  checked,
  disabled,
  onChange,
}: {
  readonly count: number;
  readonly checked: boolean;
  readonly disabled?: boolean;
  readonly onChange: (checked: boolean) => void;
}) {
  const { t } = useTranslation();

  if (count <= 0) {
    return null;
  }

  return (
    <label className="flex items-center gap-2 text-sm">
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span>{t('transactionDetail.applyToSelectedTransactions', { count })}</span>
    </label>
  );
}
