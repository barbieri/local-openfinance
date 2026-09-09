import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

export function resolveMigrationsDir(
  moduleDir = path.dirname(fileURLToPath(import.meta.url)),
  cwd = process.cwd(),
): string {
  const candidates = [
    path.join(moduleDir, 'migrations'),
    path.resolve(moduleDir, '../db/migrations'),
    path.resolve(cwd, 'dist/db/migrations'),
    path.resolve(cwd, 'src/db/migrations'),
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  throw new Error('Unable to locate SQL migrations directory');
}

export function migrateDatabase(db: DatabaseSync): readonly number[] {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL
    );
  `);

  const migrationsDir = resolveMigrationsDir();
  const applied = new Set(
    db
      .prepare('SELECT version FROM schema_migrations ORDER BY version')
      .all()
      .map((row) => (row as { readonly version: number }).version),
  );

  const files = readdirSync(migrationsDir)
    .filter((name) => /^\d+_.+\.sql$/u.test(name))
    .sort();

  const newlyApplied: number[] = [];

  for (const file of files) {
    const version = Number.parseInt(file.split('_')[0] ?? '', 10);
    if (!Number.isFinite(version) || applied.has(version)) {
      continue;
    }

    const sql = readFileSync(path.join(migrationsDir, file), 'utf8');
    db.exec('BEGIN IMMEDIATE');
    try {
      db.exec(sql);
      db.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)').run(
        version,
        new Date().toISOString(),
      );
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
    newlyApplied.push(version);
  }

  return newlyApplied;
}
