import { spawnSync } from 'node:child_process';
import { cpSync, readFileSync, rmSync } from 'node:fs';
import * as esbuild from 'esbuild';

const BUNDLE_DIR = 'dist/bundle';
const BUNDLE_PATH = `${BUNDLE_DIR}/local-openfinance.mjs`;
const SHEBANG = '#!/usr/bin/env node';
const defaultBaseInstructions = readFileSync(
  'src/llm/prompts/base-instructions.md',
  'utf8',
).trimEnd();

rmSync(BUNDLE_DIR, { recursive: true, force: true });

await esbuild.build({
  outdir: BUNDLE_DIR,
  outExtension: { '.js': '.mjs' },
  platform: 'node',
  format: 'esm',
  target: 'node26.0.0',
  bundle: true,
  external: ['@resvg/resvg-js'],
  minify: true,
  legalComments: 'none',
  logLevel: 'info',
  define: {
    __DEFAULT_BASE_INSTRUCTIONS__: JSON.stringify(defaultBaseInstructions),
  },
  banner: {
    js: [
      "import { createRequire as __createRequire } from 'node:module';",
      'const require = __createRequire(import.meta.url);',
    ].join('\n'),
  },
  entryPoints: {
    'local-openfinance': 'src/local-openfinance.ts',
  },
});

const bundle = readFileSync(BUNDLE_PATH, 'utf8');
if (!bundle.startsWith(`${SHEBANG}\n`)) {
  throw new Error(`Expected ${BUNDLE_PATH} to start with ${SHEBANG}`);
}
if (bundle.indexOf(SHEBANG, SHEBANG.length) !== -1) {
  throw new Error(`Expected ${BUNDLE_PATH} to contain only one shebang`);
}

const smoke = spawnSync(process.execPath, [BUNDLE_PATH, '--help'], { encoding: 'utf8' });
if (smoke.status !== 0) {
  throw new Error(`Single-file CLI smoke test failed:\n${smoke.stderr}`);
}

cpSync('src/db/migrations', `${BUNDLE_DIR}/migrations`, { recursive: true });

console.log(`Wrote minified CLI bundle to ${BUNDLE_DIR}/`);
