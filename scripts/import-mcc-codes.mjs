#!/usr/bin/env node
/**
 * Build src/data/mcc-codes.json from greggles/mcc-codes (open MCC list).
 * pt-BR: merges src/data/mcc-codes.pt-overrides.json when present; otherwise copies en.
 * After bulk pt edits, run scripts/fix-mcc-pt-overrides.mjs to normalize airlines/hotels/car rental.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const sourceUrl = 'https://raw.githubusercontent.com/greggles/mcc-codes/main/mcc_codes.json';

const overridesPath = path.join(root, 'src/data/mcc-codes.pt-overrides.json');
const outputPath = path.join(root, 'src/data/mcc-codes.json');

const response = await fetch(sourceUrl);
if (!response.ok) {
  throw new Error(`Failed to fetch MCC list: ${response.status}`);
}
const rows = await response.json();

let ptOverrides = {};
try {
  ptOverrides = JSON.parse(readFileSync(overridesPath, 'utf8'));
} catch {
  // optional overrides file
}

const codes = {};
for (const row of rows) {
  const mcc = String(row.mcc ?? '')
    .padStart(4, '0')
    .slice(-4);
  if (!/^\d{4}$/u.test(mcc)) {
    continue;
  }
  const en =
    (typeof row.edited_description === 'string' && row.edited_description.trim()) ||
    (typeof row.combined_description === 'string' && row.combined_description.trim()) ||
    `MCC ${mcc}`;
  const pt =
    (typeof ptOverrides[mcc] === 'string' && ptOverrides[mcc]) ||
    (typeof ptOverrides[mcc]?.pt === 'string' && ptOverrides[mcc].pt) ||
    en;
  codes[mcc] = { en, pt };
}

const document = {
  version: 1,
  source: 'greggles/mcc-codes',
  sourceUrl,
  importedAt: new Date().toISOString().slice(0, 10),
  codes,
};

writeFileSync(outputPath, `${JSON.stringify(document, null, 2)}\n`);
console.log(`Wrote ${Object.keys(codes).length} MCC codes to ${outputPath}`);
