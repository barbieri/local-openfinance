import type { DatabaseSync } from 'node:sqlite';
import {
  type AnnotationLabelPresentation,
  type AnnotationLabelResolutionContext,
  type AnnotationLabelRow,
  listAnnotationLabelRows,
  loadAnnotationLabelResolutionContext,
} from '../db/annotation-labels.js';
import { insertAnnotationLabelRecord } from './annotation-label-insert.js';

export type { AnnotationLabelResolutionContext } from '../db/annotation-labels.js';

export type ResolveAnnotationLabelOptions = {
  readonly hintLabelIds?: readonly string[] | undefined;
  readonly createMissing?: boolean | undefined;
};

export type ResolveAnnotationLabelContextOptions = Pick<
  ResolveAnnotationLabelOptions,
  'hintLabelIds'
>;

function normalizeLabelToken(value: string): string {
  return value.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim();
}

function splitLabelPath(value: string): readonly string[] {
  return value
    .split('>')
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);
}

function resolveLabelByPath(reference: string, rows: readonly AnnotationLabelRow[]): string | null {
  const segments = splitLabelPath(reference);
  if (segments.length === 0) {
    return null;
  }

  let parentId: string | null = null;
  let matched: AnnotationLabelRow | null = null;

  for (const segment of segments) {
    const normalizedSegment = normalizeLabelToken(segment);
    const candidates = rows.filter(
      (row) =>
        normalizeLabelToken(row.name) === normalizedSegment && (row.parentId ?? null) === parentId,
    );
    if (candidates.length !== 1) {
      return null;
    }
    matched = candidates[0] ?? null;
    if (!matched) {
      return null;
    }
    parentId = matched.id;
  }

  return matched?.id ?? null;
}

function resolveLabelByName(
  name: string,
  rows: readonly AnnotationLabelRow[],
  index: ReadonlyMap<string, AnnotationLabelPresentation>,
  hintLabelIds: ReadonlySet<string>,
): string | null {
  const normalized = normalizeLabelToken(name);
  const matches = rows.filter((row) => normalizeLabelToken(row.name) === normalized);
  if (matches.length === 0) {
    return null;
  }
  if (matches.length === 1) {
    return matches[0]?.id ?? null;
  }

  const hinted = matches.filter((row) => hintLabelIds.has(row.id));
  if (hinted.length === 1) {
    return hinted[0]?.id ?? null;
  }

  const nested = matches.filter((row) => row.parentId);
  if (nested.length === 1) {
    return nested[0]?.id ?? null;
  }

  nested.sort((left, right) => {
    const leftPath = index.get(left.id)?.path ?? left.name;
    const rightPath = index.get(right.id)?.path ?? right.name;
    return leftPath.localeCompare(rightPath);
  });
  if (nested.length > 0) {
    return nested[0]?.id ?? null;
  }

  return matches[0]?.id ?? null;
}

export function resolveAnnotationLabelReferenceWithContext(
  context: {
    readonly rows: readonly AnnotationLabelRow[];
    readonly index: ReadonlyMap<string, AnnotationLabelPresentation>;
  },
  reference: string,
  options: ResolveAnnotationLabelContextOptions = {},
): string | null {
  const trimmed = reference.trim();
  if (!trimmed) {
    return null;
  }

  if (context.index.has(trimmed)) {
    return trimmed;
  }

  if (trimmed.includes('>')) {
    return resolveLabelByPath(trimmed, context.rows);
  }

  return resolveLabelByName(
    trimmed,
    context.rows,
    context.index,
    new Set(options.hintLabelIds ?? []),
  );
}

export function resolveAnnotationLabelReference(
  db: DatabaseSync,
  reference: string,
  options: ResolveAnnotationLabelOptions = {},
): string | null {
  const trimmed = reference.trim();
  if (!trimmed) {
    return null;
  }

  const context = loadAnnotationLabelResolutionContext(db);
  const resolved = resolveAnnotationLabelReferenceWithContext(context, trimmed, options);
  if (resolved) {
    return resolved;
  }

  if (options.createMissing) {
    return insertAnnotationLabelRecord(db, trimmed, null);
  }

  return null;
}

