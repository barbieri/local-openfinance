import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { VISIBLE_ACCOUNT_TRANSACTIONS_WHERE } from '../db/account-links.js';
import { resolveAccountDisplayName } from '../db/connection-labels.js';
import { TRANSACTION_ACCOUNT_AMOUNT_CENTS_SQL } from '../db/transaction-foreign-amount.js';
import { mapInParallel } from '../utils/map-in-parallel.js';
import {
  DEFAULT_TRANSFER_FEE_TOLERANCE_CENTS,
  DEFAULT_TRANSFER_WINDOW_HOURS,
  scoreTransferPairComponents,
} from './score.js';

export {
  DEFAULT_TRANSFER_FEE_TOLERANCE_CENTS,
  DEFAULT_TRANSFER_WINDOW_HOURS,
  formatTransferConfidencePercent,
} from './score.js';

export type TransferKind = 'internal_transfer' | 'investment_funding' | 'bill_payment';

export type TransferLeg = {
  readonly id: string;
  readonly accountId: string;
  readonly occurredAt: string;
  readonly amountCents: number;
  readonly merchantName: string | null;
  readonly description: string | null;
};

export type TransferPairProposal = {
  readonly source: TransactionCandidate;
  readonly destination: TransactionCandidate;
  readonly kind: TransferKind;
  readonly confidence: number;
  readonly amountConfidence: number;
  readonly timeConfidence: number;
};

export type ApiTransferPairProposal = {
  readonly source: TransferLeg;
  readonly destination: TransferLeg;
  readonly kind: TransferKind;
  readonly confidence: number;
  readonly amountConfidence: number;
  readonly timeConfidence: number;
};

export function toTransferLeg(candidate: TransactionCandidate): TransferLeg {
  return {
    id: candidate.id,
    accountId: candidate.accountId,
    occurredAt: candidate.occurredAt,
    amountCents: candidate.amountCents,
    merchantName: candidate.merchantName,
    description: candidate.description,
  };
}

export function toApiTransferPairProposal(proposal: TransferPairProposal): ApiTransferPairProposal {
  return {
    source: toTransferLeg(proposal.source),
    destination: toTransferLeg(proposal.destination),
    kind: proposal.kind,
    confidence: proposal.confidence,
    amountConfidence: proposal.amountConfidence,
    timeConfidence: proposal.timeConfidence,
  };
}

export function normalizeTransferConfirmBody(body: unknown): unknown {
  if (!body || typeof body !== 'object' || !('pairs' in body) || !Array.isArray(body.pairs)) {
    return body;
  }

  return {
    pairs: body.pairs.map((pair) => normalizeTransferPairProposal(pair)),
  };
}

function normalizeTransferPairProposal(pair: unknown): unknown {
  if (!pair || typeof pair !== 'object') {
    return pair;
  }

  const record = pair as Record<string, unknown>;
  return {
    source: normalizeTransferLeg(record['source']),
    destination: normalizeTransferLeg(record['destination']),
    kind: record['kind'],
    confidence: record['confidence'],
    amountConfidence: record['amountConfidence'],
    timeConfidence: record['timeConfidence'],
  };
}

function normalizeTransferLeg(leg: unknown): TransferLeg | unknown {
  if (!leg || typeof leg !== 'object') {
    return leg;
  }

  const record = leg as Record<string, unknown>;
  return {
    id: record['id'],
    accountId: record['accountId'],
    occurredAt: record['occurredAt'],
    amountCents: record['amountCents'],
    merchantName: record['merchantName'] ?? null,
    description: record['description'] ?? null,
  };
}

export type DetectTransfersOptions = {
  readonly windowHours: number;
  readonly feeToleranceCents: number;
  readonly dryRun: boolean;
  readonly confirmPair?: ((proposal: TransferPairProposal) => Promise<boolean>) | undefined;
  readonly transactionIds?: readonly string[] | undefined;
  readonly dateRange?:
    | { readonly startDate: string | null; readonly endDate: string | null }
    | undefined;
  readonly onProposal?: ((proposal: TransferPairProposal) => void) | undefined;
  readonly singlePair?: TransferPairProposal | undefined;
  readonly manualPair?: { readonly sourceId: string; readonly destinationId: string } | undefined;
};

export type DetectTransfersSummary = {
  readonly groupsCreated: number;
  readonly membersLinked: number;
  readonly candidatesScanned: number;
  readonly proposed: number;
  readonly skipped: number;
};

