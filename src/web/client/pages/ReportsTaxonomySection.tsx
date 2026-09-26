import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { isTaxonomyTreatment } from '../../../intelligence/taxonomy-treatment.js';
import { CategoryBadge } from '../components/categories/CategoryBadge.js';
import { LabelBadge } from '../components/labels/LabelBadge.js';
import { apiJson } from '../lib/api.js';
import { withLocaleQuery } from '../lib/api-locale.js';
import {
  matchesTaxonomyDecisionFilter,
  parseTaxonomyKindFilter,
  parseTaxonomyTreatmentFilter,
  type TaxonomyDecisionFilter,
  type TaxonomyKind,
  type TaxonomyTreatment,
} from '../lib/report-taxonomy-filter.js';

type TaxonomyPolicyResponse = {
  readonly reportId: string;
  readonly generatedAt: string;
  readonly updatedAt: string;
  readonly treatments: readonly TaxonomyTreatment[];
  readonly decisions: readonly TaxonomyPolicyDecision[];
};

type TaxonomyPolicyDecision = {
  readonly kind: TaxonomyKind;
  readonly id: string;
  readonly name: string;
  readonly path: string;
  readonly icon: string;
  readonly color: string;
  readonly treatment: TaxonomyTreatment;
  readonly confidence: number;
  readonly reason: string;
  readonly source: 'generated' | 'user';
};

