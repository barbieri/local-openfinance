import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Dialog } from './Dialog.js';

type SoftDeleteDialogCommonProps = {
  readonly open: boolean;
  readonly description: string;
  readonly onClose: () => void;
  readonly pending?: boolean;
};

type SoftDeleteDialogProps =
  | (SoftDeleteDialogCommonProps & {
      readonly mode?: 'delete';
      readonly onConfirm: (reason: string) => void;
    })
  | (SoftDeleteDialogCommonProps & {
      readonly mode: 'restore';
      readonly onConfirm: () => void;
    });

export function SoftDeleteDialog(props: SoftDeleteDialogProps) {
  const { open, description, onClose, pending = false } = props;
  const { t } = useTranslation();
  const [reason, setReason] = useState('');
  const restoring = props.mode === 'restore';
  const confirmLabel = resolveConfirmLabel(restoring, pending, t);

  return (
    <Dialog
      open={open}
      title={t(restoring ? 'softDelete.restoreTitle' : 'softDelete.title')}
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
            className={
              restoring
                ? 'rounded bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50'
                : 'rounded bg-destructive px-3 py-1.5 text-sm font-medium text-destructive-foreground disabled:opacity-50'
            }
            disabled={pending}
            onClick={() => {
              if (props.mode === 'restore') {
                props.onConfirm();
              } else {
                props.onConfirm(reason);
              }
            }}
          >
            {confirmLabel}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <p>{description}</p>
        {!restoring ? (
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
        ) : null}
      </div>
    </Dialog>
  );
}

function resolveConfirmLabel(
  restoring: boolean,
  pending: boolean,
  t: ReturnType<typeof useTranslation>['t'],
): string {
  if (restoring) {
    return pending ? t('softDelete.restoring') : t('softDelete.restore');
  }
  return pending ? t('softDelete.deleting') : t('softDelete.confirm');
}