type TransactionCandidate = {
  readonly id: string;
  readonly accountId: string;
  readonly accountType: string;
  readonly occurredAt: string;
  readonly amountCents: number;
  readonly merchantName: string | null;
  readonly description: string | null;
};

type LinkState = {
  groupsCreated: number;
  membersLinked: number;
  proposed: number;
  skipped: number;
  linked: Set<string>;
};

export async function detectTransferGroups(
  db: DatabaseSync,
  options: DetectTransfersOptions,
): Promise<DetectTransfersSummary> {
  if (options.manualPair) {
    return linkManualPair(db, options.manualPair);
  }

  if (options.singlePair) {
    const state: LinkState = {
      groupsCreated: 0,
      membersLinked: 0,
      proposed: 0,
      skipped: 0,
      linked: new Set<string>(),
    };
    const left = options.singlePair.source;
    const right = options.singlePair.destination;
    if (options.dryRun) {
      options.onProposal?.(options.singlePair);
      return {
        groupsCreated: 0,
        membersLinked: 0,
        candidatesScanned: 0,
        proposed: 1,
        skipped: 0,
      };
    }
    const confirmed = options.confirmPair ? await options.confirmPair(options.singlePair) : true;
    if (confirmed) {
      persistTransferPair(db, left, right, options.singlePair, false, state);
    } else {
      state.skipped += 1;
    }
    return {
      groupsCreated: state.groupsCreated,
      membersLinked: state.membersLinked,
      candidatesScanned: 0,
      proposed: 1,
      skipped: state.skipped,
    };
  }

  const candidates = loadUnlinkedTransactions(db, options);
  const buckets = bucketCandidates(candidates);
  const state: LinkState = {
    groupsCreated: 0,
    membersLinked: 0,
    proposed: 0,
    skipped: 0,
    linked: new Set<string>(),
  };
  const windowMs = options.windowHours * 60 * 60 * 1000;

  await mapInParallel(
    [...buckets.values()],
    (bucket) => linkPairsInBucket(db, bucket, options, windowMs, state),
    1,
  );

  return {
    groupsCreated: state.groupsCreated,
    membersLinked: state.membersLinked,
    candidatesScanned: candidates.length,
    proposed: state.proposed,
    skipped: state.skipped,
  };
}

function bucketCandidates(
  candidates: readonly TransactionCandidate[],
): Map<string, TransactionCandidate[]> {
  const buckets = new Map<string, TransactionCandidate[]>();
  for (const candidate of candidates) {
    const key = String(Math.abs(candidate.amountCents));
    const bucket = buckets.get(key) ?? [];
    bucket.push(candidate);
    buckets.set(key, bucket);
  }
  return buckets;
}

async function linkPairsInBucket(
  db: DatabaseSync,
  bucket: readonly TransactionCandidate[],
  options: DetectTransfersOptions,
  windowMs: number,
  state: LinkState,
): Promise<void> {
  await mapInParallel(
    bucket,
    async (left, leftIndex) => {
      if (!left || state.linked.has(left.id)) {
        return;
      }

      await linkFirstMatchingPair(db, bucket, leftIndex, left, options, windowMs, state);
    },
    1,
  );
}

async function linkFirstMatchingPair(
  db: DatabaseSync,
  bucket: readonly TransactionCandidate[],
  leftIndex: number,
  left: TransactionCandidate,
  options: DetectTransfersOptions,
  windowMs: number,
  state: LinkState,
): Promise<boolean> {
  return findAndLinkMatchingPair(db, bucket, leftIndex + 1, left, options, windowMs, state);
}

async function findAndLinkMatchingPair(
  db: DatabaseSync,
  bucket: readonly TransactionCandidate[],
  rightIndex: number,
  left: TransactionCandidate,
  options: DetectTransfersOptions,
  windowMs: number,
  state: LinkState,
): Promise<boolean> {
  if (rightIndex >= bucket.length) {
    return false;
  }

  const right = bucket[rightIndex];
  if (!right || state.linked.has(right.id)) {
    return findAndLinkMatchingPair(db, bucket, rightIndex + 1, left, options, windowMs, state);
  }

  if (!isOppositeTransferPair(left, right, windowMs, options.feeToleranceCents)) {
    return findAndLinkMatchingPair(db, bucket, rightIndex + 1, left, options, windowMs, state);
  }

  const proposal = buildProposal(left, right, windowMs, options.feeToleranceCents);
  const accepted = await confirmTransferProposal(proposal, options, state);
  if (!accepted) {
    return findAndLinkMatchingPair(db, bucket, rightIndex + 1, left, options, windowMs, state);
  }

  persistTransferPair(db, left, right, proposal, options.dryRun, state);
  return true;
}

