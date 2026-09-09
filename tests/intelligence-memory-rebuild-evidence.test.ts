import { describe, expect, it } from 'vitest';
import {
  buildMemoryRebuildEvidence,
  MEMORY_REBUILD_EVIDENCE_MAX_BYTES,
  MEMORY_REBUILD_THREADS_PER_LANE,
} from '../src/intelligence/memory-rebuild-evidence.js';
import type {
  ReportAnalysis,
  ReportCandidate,
  ReportProfile,
} from '../src/intelligence/report-analysis-types.js';

const emptySummary = {
  expense: 'R$ 0,00',
  income: 'R$ 0,00',
  refund: 'R$ 0,00',
  expenseDelta: 'R$ 0,00',
  expenseRatio: null,
  incomeDelta: 'R$ 0,00',
  incomeRatio: null,
};

function profile(key: string, path = key): ReportProfile {
  const [kind = 'category', id = key] = key.split(':');
  return {
    key,
    kind: kind === 'label' ? 'label' : 'category',
    id,
    path,
    depth: 1,
    pattern: 'monthly-recurring',
    basis: 'month',
    stats: {
      n: 4,
      averageCents: 10_000,
      standardDeviationCents: 0,
      medianCents: 10_000,
      minCents: 10_000,
      maxCents: 10_000,
    },
    history: {
      facts: 4,
      first: '2026-01-01',
      last: '2026-04-01',
      activeMonths: 4,
      spanMonths: 4,
      monthlyCoverage: 1,
      bursts: 0,
    },
    current: {
      facts: 1,
      cents: 10_000,
      comparable: true,
      deltaCents: 0,
      deltaRatio: 0,
      zScore: 0,
      expectedness: 'within-range',
    },
  };
}

function candidate(input: {
  readonly id: string;
  readonly importance: number;
  readonly kind?: ReportCandidate['kind'] | undefined;
  readonly profileRefs?: readonly string[] | undefined;
  readonly title?: string | undefined;
  readonly party?: string | undefined;
  readonly signal?: ReportCandidate['signal'] | undefined;
}): ReportCandidate {
  const kind = input.kind ?? 'transaction';
  const profileRefs = input.profileRefs ?? [];
  return {
    id: input.id,
    kind,
    importance: input.importance,
    title: input.title ?? input.id,
    amount: 'R$ 100,00',
    signal: input.signal ?? 'unusual',
    transactionIds: [],
    profileRefs,
    ...(profileRefs[0] ? { preferredProfileRef: profileRefs[0] } : {}),
    evidence: ['Selected deterministic evidence.'],
    ...(kind === 'transaction'
      ? {
          driver: {
            date: '2026-01-01',
            party: input.party ?? input.id,
            href: `#/transaction/${input.id}`,
            labels: [],
            classification: 'confirmed' as const,
            partyHistory: {
              count: 1,
              first: '2026-01-01',
              last: '2026-01-01',
              average: 'R$ 100,00',
            },
          },
        }
      : {}),
  };
}

function analysis(input: {
  readonly start: string;
  readonly candidates: readonly ReportCandidate[];
  readonly mustReport?: readonly string[] | undefined;
  readonly profiles?: readonly ReportProfile[] | undefined;
}): ReportAnalysis {
  return {
    period: { start: input.start, end: input.start, cadence: 'weekly' },
    language: 'pt-BR',
    currency: 'BRL',
    summary: emptySummary,
    candidates: input.candidates,
    profiles: input.profiles ?? [],
    mustInspect: [],
    mustReport: input.mustReport ?? input.candidates.map((item) => item.id),
    classification: {
      confirmed: 0,
      'accepted-suggestion': 0,
      'assumed-suggestion': 0,
      unclassified: 0,
    },
    excluded: {
      internal: { structural: 0, semantic: 0 },
      portfolio: 0,
      settlements: 0,
    },
    chart: [],
  };
}

