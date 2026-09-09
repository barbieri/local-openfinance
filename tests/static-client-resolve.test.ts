import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { resolveClientDistDir } from '../src/web/server/server.js';

const tempRoots: string[] = [];

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function makeTempRoot(): string {
  const root = mkdtempSync(path.join(tmpdir(), 'lof-static-client-'));
  tempRoots.push(root);
  return root;
}

function writeIndexHtml(dir: string): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'index.html'), '<!doctype html><title>ok</title>\n');
}

describe('resolveClientDistDir', () => {
  it('finds dist/client next to the esbuild CLI bundle', () => {
    const root = makeTempRoot();
    const bundleDir = path.join(root, 'dist', 'bundle');
    const clientDir = path.join(root, 'dist', 'client');
    writeIndexHtml(clientDir);
    mkdirSync(bundleDir, { recursive: true });

    expect(resolveClientDistDir(bundleDir, path.join(root, 'elsewhere'))).toBe(clientDir);
  });

  it('finds dist/client from tsc output under dist/web/server', () => {
    const root = makeTempRoot();
    const serverDir = path.join(root, 'dist', 'web', 'server');
    const clientDir = path.join(root, 'dist', 'client');
    writeIndexHtml(clientDir);
    mkdirSync(serverDir, { recursive: true });

    expect(resolveClientDistDir(serverDir, path.join(root, 'elsewhere'))).toBe(clientDir);
  });

  it('finds dist/client from tsx source under src/web/server', () => {
    const root = makeTempRoot();
    const serverDir = path.join(root, 'src', 'web', 'server');
    const clientDir = path.join(root, 'dist', 'client');
    writeIndexHtml(clientDir);
    mkdirSync(serverDir, { recursive: true });

    expect(resolveClientDistDir(serverDir, path.join(root, 'elsewhere'))).toBe(clientDir);
  });

  it('falls back to cwd dist/client', () => {
    const root = makeTempRoot();
    const clientDir = path.join(root, 'dist', 'client');
    writeIndexHtml(clientDir);

    expect(resolveClientDistDir(path.join(root, 'no', 'modules', 'here'), root)).toBe(clientDir);
  });

  it('returns null when no client build is present', () => {
    const root = makeTempRoot();
    expect(resolveClientDistDir(path.join(root, 'dist', 'bundle'), root)).toBeNull();
  });
});
