import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { resolveMigrationsDir } from '../src/db/migrate.js';

const tempRoots: string[] = [];

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function makeTempRoot(): string {
  const root = mkdtempSync(path.join(tmpdir(), 'lof-migrations-'));
  tempRoots.push(root);
  return root;
}

function writeSql(dir: string): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, '001_core.sql'), 'SELECT 1;\n');
}

describe('resolveMigrationsDir', () => {
  it('finds migrations next to the esbuild CLI bundle', () => {
    const root = makeTempRoot();
    const bundleDir = path.join(root, 'dist', 'bundle');
    writeSql(path.join(bundleDir, 'migrations'));

    expect(resolveMigrationsDir(bundleDir, path.join(root, 'elsewhere'))).toBe(
      path.join(bundleDir, 'migrations'),
    );
  });

  it('finds dist/db/migrations from the published package layout', () => {
    const root = makeTempRoot();
    const bundleDir = path.join(root, 'dist', 'bundle');
    mkdirSync(bundleDir, { recursive: true });
    writeSql(path.join(root, 'dist', 'db', 'migrations'));

    expect(resolveMigrationsDir(bundleDir, path.join(root, 'elsewhere'))).toBe(
      path.join(root, 'dist', 'db', 'migrations'),
    );
  });

  it('finds src/db/migrations from a git checkout cwd', () => {
    const root = makeTempRoot();
    writeSql(path.join(root, 'src', 'db', 'migrations'));

    expect(resolveMigrationsDir(path.join(root, 'no', 'modules'), root)).toBe(
      path.join(root, 'src', 'db', 'migrations'),
    );
  });
});
