import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Dialog } from './Dialog.js';

export function SoftDeleteDialog({
  open,
  description,
  onClose,
  onConfirm,
  pending = false,
}: {
  readonly open: boolean;
  readonly description: string;
  readonly onClose: () => void;
  readonly onConfirm: (reason: string) => void;
  readonly pending?: boolean;
}) {
  const { t } = useTranslation();
  const [reason, setReason] = useState('');

  return (
    <Dialog
      open={open}
      title={t('softDelete.title')}
      preventClose={pending}
      onClose={() => {
        if (!pending) {
          onClose();
        }
      }}
      footer={
        <>
          <button
            type="button"
            className="rounded border px-3 py-1.5 text-sm disabled:opacity-50"
            disabled={pending}
            onClick={onClose}
          >
            {t('softDelete.cancel')}
          </button>
          <button
            type="button"
            className="rounded bg-destructive px-3 py-1.5 text-sm font-medium text-destructive-foreground disabled:opacity-50"
            disabled={pending}
            onClick={() => onConfirm(reason)}
          >
            {pending ? t('softDelete.deleting') : t('softDelete.confirm')}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <p>{description}</p>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">{t('softDelete.reason')}</span>
          <textarea
            className="min-h-24 rounded border border-input bg-background px-2 py-1.5"
            value={reason}
            maxLength={4000}
            onChange={(event) => setReason(event.target.value)}
            placeholder={t('softDelete.reasonPlaceholder')}
          />
        </label>
      </div>
    </Dialog>
  );
}
