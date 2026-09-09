import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

declare const __DEFAULT_BASE_INSTRUCTIONS__: string | undefined;

export const defaultBaseInstructionsReference = '@DEFAULT_BASE_INSTRUCTIONS@';

const promptDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'prompts');

const defaultPrompts: Record<string, string> = {
  [defaultBaseInstructionsReference]:
    typeof __DEFAULT_BASE_INSTRUCTIONS__ === 'string'
      ? __DEFAULT_BASE_INSTRUCTIONS__
      : loadBundledPrompt('base-instructions.md'),
};

export function isDefaultPromptReference(promptReference: string): boolean {
  return Boolean(readDefaultPrompt(promptReference));
}

export function readDefaultPrompt(promptReference: string): string | undefined {
  return defaultPrompts[promptReference];
}

function loadBundledPrompt(filename: string): string {
  return readFileSync(path.join(promptDir, filename), 'utf8').trimEnd();
}
