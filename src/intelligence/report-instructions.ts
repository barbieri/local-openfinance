import { readFile } from 'node:fs/promises';
import { readDefaultPrompt } from '../llm/default-prompts.js';
import type { ResolvedReportConfig } from '../types.js';

export async function compileReportInstructions(report: ResolvedReportConfig): Promise<string> {
  const sections = await Promise.all(
    report.prompts.map(async (reference) => {
      const bundled = readDefaultPrompt(reference);
      return bundled ?? (await readFile(reference, 'utf8')).trimEnd();
    }),
  );
  return sections.join('\n\n---\n\n');
}
