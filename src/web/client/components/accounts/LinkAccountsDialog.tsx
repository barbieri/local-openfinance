import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { apiJson } from '../../lib/api.js';
import { Dialog } from '../ui/Dialog.js';

export type LinkSuggestionAccount = {
  readonly id: string;
  readonly display_name: string;
  readonly connection_item_id: string;
  readonly connection_display_name: string | null;
  readonly type: string;
  readonly subtype: string | null;
  readonly transfer_number: string | null;
  readonly canonical_account_id: string | null;
};

export type LinkSuggestionGroup = {
  readonly identity_key: string;
  readonly identity_summary: string;
  readonly accounts: readonly LinkSuggestionAccount[];
};

export type LinkedAccountGroup = {
  readonly canonical_account_id: string;
  readonly canonical_display_name: string;
  readonly alias_account_ids: readonly string[];
  readonly aliases: readonly { readonly id: string; readonly display_name: string }[];
};

type LinkAccountsDialogProps = {
  readonly open: boolean;
  readonly onClose: () => void;
};

type Step =
  | { readonly kind: 'pick' }
  | { readonly kind: 'link'; readonly accounts: readonly LinkSuggestionAccount[] }
  | { readonly kind: 'manage'; readonly group: LinkedAccountGroup };

type WizardData = {
  readonly suggestions: readonly LinkSuggestionGroup[];
  readonly linkedGroups: readonly LinkedAccountGroup[];
};

type LinkAccountsWizardState = {
  readonly step: Step;
  readonly canonicalAccountId: string;
  readonly aliasAccountIds: readonly string[];
  readonly unlinkAliasIds: readonly string[];
  readonly confirmDissolve: boolean;
  readonly wasOpen: boolean;
};

function createInitialLinkWizardFields(): Pick<
  LinkAccountsWizardState,
  'step' | 'canonicalAccountId' | 'aliasAccountIds' | 'unlinkAliasIds' | 'confirmDissolve'
> {
  return {
    step: { kind: 'pick' },
    canonicalAccountId: '',
    aliasAccountIds: [],
    unlinkAliasIds: [],
    confirmDissolve: false,
  };
}

