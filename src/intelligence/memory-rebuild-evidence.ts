import type { ReportAnalysis, ReportCandidate, ReportProfile } from './report-analysis-types.js';

export const MEMORY_REBUILD_EVIDENCE_MAX_BYTES = 64 * 1024;
export const MEMORY_REBUILD_THREADS_PER_LANE = 8;

const MAX_OBSERVATIONS_PER_THREAD = 3;
const MAX_EVIDENCE_LINES = 4;
const MAX_LABELS = 8;
const MAX_SHORT_TEXT = 240;
const MAX_LONG_TEXT = 500;
const utf8Encoder = new TextEncoder();

type EvidenceLane = 'relationship' | 'recurrence' | 'exception';

export type MemoryEvidenceObservation = {
  readonly id: string;
  readonly period: ReportAnalysis['period'];
  readonly kind: ReportCandidate['kind'];
  readonly importance: number;
  readonly title: string;
  readonly amount: string;
  readonly baseline?: string | undefined;
  readonly delta?: string | undefined;
  readonly ratio?: string | undefined;
  readonly signal: ReportCandidate['signal'];
  readonly profileRefs: readonly string[];
  readonly preferredProfileRef?: string | undefined;
  readonly evidence: readonly string[];
  readonly driver?:
    | {
        readonly date: string;
        readonly party: string;
        readonly detail?: string | undefined;
        readonly installment?: string | undefined;
        readonly category?: string | undefined;
        readonly labels: readonly string[];
        readonly classification: NonNullable<ReportCandidate['driver']>['classification'];
        readonly partyHistory: NonNullable<ReportCandidate['driver']>['partyHistory'];
      }
    | undefined;
};

export type MemoryEvidenceThread = {
  readonly key: string;
  readonly subject: string;
  readonly kind: ReportCandidate['kind'];
  readonly appearances: number;
  readonly firstPeriod: string;
  readonly lastPeriod: string;
  readonly observations: readonly MemoryEvidenceObservation[];
};

export type MemoryEvidenceProfile = Pick<
  ReportProfile,
  'key' | 'kind' | 'id' | 'pattern' | 'basis' | 'history' | 'current'
> & {
  readonly path: string;
};

export type MemoryRebuildEvidenceValue = {
  readonly version: 1;
  readonly coverage: {
    readonly periods: number;
    readonly candidatePeriods: number;
    readonly candidates: number;
  };
  readonly lanes: Readonly<Record<EvidenceLane, readonly MemoryEvidenceThread[]>>;
  readonly profiles: readonly MemoryEvidenceProfile[];
  readonly omitted: {
    readonly threads: number;
    readonly candidates: number;
  };
};

export type MemoryRebuildEvidenceStats = {
  readonly candidatePeriods: number;
  readonly candidateInputs: number;
  readonly includedThreads: number;
  readonly includedCandidates: number;
  readonly includedProfiles: number;
  readonly omittedCandidates: number;
  readonly jsonBytes: number;
};

export type BoundedMemoryEvidence = {
  readonly value: MemoryRebuildEvidenceValue;
  readonly json: string;
  readonly jsonBytes: number;
  readonly stats: MemoryRebuildEvidenceStats;
};

type InternalObservation = MemoryEvidenceObservation;

type RankedThread = MemoryEvidenceThread & {
  readonly maxImportance: number;
  readonly recurringProfile: boolean;
};

type SelectedThread = {
  readonly lane: EvidenceLane;
  readonly thread: RankedThread;
};

type CollectedThreads = {
  readonly candidatePeriods: number;
  readonly candidateInputs: number;
  readonly threads: readonly RankedThread[];
};

