import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { defaultBaseInstructionsReference, readDefaultPrompt } from '../src/llm/default-prompts.js';

describe('bundled default prompts', () => {
  it('loads markdown files for the built-in tokens', async () => {
    const instructions = (await readFile('src/llm/prompts/base-instructions.md', 'utf8')).trimEnd();
    expect(readDefaultPrompt(defaultBaseInstructionsReference)).toBe(instructions);
  });
});