export function ReportsTaxonomySection({ reportId }: { readonly reportId: string }) {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<TaxonomyDecisionFilter>({
    treatment: 'all',
    kind: 'all',
    search: '',
  });
  const endpoint = `/api/intelligence/reports/${encodeURIComponent(reportId)}/taxonomy-policy`;
  const localizedEndpoint = withLocaleQuery(endpoint, i18n.language);
  const queryKey = ['intelligence-taxonomy-policy', reportId, i18n.language] as const;
  const { data, isLoading, isError, error } = useQuery({
    queryKey,
    queryFn: () => apiJson<TaxonomyPolicyResponse>(localizedEndpoint),
  });
  const updateMutation = useMutation({
    mutationFn: (input: {
      readonly kind: TaxonomyKind;
      readonly id: string;
      readonly treatment: TaxonomyTreatment;
    }) =>
      apiJson<TaxonomyPolicyResponse>(withLocaleQuery(`${endpoint}/decisions`, i18n.language), {
        method: 'PUT',
        body: JSON.stringify(input),
      }),
    onSuccess: (policy) => {
      queryClient.setQueryData(queryKey, policy);
      toast.success(t('reports.taxonomySaved'));
    },
    onError: (mutationError: Error) =>
      toast.error(t('toast.error'), { description: mutationError.message }),
  });
  const clearMutation = useMutation({
    mutationFn: (input: { readonly kind: TaxonomyKind; readonly id: string }) =>
      apiJson<TaxonomyPolicyResponse>(
        withLocaleQuery(
          `${endpoint}/decisions/${input.kind}/${encodeURIComponent(input.id)}`,
          i18n.language,
        ),
        { method: 'DELETE' },
      ),
    onSuccess: (policy) => {
      queryClient.setQueryData(queryKey, policy);
      toast.success(t('reports.taxonomyCleared'));
    },
    onError: (mutationError: Error) =>
      toast.error(t('toast.error'), { description: mutationError.message }),
  });

  if (isLoading) return <p className="text-sm text-muted-foreground">{t('reports.loading')}</p>;
  if (isError || !data) {
    return (
      <p className="text-sm text-destructive">
        {error instanceof Error ? error.message : t('toast.error')}
      </p>
    );
  }
  const visibleDecisions = data.decisions.filter((decision) =>
    matchesTaxonomyDecisionFilter(decision, filter),
  );
  const groups = groupTaxonomyDecisions(visibleDecisions);
  return (
    <section className="space-y-4">
      <div>
        <h3 className="font-semibold">{t('reports.taxonomyTitle')}</h3>
        <p className="text-sm text-muted-foreground">{t('reports.taxonomyExplanation')}</p>
      </div>
      <div className="grid gap-3 rounded-lg border border-border bg-muted/30 p-3 sm:grid-cols-3">
        <label className="space-y-1 text-sm">
          <span className="font-medium">{t('reports.taxonomyFilterTreatment')}</span>
          <select
            className="w-full rounded border border-input bg-background px-2 py-1.5"
            value={filter.treatment}
            onChange={(event) => {
              const treatment = parseTaxonomyTreatmentFilter(event.target.value);
              if (treatment) setFilter((current) => ({ ...current, treatment }));
            }}
          >
            <option value="all">{t('reports.taxonomyFilterAll')}</option>
            {data.treatments.map((treatment) => (
              <option key={treatment} value={treatment}>
                {t(`reports.taxonomyTreatment.${treatment}`)}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1 text-sm">
          <span className="font-medium">{t('reports.taxonomyFilterKind')}</span>
          <select
            className="w-full rounded border border-input bg-background px-2 py-1.5"
            value={filter.kind}
            onChange={(event) => {
              const kind = parseTaxonomyKindFilter(event.target.value);
              if (kind) setFilter((current) => ({ ...current, kind }));
            }}
          >
            <option value="all">{t('reports.taxonomyFilterAll')}</option>
            <option value="category">{t('reports.taxonomyKind.category')}</option>
            <option value="label">{t('reports.taxonomyKind.label')}</option>
          </select>
        </label>
        <label className="space-y-1 text-sm">
          <span className="font-medium">{t('reports.taxonomyFilterSearch')}</span>
          <input
            type="search"
            className="w-full rounded border border-input bg-background px-2 py-1.5"
            value={filter.search}
            placeholder={t('reports.taxonomyFilterSearchPlaceholder')}
            onChange={(event) =>
              setFilter((current) => ({ ...current, search: event.target.value }))
            }
          />
        </label>
        <p className="text-xs text-muted-foreground sm:col-span-3">
          {t('reports.taxonomyFilterCount', {
            visible: visibleDecisions.length,
            total: data.decisions.length,
          })}
        </p>
      </div>
      {visibleDecisions.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
          {t('reports.taxonomyNoMatches')}
        </p>
      ) : null}
      {[...groups.values()].map(({ kind, root, decisions }) => (
        <div key={`${kind}:${root}`} className="space-y-2">
          <h4 className="flex items-center gap-2 text-sm font-semibold">
            <span className="rounded bg-muted px-2 py-0.5 text-xs font-medium">
              {t(`reports.taxonomyKind.${kind}`)}
            </span>
            <span>{root}</span>
          </h4>
          <ul className="divide-y divide-border rounded-lg border border-border">
            {decisions.map((decision) => (
              <li key={`${decision.kind}:${decision.id}`} className="space-y-2 p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="w-28 shrink-0 rounded bg-muted px-2 py-0.5 text-center text-xs font-medium">
                    {t(`reports.taxonomyKind.${decision.kind}`)}
                  </span>
                  <div className="flex min-w-0 flex-1 items-center gap-2">
                    {decision.kind === 'category' ? (
                      <CategoryBadge
                        presentation={{
                          name: decision.name,
                          path: decision.path,
                          icon: decision.icon,
                          color: decision.color,
                        }}
                        variant="icon"
                      />
                    ) : (
                      <LabelBadge
                        label={{
                          id: decision.id,
                          name: decision.name,
                          path: decision.path,
                          icon: decision.icon,
                          color: decision.color,
                        }}
                        variant="icon"
                      />
                    )}
                    <span className="truncate text-sm">{decision.path}</span>
                  </div>
                  <span className="rounded bg-muted px-2 py-0.5 text-xs">
                    {t(`reports.taxonomySource.${decision.source}`)}
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <select
                    className="rounded border border-input bg-background px-2 py-1 text-sm"
                    aria-label={t('reports.taxonomyTreatmentFor', { path: decision.path })}
                    value={decision.treatment}
                    onChange={(event) => {
                      const treatment = event.target.value;
                      if (!isTaxonomyTreatment(treatment)) return;
                      updateMutation.mutate({
                        kind: decision.kind,
                        id: decision.id,
                        treatment,
                      });
                    }}
                  >
                    {data.treatments.map((treatment) => (
                      <option key={treatment} value={treatment}>
                        {t(`reports.taxonomyTreatment.${treatment}`)}
                      </option>
                    ))}
                  </select>
                  {decision.source === 'user' ? (
                    <button
                      type="button"
                      className="rounded border px-2 py-1 text-sm hover:bg-accent"
                      onClick={() => clearMutation.mutate({ kind: decision.kind, id: decision.id })}
                    >
                      {t('reports.taxonomyClearOverride')}
                    </button>
                  ) : null}
                </div>
                <p className="text-xs text-muted-foreground">{decision.reason}</p>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}

function groupTaxonomyDecisions(decisions: readonly TaxonomyPolicyDecision[]): ReadonlyMap<
  string,
  {
    readonly kind: TaxonomyKind;
    readonly root: string;
    readonly decisions: TaxonomyPolicyDecision[];
  }
> {
  const groups = new Map<
    string,
    {
      readonly kind: TaxonomyKind;
      readonly root: string;
      readonly decisions: TaxonomyPolicyDecision[];
    }
  >();
  for (const decision of decisions) {
    const root = decision.path.split(' > ')[0] ?? '';
    const key = `${decision.kind}:${root}`;
    const group = groups.get(key);
    if (group) group.decisions.push(decision);
    else groups.set(key, { kind: decision.kind, root, decisions: [decision] });
  }
  return groups;
}