describe('memory rebuild evidence', () => {
  it('uses only mustReport candidates and keeps every emitted profile reference valid', () => {
    const selectedProfile = profile('category:selected', 'Expenses > Selected');
    const selected = candidate({
      id: 'selected',
      importance: 10,
      profileRefs: [selectedProfile.key],
    });
    const partiallyResolved = candidate({
      id: 'partially-resolved',
      importance: 9,
      profileRefs: [selectedProfile.key, 'category:missing'],
    });
    const ignored = candidate({ id: 'ignored', importance: 100 });

    const evidence = buildMemoryRebuildEvidence([
      analysis({
        start: '2026-01-05',
        candidates: [ignored, selected, partiallyResolved],
        mustReport: [selected.id, partiallyResolved.id],
        profiles: [selectedProfile],
      }),
    ]);
    const observations = Object.values(evidence.value.lanes).flatMap((threads) =>
      threads.flatMap((thread) => thread.observations),
    );
    const profileKeys = new Set(evidence.value.profiles.map((item) => item.key));

    expect(observations.map((item) => item.id)).toEqual(['selected', 'partially-resolved']);
    expect(evidence.stats.candidateInputs).toBe(2);
    expect(observations.flatMap((item) => item.profileRefs)).toSatisfy((refs: string[]) =>
      refs.every((ref) => profileKeys.has(ref)),
    );
  });

  it('keeps earliest, highest-importance, and latest observations in stable lane order', () => {
    const recurringProfile = profile('category:recurring', 'Expenses > Recurring');
    const periods = [
      ['2026-01-05', 'earliest', 10],
      ['2026-01-12', 'highest', 100],
      ['2026-01-19', 'middle', 20],
      ['2026-01-26', 'latest', 5],
    ] as const;
    const analyses = periods.map(([start, id, importance]) =>
      analysis({
        start,
        candidates: [
          candidate({
            id,
            importance,
            kind: 'aggregate',
            profileRefs: [recurringProfile.key],
          }),
        ],
        profiles: [recurringProfile],
      }),
    );
    const relationship = analysis({
      start: '2026-02-02',
      candidates: [candidate({ id: 'offset', importance: 200, kind: 'offset' })],
    });
    const exception = analysis({
      start: '2026-02-09',
      candidates: [candidate({ id: 'exception', importance: 300, party: 'One off' })],
    });

    const forward = buildMemoryRebuildEvidence([...analyses, relationship, exception]);
    const reversed = buildMemoryRebuildEvidence([
      exception,
      relationship,
      ...analyses.toReversed(),
    ]);
    const recurringThread = forward.value.lanes.recurrence[0];
    const allThreads = Object.values(forward.value.lanes).flat();

    expect(forward.json).toBe(reversed.json);
    expect(recurringThread?.observations.map((item) => item.id)).toEqual([
      'earliest',
      'highest',
      'latest',
    ]);
    expect(
      Object.values(forward.value.lanes).every(
        (threads) => threads.length <= MEMORY_REBUILD_THREADS_PER_LANE,
      ),
    ).toBe(true);
    expect(new Set(allThreads.map((thread) => thread.key)).size).toBe(allThreads.length);
  });

  it('enforces the JSON cap in UTF-8 bytes with atomic candidate and profile bundles', () => {
    const emoji = '🥭'.repeat(2_000);
    const analyses = Array.from({ length: 40 }, (_, index) => {
      const key = `category:${index.toString().padStart(2, '0')}`;
      return analysis({
        start: `2026-03-${String((index % 28) + 1).padStart(2, '0')}`,
        candidates: [
          candidate({
            id: `candidate-${index}`,
            importance: 1_000 - index,
            profileRefs: [key],
            title: `${index}-${emoji}`,
            party: `${index}-${emoji}`,
          }),
        ],
        profiles: [profile(key, `${index}-${emoji}`)],
      });
    });

    const evidence = buildMemoryRebuildEvidence(analyses);
    const parsed = JSON.parse(evidence.json) as typeof evidence.value;
    const profileKeys = new Set(parsed.profiles.map((item) => item.key));
    const refs = Object.values(parsed.lanes).flatMap((threads) =>
      threads.flatMap((thread) =>
        thread.observations.flatMap((observation) => observation.profileRefs),
      ),
    );

    expect(evidence.jsonBytes).toBe(Buffer.byteLength(evidence.json, 'utf8'));
    expect(evidence.jsonBytes).toBeLessThanOrEqual(MEMORY_REBUILD_EVIDENCE_MAX_BYTES);
    expect(evidence.jsonBytes).toBeGreaterThan(evidence.json.length);
    expect(refs.every((ref) => profileKeys.has(ref))).toBe(true);
  });
});