export function resolveAnnotationLabelReferences(
  db: DatabaseSync,
  references: readonly string[],
  options: ResolveAnnotationLabelOptions = {},
): string[] {
  let context = loadAnnotationLabelResolutionContext(db);
  const resolved: string[] = [];
  const seen = new Set<string>();

  for (const reference of references) {
    let labelId = resolveAnnotationLabelReferenceWithContext(context, reference, options);
    if (!labelId && options.createMissing && reference.trim()) {
      labelId = insertAnnotationLabelRecord(db, reference.trim(), null);
      context = loadAnnotationLabelResolutionContext(db);
    }
    if (!labelId || seen.has(labelId)) {
      continue;
    }
    seen.add(labelId);
    resolved.push(labelId);
  }

  return resolved;
}

export function resolveAnnotationLabelObjects(
  db: DatabaseSync,
  references: readonly string[],
  options: ResolveAnnotationLabelOptions = {},
): {
  readonly id: string;
  readonly name: string;
  readonly parentId: string | null;
  readonly icon: string | null;
  readonly color: string | null;
}[] {
  const rows = listAnnotationLabelRows(db);
  const byId = new Map(rows.map((row) => [row.id, row]));
  return resolveAnnotationLabelReferences(db, references, options)
    .map((labelId) => byId.get(labelId))
    .filter((row): row is AnnotationLabelRow => row !== undefined)
    .map((row) => ({
      id: row.id,
      name: row.name,
      parentId: row.parentId,
      icon: row.icon,
      color: row.color,
    }));
}

export function loadAnnotationLabelPaths(db: DatabaseSync, annotationId: string): string[] {
  const { index } = loadAnnotationLabelResolutionContext(db);
  return db
    .prepare(
      `SELECT label_id
       FROM entry_annotation_labels
       WHERE annotation_id = ?
       ORDER BY label_id ASC`,
    )
    .all(annotationId)
    .map((row) => index.get(String((row as Record<string, unknown>)['label_id']))?.path)
    .filter((path): path is string => Boolean(path));
}

export function loadAnnotationLabelIds(db: DatabaseSync, annotationId: string): string[] {
  return db
    .prepare(
      `SELECT label_id
       FROM entry_annotation_labels
       WHERE annotation_id = ?
       ORDER BY label_id ASC`,
    )
    .all(annotationId)
    .map((row) => String((row as Record<string, unknown>)['label_id']));
}

export function resolveAssistProposalLabelIds(
  db: DatabaseSync,
  proposal: {
    readonly labelIds?: readonly string[] | undefined;
    readonly labelNames?: readonly string[] | undefined;
  },
): string[] {
  return resolveAssistProposalLabelIdsWithContext(
    loadAnnotationLabelResolutionContext(db),
    proposal,
  );
}

type AssistProposal = {
  readonly labelIds?: readonly string[] | undefined;
  readonly labelNames?: readonly string[] | undefined;
};

function resolveAssistProposalLabelIdsForRows(
  proposal: AssistProposal,
  rows: readonly AnnotationLabelRow[],
  index: ReadonlyMap<string, AnnotationLabelPresentation>,
): string[] {
  const fromIds = proposal.labelIds?.filter((id) => index.has(id)) ?? [];
  if (fromIds.length > 0) {
    return [...new Set(fromIds)];
  }

  const hintLabelIds = new Set(proposal.labelIds ?? []);
  const resolved: string[] = [];
  const seen = new Set<string>();
  for (const reference of proposal.labelNames ?? []) {
    const labelId = resolveAnnotationLabelReferenceWithContext({ rows, index }, reference, {
      hintLabelIds: [...hintLabelIds],
    });
    if (labelId && !seen.has(labelId)) {
      seen.add(labelId);
      resolved.push(labelId);
    }
  }
  return resolved;
}

export function resolveAssistProposalLabelIdsWithContext(
  context: AnnotationLabelResolutionContext,
  proposal: AssistProposal,
): string[] {
  return resolveAssistProposalLabelIdsForRows(proposal, context.rows, context.index);
}
