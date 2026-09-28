import { createHash, randomBytes } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';

const SESSION_HASH_DOMAIN = 'local-openfinance/web-session/v1\0';
export const WEB_SESSION_MAX_AGE_SECONDS = 34_560_000;

export function rotateWebSession(
  db: DatabaseSync,
  webToken: string,
  previousId: string | null,
  now = new Date(),
): string {
  const id = parseWebSessionId(randomBytes(32).toString('base64url'));
  if (!id) {
    throw new Error('Failed to create a valid web session id');
  }
  db.exec('BEGIN IMMEDIATE');
  try {
    pruneExpiredWebSessions(db, now);
    if (previousId) {
      revokeWebSession(db, previousId, webToken);
    }
    db.prepare(
      'INSERT INTO web_sessions (session_hash, created_at, expires_at) VALUES (?, ?, ?)',
    ).run(hashWebSessionId(id, webToken), now.toISOString(), expiresAt(now));
    db.exec('COMMIT');
    return id;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

export function validateWebSession(
  db: DatabaseSync,
  id: string,
  webToken: string,
  now = new Date(),
): boolean {
  const result = db
    .prepare('SELECT 1 FROM web_sessions WHERE session_hash = ? AND expires_at > ?')
    .get(hashWebSessionId(id, webToken), now.toISOString());
  return result !== undefined;
}

export function refreshWebSession(
  db: DatabaseSync,
  id: string,
  webToken: string,
  now = new Date(),
): boolean {
  const result = db
    .prepare('UPDATE web_sessions SET expires_at = ? WHERE session_hash = ? AND expires_at > ?')
    .run(expiresAt(now), hashWebSessionId(id, webToken), now.toISOString());
  return result.changes === 1;
}

export function revokeWebSession(db: DatabaseSync, id: string, webToken: string): boolean {
  const result = db
    .prepare('DELETE FROM web_sessions WHERE session_hash = ?')
    .run(hashWebSessionId(id, webToken));
  return result.changes === 1;
}

export function pruneExpiredWebSessions(db: DatabaseSync, now = new Date()): number {
  const result = db
    .prepare('DELETE FROM web_sessions WHERE expires_at <= ?')
    .run(now.toISOString());
  return Number(result.changes);
}

export function parseWebSessionId(value: string | undefined): string | null {
  return value !== undefined && /^[A-Za-z0-9_-]{43}$/u.test(value) ? value : null;
}

function hashWebSessionId(id: string, webToken: string): string {
  return createHash('sha256')
    .update(SESSION_HASH_DOMAIN)
    .update(webToken)
    .update('\0')
    .update(id)
    .digest('hex');
}

function expiresAt(now: Date): string {
  return new Date(now.getTime() + WEB_SESSION_MAX_AGE_SECONDS * 1000).toISOString();
}