export function LinkAccountsDialog({ open, onClose }: LinkAccountsDialogProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [wizard, setWizard] = useState<LinkAccountsWizardState>({
    ...createInitialLinkWizardFields(),
    wasOpen: false,
  });

  const { step, canonicalAccountId, aliasAccountIds, unlinkAliasIds, confirmDissolve } = wizard;

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['accounts', 'link-wizard'],
    queryFn: () => fetchLinkWizardData(),
    enabled: open,
  });

  if (open && !wizard.wasOpen) {
    setWizard({ ...createInitialLinkWizardFields(), wasOpen: true });
  } else if (!open && wizard.wasOpen) {
    setWizard((prev) => ({ ...prev, wasOpen: false }));
  }

  const linkMutation = useMutation({
    mutationFn: (input: { canonicalAccountId: string; aliasAccountIds: readonly string[] }) =>
      apiJson('/api/accounts/link', {
        method: 'POST',
        body: JSON.stringify({
          canonicalAccountId: input.canonicalAccountId,
          aliasAccountIds: input.aliasAccountIds,
        }),
      }),
    onSuccess: () => {
      toast.success(t('linkAccounts.linked'));
      void queryClient.invalidateQueries({ queryKey: ['accounts'] });
      void queryClient.invalidateQueries({ queryKey: ['credit-cards'] });
      void refetch();
      setWizard((prev) => ({
        ...prev,
        step: { kind: 'pick' },
        canonicalAccountId: '',
        aliasAccountIds: [],
      }));
    },
    onError: (error: Error) => {
      toast.error(t('toast.error'), { description: error.message, duration: Infinity });
    },
  });

  const unlinkMutation = useMutation({
    mutationFn: (ids: readonly string[]) =>
      apiJson('/api/accounts/unlink', {
        method: 'POST',
        body: JSON.stringify({ aliasAccountIds: ids }),
      }),
    onSuccess: (_result, ids) => {
      toast.success(t('linkAccounts.unlinked', { count: ids.length }));
      void queryClient.invalidateQueries({ queryKey: ['accounts'] });
      void queryClient.invalidateQueries({ queryKey: ['credit-cards'] });
      void refetch();
      setWizard((prev) => ({
        ...prev,
        step: { kind: 'pick' },
        unlinkAliasIds: [],
      }));
    },
    onError: (error: Error) => {
      toast.error(t('toast.error'), { description: error.message, duration: Infinity });
    },
  });

  const dissolveMutation = useMutation({
    mutationFn: (canonicalId: string) =>
      apiJson('/api/accounts/dissolve-group', {
        method: 'POST',
        body: JSON.stringify({ canonicalAccountId: canonicalId }),
      }),
    onSuccess: () => {
      toast.success(t('linkAccounts.dissolved'));
      void queryClient.invalidateQueries({ queryKey: ['accounts'] });
      void queryClient.invalidateQueries({ queryKey: ['credit-cards'] });
      void refetch();
      setWizard((prev) => ({
        ...prev,
        step: { kind: 'pick' },
        confirmDissolve: false,
      }));
    },
    onError: (error: Error) => {
      toast.error(t('toast.error'), { description: error.message, duration: Infinity });
    },
  });

  const startLinkStep = (accounts: readonly LinkSuggestionAccount[]): void => {
    const eligible = accounts.filter((account) => !account.canonical_account_id);
    const list = eligible.length >= 2 ? eligible : accounts;
    const [first] = list;
    setWizard((prev) => ({
      ...prev,
      canonicalAccountId: first?.id ?? '',
      aliasAccountIds: list.slice(1).map((account) => account.id),
      step: { kind: 'link', accounts: list },
    }));
  };

  const startManageStep = (group: LinkedAccountGroup): void => {
    setWizard((prev) => ({
      ...prev,
      step: { kind: 'manage', group },
      unlinkAliasIds: [],
      confirmDissolve: false,
    }));
  };

  const backToPick = (): void => {
    setWizard((prev) => ({
      ...prev,
      step: { kind: 'pick' },
      confirmDissolve: false,
      unlinkAliasIds: [],
    }));
  };

  return (
    <Dialog
      open={open}
      title={t('linkAccounts.title')}
      onClose={onClose}
      size="lg"
      footer={
        <LinkAccountsDialogFooter
          step={step}
          confirmDissolve={confirmDissolve}
          canonicalAccountId={canonicalAccountId}
          aliasAccountIds={aliasAccountIds}
          unlinkAliasIds={unlinkAliasIds}
          linkPending={linkMutation.isPending}
          unlinkPending={unlinkMutation.isPending}
          dissolvePending={dissolveMutation.isPending}
          onClose={onClose}
          onBack={backToPick}
          onLink={() =>
            linkMutation.mutate({
              canonicalAccountId,
              aliasAccountIds: aliasAccountIds.filter((id) => id !== canonicalAccountId),
            })
          }
          onUnlink={() => unlinkMutation.mutate(unlinkAliasIds)}
          onDissolve={() => {
            if (step.kind === 'manage') {
              dissolveMutation.mutate(step.group.canonical_account_id);
            }
          }}
          onRequestDissolve={() => setWizard((prev) => ({ ...prev, confirmDissolve: true }))}
        />
      }
    >
      {isLoading && <p className="text-sm text-muted-foreground">{t('linkAccounts.loading')}</p>}
      {step.kind === 'pick' && !isLoading && data && (
        <PickStepContent data={data} onLinkGroup={startLinkStep} onManageGroup={startManageStep} />
      )}
      {step.kind === 'link' && (
        <LinkStepContent
          accounts={step.accounts}
          canonicalAccountId={canonicalAccountId}
          aliasAccountIds={aliasAccountIds}
          onCanonicalChange={(accountId) => {
            setWizard((prev) => ({
              ...prev,
              canonicalAccountId: accountId,
              aliasAccountIds: prev.aliasAccountIds.filter((id) => id !== accountId),
            }));
          }}
          onToggleAlias={(accountId) => {
            setWizard((prev) => ({
              ...prev,
              aliasAccountIds: prev.aliasAccountIds.includes(accountId)
                ? prev.aliasAccountIds.filter((id) => id !== accountId)
                : [...prev.aliasAccountIds, accountId],
            }));
          }}
        />
      )}
      {step.kind === 'manage' && (
        <ManageStepContent
          group={step.group}
          confirmDissolve={confirmDissolve}
          unlinkAliasIds={unlinkAliasIds}
          onToggleUnlink={(accountId) => {
            setWizard((prev) => ({
              ...prev,
              unlinkAliasIds: prev.unlinkAliasIds.includes(accountId)
                ? prev.unlinkAliasIds.filter((id) => id !== accountId)
                : [...prev.unlinkAliasIds, accountId],
            }));
          }}
        />
      )}
    </Dialog>
  );
}