export function buildMemoryRebuildEvidence(
  analyses: readonly ReportAnalysis[],
): BoundedMemoryEvidence {
  const orderedAnalyses = analyses.toSorted(compareAnalyses);
  const profiles = collectLatestProfiles(orderedAnalyses);
  const { candidatePeriods, candidateInputs, threads } = collectThreads(orderedAnalyses, profiles);
  const selected = selectLaneThreads(threads);
  const packed: SelectedThread[] = [];
  const packedProfileKeys = new Set<string>();

  for (const selection of selected) {
    const requiredProfileKeys = selection.thread.observations
      .flatMap((observation) => observation.profileRefs)
      .toSorted((left, right) => left.localeCompare(right));
    const nextProfileKeys = new Set(packedProfileKeys);
    for (const key of requiredProfileKeys) nextProfileKeys.add(key);
    const tentative = makeEvidenceValue({
      periods: analyses.length,
      candidatePeriods,
      candidateInputs,
      totalThreads: threads.length,
      selected: [...packed, selection],
      profileKeys: nextProfileKeys,
      profiles,
    });
    if (utf8Bytes(JSON.stringify(tentative)) > MEMORY_REBUILD_EVIDENCE_MAX_BYTES) continue;
    packed.push(selection);
    for (const key of requiredProfileKeys) packedProfileKeys.add(key);
  }

  const value = makeEvidenceValue({
    periods: analyses.length,
    candidatePeriods,
    candidateInputs,
    totalThreads: threads.length,
    selected: packed,
    profileKeys: packedProfileKeys,
    profiles,
  });
  const json = JSON.stringify(value);
  const jsonBytes = utf8Bytes(json);
  if (jsonBytes > MEMORY_REBUILD_EVIDENCE_MAX_BYTES) {
    throw new Error('The fixed memory evidence shell exceeds its UTF-8 byte limit.');
  }
  const includedCandidates = packed.reduce(
    (sum, selection) => sum + selection.thread.observations.length,
    0,
  );
  return {
    value,
    json,
    jsonBytes,
    stats: {
      candidatePeriods,
      candidateInputs,
      includedThreads: packed.length,
      includedCandidates,
      includedProfiles: packedProfileKeys.size,
      omittedCandidates: candidateInputs - includedCandidates,
      jsonBytes,
    },
  };
}

function collectThreads(
  analyses: readonly ReportAnalysis[],
  profiles: ReadonlyMap<string, MemoryEvidenceProfile>,
): CollectedThreads {
  const grouped = new Map<string, InternalObservation[]>();
  let candidatePeriods = 0;
  let candidateInputs = 0;
  for (const analysis of analyses) {
    const mustReport = new Set(analysis.mustReport);
    const candidates = analysis.candidates
      .filter((candidate) => mustReport.has(candidate.id))
      .toSorted(compareCandidates);
    if (candidates.length > 0) candidatePeriods += 1;
    candidateInputs += candidates.length;
    for (const candidate of candidates) {
      const observation = compactObservation(analysis, candidate, profiles);
      if (!observation) continue;
      const key = threadKey(candidate);
      const entries = grouped.get(key) ?? [];
      entries.push(observation);
      grouped.set(key, entries);
    }
  }
  return {
    candidatePeriods,
    candidateInputs,
    threads: [...grouped.entries()]
      .map(([key, observations]) => buildThread(key, observations, profiles))
      .toSorted((left, right) => left.key.localeCompare(right.key)),
  };
}

function collectLatestProfiles(
  analyses: readonly ReportAnalysis[],
): ReadonlyMap<string, MemoryEvidenceProfile> {
  const profiles = new Map<
    string,
    { readonly period: string; readonly value: MemoryEvidenceProfile }
  >();
  for (const analysis of analyses) {
    const periodEnd = analysis.period.end;
    for (const source of analysis.profiles.toSorted((left, right) =>
      left.key.localeCompare(right.key),
    )) {
      const key = source.key;
      const value = compactProfile(source);
      const current = profiles.get(key);
      const serialized = JSON.stringify(value);
      const currentSerialized = current ? JSON.stringify(current.value) : '';
      if (
        !current ||
        periodEnd > current.period ||
        (periodEnd === current.period && serialized < currentSerialized)
      ) {
        profiles.set(key, { period: periodEnd, value });
      }
    }
  }
  return new Map(
    [...profiles.entries()]
      .toSorted(([left], [right]) => left.localeCompare(right))
      .map(([key, snapshot]) => [key, snapshot.value]),
  );
}

function compactProfile(profile: ReportProfile): MemoryEvidenceProfile {
  return {
    key: profile.key,
    kind: profile.kind,
    id: profile.id,
    path: compactText(profile.path, MAX_LONG_TEXT),
    pattern: profile.pattern,
    basis: profile.basis,
    history: profile.history,
    current: profile.current,
  };
}

