import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The Gustavo Style tokens are generated from the canonical design document in
 * barbieri-playground. Nothing else compares the committed snapshots with that
 * source, so a canonical edit could silently leave the browser and email styles
 * behind.
 *
 * The committed snapshots are prettified by Biome (whitespace, quote style,
 * redundant trailing semicolons), so this compares significant content rather
 * than bytes: token values and chart-family shades are where drift matters.
 */
describe('Gustavo Style drift', () => {
  const exporter = resolve('../barbieri-openclaw/scripts/export_gustavo_style.py');
  const canonical = resolve('../barbieri-playground/design/DESIGN.md');

  const exportToFile = (format: string, scope?: string): string => {
    const destination = join(mkdtempSync(join(tmpdir(), 'gustavo-style-')), 'out.txt');
    execFileSync('python3', [
      exporter,
      canonical,
      destination,
      '--format',
      format,
      ...(scope === undefined ? [] : ['--scope', scope]),
    ]);
    return readFileSync(destination, 'utf8');
  };

  /** Every hex value present, order-independent, ignoring formatting. */
  const hexValues = (value: string): string[] =>
    [...value.matchAll(/#[0-9a-fA-F]{6}/g)].map((match) => match[0].toLowerCase()).sort();

  it('keeps the browser stylesheet tokens in sync with the canonical design', () => {
    const generated = hexValues(exportToFile('css', 'report'));
    const committed = hexValues(readFileSync(resolve('src/web/client/gustavo-style.css'), 'utf8'));
    expect(committed.length).toBeGreaterThan(0);
    expect(committed).toEqual(generated);
  });

  it('keeps the chart families in sync with the canonical design', () => {
    const generated = hexValues(exportToFile('typescript'));
    const committed = hexValues(readFileSync(resolve('src/intelligence/gustavo-style.ts'), 'utf8'));
    expect(committed.length).toBeGreaterThan(0);
    expect(committed).toEqual(generated);
  });
});
