import { describe, expect, it, vi } from 'vitest';
import yargs from 'yargs';
import { renderMarkdownForTerminal, runCommand } from '../src/commands/run.js';

describe('run command arguments', () => {
  it('accepts --report when --due is omitted', () => {
    const handler = vi.fn();
    const command = { ...runCommand, handler };
    yargs()
      .exitProcess(false)
      .command(command)
      .parse(['run', '--config', 'unused.json', '--report', 'weekly']);

    expect(handler).toHaveBeenCalledOnce();
  });

  it('renders report headings for terminal output', () => {
    expect(() => renderMarkdownForTerminal('# Weekly\n\n**Stable**')).not.toThrow();
    expect(renderMarkdownForTerminal('# Weekly')).toContain('Weekly');
  });

  it('removes model-supplied terminal control sequences before rendering', () => {
    const rendered = renderMarkdownForTerminal('safe\u001B]8;;https://attacker.test\u0007click');

    expect(rendered).toContain('safeclick');
    expect(rendered).not.toContain('attacker.test');
  });

  it.each(['--date', '--start-date', '--end-date'])('rejects %s with --due', (dateOption) => {
    const parser = yargs()
      .exitProcess(false)
      .command(runCommand)
      .fail((message, error) => {
        throw error ?? new Error(message);
      });

    expect(() =>
      parser.parse(['run', '--config', 'unused.json', '--due', dateOption, '2026-08-22']),
    ).toThrow(/mutually exclusive|conflicts with/u);
  });
});
