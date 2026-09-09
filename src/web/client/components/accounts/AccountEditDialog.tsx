import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { apiJson } from '../../lib/api.js';
import { Dialog } from '../ui/Dialog.js';

type AccountEditDialogProps = {
  readonly account: Record<string, unknown> | null;
  readonly onClose: () => void;
};

type AccountEditFormState = {
  readonly sourceKey: string;
  readonly name: string;
};

const EMPTY_ACCOUNT_FORM: AccountEditFormState = { sourceKey: '', name: '' };

function resolveAccountEditForm(account: Record<string, unknown>): AccountEditFormState {
  return {
    sourceKey: String(account.id),
    name: String(account.display_name ?? account.name ?? ''),
  };
}

export function AccountEditDialog({ account, onClose }: AccountEditDialogProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const sourceKey = account ? String(account.id) : '';
  const [form, setForm] = useState<AccountEditFormState>(EMPTY_ACCOUNT_FORM);

  if (sourceKey && account && form.sourceKey !== sourceKey) {
    setForm(resolveAccountEditForm(account));
  }

  const mutation = useMutation({
    mutationFn: () =>
      apiJson(`/api/accounts/${String(account?.id)}/label`, {
        method: 'PUT',
        body: JSON.stringify({ name: form.name }),
      }),
    onSuccess: () => {
      toast.success(t('toast.success'));
      void queryClient.invalidateQueries({ queryKey: ['accounts'] });
      onClose();
    },
    onError: (error: Error) => {
      toast.error(t('toast.error'), { description: error.message, duration: Infinity });
    },
  });

  return (
    <Dialog
      open={account !== null}
      title={t('dialog.editAccount')}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="rounded border px-3 py-1 text-sm" onClick={onClose}>
            {t('classify.skip')}
          </button>
          <button
            type="button"
            className="rounded bg-primary px-3 py-1 text-sm text-primary-foreground"
            disabled={mutation.isPending}
            onClick={() => mutation.mutate()}
          >
            {t('classify.save')}
          </button>
        </>
      }
    >
      <label className="block space-y-1">
        <span className="text-sm font-medium">{t('dialog.displayName')}</span>
        <input
          className="w-full rounded border border-input px-2 py-1 text-sm"
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
        />
      </label>
    </Dialog>
  );
}
