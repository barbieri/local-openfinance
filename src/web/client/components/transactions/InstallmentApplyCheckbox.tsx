import { useTranslation } from 'react-i18next';

export function InstallmentApplyCheckbox({
  totalInstallments,
  checked,
  disabled,
  onChange,
}: {
  readonly totalInstallments: number;
  readonly checked: boolean;
  readonly disabled?: boolean;
  readonly onChange: (checked: boolean) => void;
}) {
  const { t } = useTranslation();

  if (totalInstallments <= 1) {
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
      <span>{t('transactionDetail.applyToAllInstallments', { count: totalInstallments })}</span>
    </label>
  );
}