async function confirmTransferProposal(
  proposal: TransferPairProposal,
  options: DetectTransfersOptions,
  state: LinkState,
): Promise<boolean> {
  state.proposed += 1;
  if (options.dryRun) {
    options.onProposal?.(proposal);
    state.skipped += 1;
    return false;
  }
  if (!options.confirmPair) {
    return true;
  }

  const confirmed = await options.confirmPair(proposal);
  if (!confirmed) {
    state.skipped += 1;
    return false;
  }

  return true;
}

function buildProposal(
  left: TransactionCandidate,
  right: TransactionCandidate,
  windowMs: number,
  feeToleranceCents: number,
): TransferPairProposal {
  const source = left.amountCents < 0 ? left : right;
  const destination = left.amountCents < 0 ? right : left;
  const score = scoreTransferPairComponents(
    {
      amountCentsLeft: left.amountCents,
      amountCentsRight: right.amountCents,
      occurredAtLeft: left.occurredAt,
      occurredAtRight: right.occurredAt,
    },
    { maxAmountDiffCents: feeToleranceCents, maxTimeMs: windowMs },
  );
  return {
    source,
    destination,
    kind: inferTransferKind(left, right),
    confidence: score.confidence,
    amountConfidence: score.amount,
    timeConfidence: score.time,
  };
}