function compactObservation(
  analysis: ReportAnalysis,
  candidate: ReportCandidate,
  profiles: ReadonlyMap<string, MemoryEvidenceProfile>,
): InternalObservation {
  const profileRefs = [...new Set(candidate.profileRefs)]
    .filter((key) => profiles.has(key))
    .toSorted((left, right) => left.localeCompare(right));
  const preferredProfileRef =
    candidate.preferredProfileRef && profileRefs.includes(candidate.preferredProfileRef)
      ? candidate.preferredProfileRef
      : undefined;
  const driver = candidate.driver;
  return {
    id: compactText(candidate.id, MAX_SHORT_TEXT),
    period: analysis.period,
    kind: candidate.kind,
    importance: candidate.importance,
    title: compactText(candidate.title, MAX_LONG_TEXT),
    amount: compactText(candidate.amount, MAX_SHORT_TEXT),
    ...(candidate.baseline ? { baseline: compactText(candidate.baseline, MAX_SHORT_TEXT) } : {}),
    ...(candidate.delta ? { delta: compactText(candidate.delta, MAX_SHORT_TEXT) } : {}),
    ...(candidate.ratio ? { ratio: compactText(candidate.ratio, MAX_SHORT_TEXT) } : {}),
    signal: candidate.signal,
    profileRefs,
    ...(preferredProfileRef ? { preferredProfileRef } : {}),
    evidence: candidate.evidence
      .slice(0, MAX_EVIDENCE_LINES)
      .map((line) => compactText(line, MAX_LONG_TEXT)),
    ...(driver
      ? {
          driver: {
            date: driver.date,
            party: compactText(driver.party, MAX_LONG_TEXT),
            ...(driver.detail ? { detail: compactText(driver.detail, MAX_LONG_TEXT) } : {}),
            ...(driver.installment
              ? { installment: compactText(driver.installment, MAX_SHORT_TEXT) }
              : {}),
            ...(driver.category ? { category: compactText(driver.category, MAX_LONG_TEXT) } : {}),
            labels: driver.labels
              .slice(0, MAX_LABELS)
              .map((label) => compactText(label, MAX_LONG_TEXT)),
            classification: driver.classification,
            partyHistory: driver.partyHistory,
          },
        }
      : {}),
  };
}

function buildThread(
  key: string,
  observations: readonly InternalObservation[],
  profiles: ReadonlyMap<string, MemoryEvidenceProfile>,
): RankedThread {
  const chronological = observations.toSorted(compareObservations);
  const latest = chronological.at(-1) as InternalObservation;
  const selected = selectRepresentativeObservations(chronological);
  const recurringProfile = chronological.some((observation) =>
    observation.profileRefs.some((ref) => {
      const pattern = profiles.get(ref)?.pattern;
      return pattern !== undefined && pattern !== 'undefined' && pattern !== 'one-off';
    }),
  );
  return {
    key,
    subject: latest.title,
    kind: latest.kind,
    appearances: chronological.length,
    firstPeriod: chronological[0]?.period.start ?? latest.period.start,
    lastPeriod: latest.period.end,
    observations: selected,
    maxImportance: Math.max(...chronological.map((observation) => observation.importance)),
    recurringProfile,
  };
}

function selectRepresentativeObservations(
  chronological: readonly InternalObservation[],
): readonly InternalObservation[] {
  if (chronological.length <= MAX_OBSERVATIONS_PER_THREAD) return chronological;
  const highest = chronological.toSorted(compareObservationImportance)[0] as InternalObservation;
  const representatives = new Map<string, InternalObservation>();
  for (const observation of [chronological[0], highest, chronological.at(-1)]) {
    if (observation) representatives.set(observationKey(observation), observation);
  }
  return [...representatives.values()].toSorted(compareObservations);
}

function selectLaneThreads(threads: readonly RankedThread[]): readonly SelectedThread[] {
  const queues: Record<EvidenceLane, readonly RankedThread[]> = {
    relationship: threads.filter(isRelationshipThread).toSorted(compareRelationshipThreads),
    recurrence: threads.filter(isRecurrenceThread).toSorted(compareRecurrenceThreads),
    exception: threads.toSorted(compareExceptionThreads),
  };
  const offsets: Record<EvidenceLane, number> = {
    relationship: 0,
    recurrence: 0,
    exception: 0,
  };
  const selected: SelectedThread[] = [];
  const selectedKeys = new Set<string>();
  const laneOrder = ['relationship', 'recurrence', 'exception'] as const;
  for (let round = 0; round < MEMORY_REBUILD_THREADS_PER_LANE; round += 1) {
    for (const lane of laneOrder) {
      let offset = offsets[lane];
      let thread = queues[lane][offset];
      while (thread && selectedKeys.has(thread.key)) {
        offset += 1;
        thread = queues[lane][offset];
      }
      offsets[lane] = offset + 1;
      if (!thread) continue;
      selectedKeys.add(thread.key);
      selected.push({ lane, thread });
    }
  }
  return selected;
}

