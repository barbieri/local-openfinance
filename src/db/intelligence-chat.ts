import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { allSql, getSql, runSql } from './sqlite-query.js';

export type IntelligenceChat = {
  readonly id: string;
  readonly reportId: string;
  readonly seedRunId: string | null;
  readonly messagesJson: string;
  readonly createdAt: string;
  readonly updatedAt: string;
};

type ChatRow = {
  readonly id: string;
  readonly report_id: string;
  readonly seed_run_id: string | null;
  readonly messages_json: string;
  readonly created_at: string;
  readonly updated_at: string;
};

export function buildIntelligenceChatId(reportId: string, seedRunId: string | null): string {
  return seedRunId ? `${reportId}:run:${seedRunId}` : `${reportId}:current`;
}

export function getIntelligenceChat(
  db: DatabaseSync,
  reportId: string,
  seedRunId: string | null,
): IntelligenceChat | null {
  const id = buildIntelligenceChatId(reportId, seedRunId);
  const row = getSql<ChatRow>(
    db,
    `SELECT * FROM intelligence_chats WHERE id = ? AND report_id = ?`,
    id,
    reportId,
  );
  return row ? presentChat(row) : null;
}

export function listIntelligenceChatRunIds(
  db: DatabaseSync,
  reportId: string,
): ReadonlySet<string> {
  const rows = allSql<{ readonly seed_run_id: string }>(
    db,
    `SELECT seed_run_id FROM intelligence_chats
     WHERE report_id = ? AND seed_run_id IS NOT NULL AND messages_json <> '[]'`,
    reportId,
  );
  return new Set(rows.map((row) => row.seed_run_id));
}

export function saveIntelligenceChat(
  db: DatabaseSync,
  input: {
    readonly reportId: string;
    readonly seedRunId: string | null;
    readonly messagesJson: string;
    readonly updatedAt?: string | undefined;
  },
): IntelligenceChat {
  const id = buildIntelligenceChatId(input.reportId, input.seedRunId);
  const updatedAt = input.updatedAt ?? new Date().toISOString();
  runSql(
    db,
    `INSERT INTO intelligence_chats (
       id, report_id, seed_run_id, messages_json, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       messages_json = excluded.messages_json,
       updated_at = excluded.updated_at
     WHERE intelligence_chats.report_id = excluded.report_id
       AND intelligence_chats.seed_run_id IS excluded.seed_run_id`,
    id,
    input.reportId,
    input.seedRunId,
    input.messagesJson,
    updatedAt,
    updatedAt,
  );
  const chat = getIntelligenceChat(db, input.reportId, input.seedRunId);
  if (!chat) {
    throw new Error('Failed to save intelligence chat');
  }
  return chat;
}

export function clearIntelligenceChat(
  db: DatabaseSync,
  reportId: string,
  seedRunId: string | null,
): boolean {
  const result = runSql(
    db,
    `DELETE FROM intelligence_chats
     WHERE id = ? AND report_id = ? AND generation_token IS NULL`,
    buildIntelligenceChatId(reportId, seedRunId),
    reportId,
  );
  return result.changes > 0;
}

export function claimIntelligenceChatGeneration(
  db: DatabaseSync,
  reportId: string,
  seedRunId: string | null,
  startedAt = new Date().toISOString(),
): string | null {
  const id = buildIntelligenceChatId(reportId, seedRunId);
  runSql(
    db,
    `INSERT OR IGNORE INTO intelligence_chats (
       id, report_id, seed_run_id, messages_json, created_at, updated_at
     ) VALUES (?, ?, ?, '[]', ?, ?)`,
    id,
    reportId,
    seedRunId,
    startedAt,
    startedAt,
  );
  const staleBefore = new Date(Date.parse(startedAt) - 5 * 60_000).toISOString();
  const token = randomUUID();
  const result = runSql(
    db,
    `UPDATE intelligence_chats
     SET generation_started_at = ?, generation_token = ?
     WHERE id = ? AND report_id = ?
       AND (generation_started_at IS NULL OR generation_started_at < ?)`,
    startedAt,
    token,
    id,
    reportId,
    staleBefore,
  );
  return result.changes > 0 ? token : null;
}

export function releaseIntelligenceChatGeneration(
  db: DatabaseSync,
  reportId: string,
  seedRunId: string | null,
  token: string,
): void {
  runSql(
    db,
    `UPDATE intelligence_chats
     SET generation_started_at = NULL, generation_token = NULL
     WHERE id = ? AND report_id = ? AND generation_token = ?`,
    buildIntelligenceChatId(reportId, seedRunId),
    reportId,
    token,
  );
}

export function completeIntelligenceChatGeneration(
  db: DatabaseSync,
  input: {
    readonly reportId: string;
    readonly seedRunId: string | null;
    readonly token: string;
    readonly messagesJson: string;
  },
): void {
  const result = runSql(
    db,
    `UPDATE intelligence_chats
     SET messages_json = ?, updated_at = ?,
         generation_started_at = NULL, generation_token = NULL
     WHERE id = ? AND report_id = ? AND generation_token = ?`,
    input.messagesJson,
    new Date().toISOString(),
    buildIntelligenceChatId(input.reportId, input.seedRunId),
    input.reportId,
    input.token,
  );
  if (result.changes === 0) {
    throw new Error('Chat generation claim expired before completion.');
  }
}

function presentChat(row: ChatRow): IntelligenceChat {
  return {
    id: row.id,
    reportId: row.report_id,
    seedRunId: row.seed_run_id,
    messagesJson: row.messages_json,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