function persistTransferPair(
  db: DatabaseSync,
  left: TransactionCandidate,
  right: TransactionCandidate,
  proposal: TransferPairProposal,
  dryRun: boolean,
  state: LinkState,
): void {
  if (dryRun) {
    state.groupsCreated += 1;
    state.membersLinked += 2;
    state.linked.add(left.id);
    state.linked.add(right.id);
    return;
  }

  const groupId = randomUUID();
  const now = new Date().toISOString();

  db.prepare(
    `INSERT INTO transfer_groups (id, kind, confidence, notes, created_at)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(groupId, proposal.kind, proposal.confidence, null, now);

  insertTransferMember(db, groupId, proposal.source.id, 'source');
  insertTransferMember(db, groupId, proposal.destination.id, 'destination');
  state.groupsCreated += 1;
  state.membersLinked += 2;
  state.linked.add(left.id);
  state.linked.add(right.id);
}

function loadUnlinkedTransactions(
  db: DatabaseSync,
  options: DetectTransfersOptions = {
    windowHours: 1,
    feeToleranceCents: 100,
    dryRun: false,
  },
): TransactionCandidate[] {
  const params: unknown[] = [];
  let extraWhere = '';

  if (options.transactionIds && options.transactionIds.length > 0) {
    extraWhere += ` AND t.id IN (${options.transactionIds.map(() => '?').join(', ')})`;
    params.push(...options.transactionIds);
  }

  if (options.dateRange?.startDate) {
    extraWhere += ' AND date(t.occurred_at) >= date(?)';
    params.push(options.dateRange.startDate);
  }

  if (options.dateRange?.endDate) {
    extraWhere += ' AND date(t.occurred_at) <= date(?)';
    params.push(options.dateRange.endDate);
  }

  return db
    .prepare(
      `SELECT t.id, t.account_id, t.occurred_at, ${TRANSACTION_ACCOUNT_AMOUNT_CENTS_SQL} AS amount_cents,
              t.merchant_name, t.description,
              a.type AS account_type
       FROM transactions t
       JOIN accounts a ON a.id = t.account_id
       WHERE a.type = 'BANK'
       AND NOT EXISTS (
         SELECT 1 FROM transfer_group_members tgm
         WHERE tgm.entry_type = 'transaction' AND tgm.entry_id = t.id
       )
       AND ${VISIBLE_ACCOUNT_TRANSACTIONS_WHERE}${extraWhere}
       ORDER BY t.occurred_at ASC`,
    )
    .all(...(params as never[]))
    .map((row) => {
      const record = row as Record<string, unknown>;
      return {
        id: String(record['id']),
        accountId: String(record['account_id']),
        accountType: String(record['account_type']),
        occurredAt: String(record['occurred_at']),
        amountCents: Number(record['amount_cents']),
        merchantName: typeof record['merchant_name'] === 'string' ? record['merchant_name'] : null,
        description: typeof record['description'] === 'string' ? record['description'] : null,
      };
    });
}

function linkManualPair(
  db: DatabaseSync,
  pair: { readonly sourceId: string; readonly destinationId: string },
): DetectTransfersSummary {
  const source = loadTransactionCandidateById(db, pair.sourceId);
  const destination = loadTransactionCandidateById(db, pair.destinationId);
  if (!source || !destination) {
    return {
      groupsCreated: 0,
      membersLinked: 0,
      candidatesScanned: 0,
      proposed: 0,
      skipped: 1,
    };
  }

  const proposal = buildProposal(
    source,
    destination,
    DEFAULT_TRANSFER_WINDOW_HOURS * 60 * 60 * 1000,
    DEFAULT_TRANSFER_FEE_TOLERANCE_CENTS,
  );
  const state: LinkState = {
    groupsCreated: 0,
    membersLinked: 0,
    proposed: 1,
    skipped: 0,
    linked: new Set<string>(),
  };
  persistTransferPair(db, source, destination, proposal, false, state);
  return {
    groupsCreated: state.groupsCreated,
    membersLinked: state.membersLinked,
    candidatesScanned: 2,
    proposed: 1,
    skipped: 0,
  };
}

function loadTransactionCandidateById(db: DatabaseSync, id: string): TransactionCandidate | null {
  const row = db
    .prepare(
      `SELECT t.id, t.account_id, t.occurred_at, ${TRANSACTION_ACCOUNT_AMOUNT_CENTS_SQL} AS amount_cents,
              t.merchant_name, t.description,
              a.type AS account_type
       FROM transactions t
       JOIN accounts a ON a.id = t.account_id
       WHERE t.id = ?`,
    )
    .get(id) as Record<string, unknown> | undefined;

  if (!row) {
    return null;
  }

  return {
    id: String(row['id']),
    accountId: String(row['account_id']),
    accountType: String(row['account_type']),
    occurredAt: String(row['occurred_at']),
    amountCents: Number(row['amount_cents']),
    merchantName: typeof row['merchant_name'] === 'string' ? row['merchant_name'] : null,
    description: typeof row['description'] === 'string' ? row['description'] : null,
  };
}

function isOppositeTransferPair(
  left: TransactionCandidate,
  right: TransactionCandidate,
  windowMs: number,
  feeToleranceCents: number,
): boolean {
  if (left.id === right.id || left.accountId === right.accountId) {
    return false;
  }

  if (left.accountType !== 'BANK' || right.accountType !== 'BANK') {
    return false;
  }

  if (Math.sign(left.amountCents) === Math.sign(right.amountCents) || left.amountCents === 0) {
    return false;
  }

  const amountDelta = Math.abs(Math.abs(left.amountCents) - Math.abs(right.amountCents));
  if (amountDelta > feeToleranceCents) {
    return false;
  }

  const timeDelta = Math.abs(Date.parse(left.occurredAt) - Date.parse(right.occurredAt));
  return timeDelta <= windowMs;
}

function inferTransferKind(left: TransactionCandidate, right: TransactionCandidate): TransferKind {
  const accountTypes = new Set([left.accountType, right.accountType]);
  if (accountTypes.has('CREDIT')) {
    return 'bill_payment';
  }

  const text = `${left.description ?? ''} ${right.description ?? ''}`.toLowerCase();
  if (text.includes('invest') || text.includes('aplic') || text.includes('resgate')) {
    return 'investment_funding';
  }

  return 'internal_transfer';
}

function insertTransferMember(
  db: DatabaseSync,
  groupId: string,
  entryId: string,
  role: 'source' | 'destination' | 'fee',
): void {
  db.prepare(
    `INSERT INTO transfer_group_members (group_id, entry_type, entry_id, role)
     VALUES (?, 'transaction', ?, ?)`,
  ).run(groupId, entryId, role);
}

export function formatTransferLeg(db: DatabaseSync, leg: TransactionCandidate): string {
  const amount = (leg.amountCents / 100).toFixed(2);
  const account = resolveAccountDisplayName(db, leg.accountId);
  const description = leg.description ?? '(no description)';
  return `${account} · BRL ${amount} · ${leg.occurredAt}\n  ${description}`;
}