function makeEvidenceValue(input: {
  readonly periods: number;
  readonly candidatePeriods: number;
  readonly candidateInputs: number;
  readonly totalThreads: number;
  readonly selected: readonly SelectedThread[];
  readonly profileKeys: ReadonlySet<string>;
  readonly profiles: ReadonlyMap<string, MemoryEvidenceProfile>;
}): MemoryRebuildEvidenceValue {
  const lanes: Record<EvidenceLane, MemoryEvidenceThread[]> = {
    relationship: [],
    recurrence: [],
    exception: [],
  };
  for (const selection of input.selected) {
    lanes[selection.lane].push(publicThread(selection.thread));
  }
  const profiles = [...input.profileKeys]
    .toSorted((left, right) => left.localeCompare(right))
    .flatMap((key) => {
      const profile = input.profiles.get(key);
      return profile ? [profile] : [];
    });
  const includedCandidates = input.selected.reduce(
    (sum, selection) => sum + selection.thread.observations.length,
    0,
  );
  return {
    version: 1,
    coverage: {
      periods: input.periods,
      candidatePeriods: input.candidatePeriods,
      candidates: input.candidateInputs,
    },
    lanes,
    profiles,
    omitted: {
      threads: input.totalThreads - input.selected.length,
      candidates: input.candidateInputs - includedCandidates,
    },
  };
}

function publicThread(thread: RankedThread): MemoryEvidenceThread {
  return {
    key: thread.key,
    subject: thread.subject,
    kind: thread.kind,
    appearances: thread.appearances,
    firstPeriod: thread.firstPeriod,
    lastPeriod: thread.lastPeriod,
    observations: thread.observations,
  };
}

function threadKey(candidate: ReportCandidate): string {
  if (candidate.kind === 'offset') return `offset:${normalizeKey(candidate.title)}`;
  const preferred = candidate.preferredProfileRef ?? candidate.profileRefs.at(-1) ?? 'none';
  if (candidate.kind === 'aggregate') return `aggregate:${normalizeKey(preferred)}`;
  const party = candidate.driver?.party ?? candidate.title;
  return `transaction:${normalizeKey(party)}:${normalizeKey(preferred)}`;
}

function normalizeKey(value: string): string {
  return compactText(
    value
      .normalize('NFKD')
      .replaceAll(/\p{Mark}/gu, '')
      .toLowerCase()
      .replaceAll(/[^a-z0-9]+/gu, '-'),
    MAX_SHORT_TEXT,
  ).replaceAll(/^-|-$/gu, '');
}

function compactText(value: string, maxCodePoints: number): string {
  const normalized = value.trim().replaceAll(/\s+/gu, ' ');
  return [...normalized].slice(0, maxCodePoints).join('');
}

function utf8Bytes(value: string): number {
  return utf8Encoder.encode(value).byteLength;
}

function isRelationshipThread(thread: RankedThread): boolean {
  return thread.kind === 'offset' || (thread.kind === 'transaction' && thread.appearances > 1);
}

function isRecurrenceThread(thread: RankedThread): boolean {
  return thread.appearances > 1 || thread.recurringProfile;
}

function compareAnalyses(left: ReportAnalysis, right: ReportAnalysis): number {
  return (
    left.period.start.localeCompare(right.period.start) ||
    left.period.end.localeCompare(right.period.end) ||
    left.period.cadence.localeCompare(right.period.cadence)
  );
}

function compareCandidates(left: ReportCandidate, right: ReportCandidate): number {
  return left.id.localeCompare(right.id) || right.importance - left.importance;
}

function compareObservations(
  left: MemoryEvidenceObservation,
  right: MemoryEvidenceObservation,
): number {
  return (
    left.period.start.localeCompare(right.period.start) ||
    left.period.end.localeCompare(right.period.end) ||
    left.id.localeCompare(right.id) ||
    left.title.localeCompare(right.title) ||
    right.importance - left.importance
  );
}

function compareObservationImportance(
  left: MemoryEvidenceObservation,
  right: MemoryEvidenceObservation,
): number {
  return (
    right.importance - left.importance ||
    right.period.end.localeCompare(left.period.end) ||
    left.id.localeCompare(right.id)
  );
}

function compareRelationshipThreads(left: RankedThread, right: RankedThread): number {
  return (
    Number(right.kind === 'offset') - Number(left.kind === 'offset') ||
    right.appearances - left.appearances ||
    right.maxImportance - left.maxImportance ||
    right.lastPeriod.localeCompare(left.lastPeriod) ||
    left.key.localeCompare(right.key)
  );
}

function compareRecurrenceThreads(left: RankedThread, right: RankedThread): number {
  return (
    right.appearances - left.appearances ||
    left.firstPeriod.localeCompare(right.firstPeriod) ||
    right.lastPeriod.localeCompare(left.lastPeriod) ||
    right.maxImportance - left.maxImportance ||
    left.key.localeCompare(right.key)
  );
}

function compareExceptionThreads(left: RankedThread, right: RankedThread): number {
  return (
    right.maxImportance - left.maxImportance ||
    right.lastPeriod.localeCompare(left.lastPeriod) ||
    right.appearances - left.appearances ||
    left.key.localeCompare(right.key)
  );
}

function observationKey(observation: MemoryEvidenceObservation): string {
  return `${observation.period.start}:${observation.period.end}:${observation.id}`;
}
