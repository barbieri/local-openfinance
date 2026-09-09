import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { apiJson } from '../../lib/api.js';
import { Dialog } from '../ui/Dialog.js';

type ConnectionEditDialogProps = {
  readonly connection: Record<string, unknown> | null;
  readonly onClose: () => void;
};

type ConnectionEditFormState = {
  readonly sourceKey: string;
  readonly name: string;
  readonly branch: string;
  readonly account: string;
};

const EMPTY_CONNECTION_FORM: ConnectionEditFormState = {
  sourceKey: '',
  name: '',
  branch: '',
  account: '',
};

function resolveConnectionEditForm(connection: Record<string, unknown>): ConnectionEditFormState {
  return {
    sourceKey: String(connection.item_id),
    name: String(connection.display_name ?? connection.label_name ?? ''),
    branch: String(connection.branch ?? ''),
    account: String(connection.account ?? ''),
  };
}

export function ConnectionEditDialog({ connection, onClose }: ConnectionEditDialogProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const sourceKey = connection ? String(connection.item_id) : '';
  const [form, setForm] = useState<ConnectionEditFormState>(EMPTY_CONNECTION_FORM);

  if (sourceKey && connection && form.sourceKey !== sourceKey) {
    setForm(resolveConnectionEditForm(connection));
  }

  const mutation = useMutation({
    mutationFn: () =>
      apiJson(`/api/connections/${String(connection?.item_id)}/label`, {
        method: 'PUT',
        body: JSON.stringify({
          name: form.name,
          branch: form.branch,
          account: form.account,
        }),
      }),
    onSuccess: () => {
      toast.success(t('toast.success'));
      void queryClient.invalidateQueries({ queryKey: ['connections'] });
      onClose();
    },
    onError: (error: Error) => {
      toast.error(t('toast.error'), { description: error.message, duration: Infinity });
    },
  });

  return (
    <Dialog
      open={connection !== null}
      title={t('dialog.editConnection')}
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
      <div className="space-y-3">
        <label className="block space-y-1">
          <span className="text-sm font-medium">{t('dialog.displayName')}</span>
          <input
            className="w-full rounded border border-input px-2 py-1 text-sm"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
        </label>
        <label className="block space-y-1">
          <span className="text-sm font-medium">{t('dialog.branch')}</span>
          <input
            className="w-full rounded border border-input px-2 py-1 text-sm"
            value={form.branch}
            onChange={(e) => setForm({ ...form, branch: e.target.value })}
          />
        </label>
        <label className="block space-y-1">
          <span className="text-sm font-medium">{t('dialog.accountNumber')}</span>
          <input
            className="w-full rounded border border-input px-2 py-1 text-sm"
            value={form.account}
            onChange={(e) => setForm({ ...form, account: e.target.value })}
          />
        </label>
      </div>
    </Dialog>
  );
}