async function fetchLinkWizardData(): Promise<WizardData> {
  const [suggestions, linked] = await Promise.all([
    apiJson<{ groups: LinkSuggestionGroup[] }>('/api/accounts/link-suggestions'),
    apiJson<{ groups: LinkedAccountGroup[] }>('/api/accounts/linked-groups'),
  ]);
  return { suggestions: suggestions.groups, linkedGroups: linked.groups };
}

function PickStepContent({
  data,
  onLinkGroup,
  onManageGroup,
}: {
  readonly data: WizardData;
  readonly onLinkGroup: (accounts: readonly LinkSuggestionAccount[]) => void;
  readonly onManageGroup: (group: LinkedAccountGroup) => void;
}) {
  const { t } = useTranslation();
  const isEmpty = data.suggestions.length === 0 && data.linkedGroups.length === 0;

  return (
    <div className="space-y-4">
      {isEmpty && <p className="text-sm text-muted-foreground">{t('linkAccounts.empty')}</p>}
      {data.suggestions.length > 0 && (
        <section className="space-y-2">
          <h3 className="text-sm font-medium">{t('linkAccounts.suggestionsHeading')}</h3>
          <ul className="space-y-2">
            {data.suggestions.map((group) => (
              <li key={group.identity_key}>
                <button
                  type="button"
                  className="w-full rounded border border-border p-3 text-left hover:bg-muted/50"
                  onClick={() => onLinkGroup(group.accounts)}
                >
                  <div className="text-sm font-medium">{group.identity_summary}</div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {group.accounts.map((account) => account.display_name).join(' · ')}
                  </div>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
      {data.linkedGroups.length > 0 && (
        <section className="space-y-2">
          <h3 className="text-sm font-medium">{t('linkAccounts.linkedHeading')}</h3>
          <ul className="space-y-2">
            {data.linkedGroups.map((group) => (
              <li key={group.canonical_account_id}>
                <button
                  type="button"
                  className="w-full rounded border border-border p-3 text-left hover:bg-muted/50"
                  onClick={() => onManageGroup(group)}
                >
                  <div className="text-sm font-medium">{group.canonical_display_name}</div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {t('linkAccounts.aliasCount', { count: group.alias_account_ids.length })}
                    {' · '}
                    {group.aliases.map((alias) => alias.display_name).join(' · ')}
                  </div>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function LinkStepContent({
  accounts,
  canonicalAccountId,
  aliasAccountIds,
  onCanonicalChange,
  onToggleAlias,
}: {
  readonly accounts: readonly LinkSuggestionAccount[];
  readonly canonicalAccountId: string;
  readonly aliasAccountIds: readonly string[];
  readonly onCanonicalChange: (accountId: string) => void;
  readonly onToggleAlias: (accountId: string) => void;
}) {
  const { t } = useTranslation();
  const aliasAccountIdSet = useMemo(() => new Set(aliasAccountIds), [aliasAccountIds]);
  const aliasAccounts = useMemo(() => {
    const result: LinkSuggestionAccount[] = [];
    for (const account of accounts) {
      if (account.id !== canonicalAccountId) {
        result.push(account);
      }
    }
    return result;
  }, [accounts, canonicalAccountId]);

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">{t('linkAccounts.linkIntro')}</p>
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">{t('linkAccounts.canonicalLegend')}</legend>
        {accounts.map((account) => (
          <label
            key={account.id}
            className="flex cursor-pointer gap-2 rounded border border-border p-3 has-checked:border-primary has-checked:bg-primary/5"
          >
            <input
              type="radio"
              name="canonical-account"
              className="mt-1"
              checked={canonicalAccountId === account.id}
              onChange={() => onCanonicalChange(account.id)}
            />
            <AccountChoiceDetails account={account} />
          </label>
        ))}
      </fieldset>
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">{t('linkAccounts.aliasLegend')}</legend>
        {aliasAccounts.map((account) => (
          <label
            key={account.id}
            className="flex cursor-pointer gap-2 rounded border border-border p-3 has-checked:border-primary has-checked:bg-primary/5"
          >
            <input
              type="checkbox"
              className="mt-1"
              checked={aliasAccountIdSet.has(account.id)}
              onChange={() => onToggleAlias(account.id)}
            />
            <AccountChoiceDetails account={account} />
          </label>
        ))}
      </fieldset>
    </div>
  );
}

function ManageStepContent({
  group,
  confirmDissolve,
  unlinkAliasIds,
  onToggleUnlink,
}: {
  readonly group: LinkedAccountGroup;
  readonly confirmDissolve: boolean;
  readonly unlinkAliasIds: readonly string[];
  readonly onToggleUnlink: (accountId: string) => void;
}) {
  const { t } = useTranslation();
  const unlinkAliasIdSet = useMemo(() => new Set(unlinkAliasIds), [unlinkAliasIds]);

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        {t('linkAccounts.manageIntro', { name: group.canonical_display_name })}
      </p>
      {confirmDissolve && (
        <p className="rounded border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
          {t('linkAccounts.dissolveWarning')}
        </p>
      )}
      {!confirmDissolve && (
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">{t('linkAccounts.unlinkLegend')}</legend>
          {group.aliases.map((alias) => (
            <label
              key={alias.id}
              className="flex cursor-pointer gap-2 rounded border border-border p-3 has-checked:border-primary has-checked:bg-primary/5"
            >
              <input
                type="checkbox"
                className="mt-1"
                checked={unlinkAliasIdSet.has(alias.id)}
                onChange={() => onToggleUnlink(alias.id)}
              />
              <span className="text-sm">{alias.display_name}</span>
            </label>
          ))}
        </fieldset>
      )}
    </div>
  );
}

function LinkAccountsDialogFooter({
  step,
  confirmDissolve,
  canonicalAccountId,
  aliasAccountIds,
  unlinkAliasIds,
  linkPending,
  unlinkPending,
  dissolvePending,
  onClose,
  onBack,
  onLink,
  onUnlink,
  onDissolve,
  onRequestDissolve,
}: {
  readonly step: Step;
  readonly confirmDissolve: boolean;
  readonly canonicalAccountId: string;
  readonly aliasAccountIds: readonly string[];
  readonly unlinkAliasIds: readonly string[];
  readonly linkPending: boolean;
  readonly unlinkPending: boolean;
  readonly dissolvePending: boolean;
  readonly onClose: () => void;
  readonly onBack: () => void;
  readonly onLink: () => void;
  readonly onUnlink: () => void;
  readonly onDissolve: () => void;
  readonly onRequestDissolve: () => void;
}) {
  const { t } = useTranslation();

  if (step.kind === 'pick') {
    return (
      <button type="button" className="rounded border px-3 py-1 text-sm" onClick={onClose}>
        {t('dialog.cancel')}
      </button>
    );
  }

  if (step.kind === 'link') {
    return (
      <>
        <button type="button" className="rounded border px-3 py-1 text-sm" onClick={onBack}>
          {t('linkAccounts.back')}
        </button>
        <button
          type="button"
          className="rounded bg-primary px-3 py-1 text-sm text-primary-foreground disabled:opacity-50"
          disabled={!canonicalAccountId || aliasAccountIds.length === 0 || linkPending}
          onClick={onLink}
        >
          {t('linkAccounts.linkSelected', { count: aliasAccountIds.length })}
        </button>
      </>
    );
  }

  if (confirmDissolve) {
    return (
      <>
        <button type="button" className="rounded border px-3 py-1 text-sm" onClick={onBack}>
          {t('linkAccounts.back')}
        </button>
        <button
          type="button"
          className="rounded bg-destructive px-3 py-1 text-sm text-destructive-foreground disabled:opacity-50"
          disabled={dissolvePending}
          onClick={onDissolve}
        >
          {t('linkAccounts.confirmDissolve')}
        </button>
      </>
    );
  }

  return (
    <>
      <button type="button" className="rounded border px-3 py-1 text-sm" onClick={onBack}>
        {t('linkAccounts.back')}
      </button>
      <button
        type="button"
        className="rounded border px-3 py-1 text-sm disabled:opacity-50"
        disabled={unlinkAliasIds.length === 0 || unlinkPending}
        onClick={onUnlink}
      >
        {t('linkAccounts.unlinkSelected', { count: unlinkAliasIds.length })}
      </button>
      <button
        type="button"
        className="rounded border border-destructive px-3 py-1 text-sm text-destructive"
        onClick={onRequestDissolve}
      >
        {t('linkAccounts.dissolveGroup')}
      </button>
    </>
  );
}

function AccountChoiceDetails({ account }: { readonly account: LinkSuggestionAccount }) {
  const details = [account.type, account.subtype, account.transfer_number]
    .filter(Boolean)
    .join(' · ');
  return (
    <span className="min-w-0 text-sm">
      <span className="font-medium">{account.display_name}</span>
      {account.connection_display_name && (
        <span className="text-muted-foreground"> · {account.connection_display_name}</span>
      )}
      {details && <div className="truncate text-xs text-muted-foreground">{details}</div>}
    </span>
  );
}
