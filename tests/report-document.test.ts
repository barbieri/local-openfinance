import { describe, expect, it } from 'vitest';
import {
  compactReportMemoryMarkdown,
  parseReportGenerationOutput,
  REPORT_GENERATION_OUTPUT_SCHEMA,
  reportHtmlToText,
  sanitizeReportBodyHtml,
} from '../src/intelligence/report-document.js';

describe('report HTML contract', () => {
  it('removes empty memory sections and localizes an empty fallback', () => {
    expect(
      compactReportMemoryMarkdown(
        '# Household\n\n# Episódios\n- Compra de veículo.\n\n# Questões\n',
        'pt-BR',
      ),
    ).toBe('# Episódios\n- Compra de veículo.');
    expect(compactReportMemoryMarkdown('# Empty\n', 'pt-BR')).toBe('# Memória');
  });

  it('uses the canonical Zod schema at the model boundary', () => {
    expect(REPORT_GENERATION_OUTPUT_SCHEMA.safeParse).toBeTypeOf('function');
    expect(
      parseReportGenerationOutput({
        subject: 'Resumo',
        bodyHtml: '<p>Corpo</p>',
        memoryMarkdown: '# Memória',
      }),
    ).toEqual({
      subject: 'Resumo',
      bodyHtml: '<p>Corpo</p>',
      memoryMarkdown: '# Memória',
    });
  });

  it.each([
    { subject: '', bodyHtml: '<p>Corpo</p>', memoryMarkdown: '# Memória' },
    { subject: '<strong>Resumo</strong>', bodyHtml: '<p>Corpo</p>', memoryMarkdown: '# Memória' },
    { subject: 'Resumo', bodyHtml: '', memoryMarkdown: '# Memória' },
    { subject: 'Resumo', bodyHtml: '<p>Corpo</p>', memoryMarkdown: '' },
  ])('rejects an invalid output boundary', (value) => {
    expect(() => parseReportGenerationOutput(value)).toThrow();
  });

  it('keeps primitive markup, semantic links, and agreed classes', () => {
    const html = sanitizeReportBodyHtml(
      '<section class="report-findings"><article class="invented"><p><strong>Alta</strong> em <a class="report-citation" href="#/transaction/tx-1">13/08</a>.</p></article></section>',
    );

    expect(html).toBe(
      '<section class="report-findings"><p><strong>Alta</strong> em <a class="report-citation" href="#/transaction/tx-1">13/08</a>.</p></section>',
    );
  });

  it('removes scripts, images, inline styles, handlers, and unknown classes', () => {
    const html = sanitizeReportBodyHtml(
      '<div class="report-dashboard invented" style="color:red" onclick="steal()"><script>alert(1)</script><img src="https://attacker.test/pixel"><p>Seguro</p></div>',
    );

    expect(html).toBe('<div class="report-dashboard"><p>Seguro</p></div>');
  });

  it('removes invented or unrelated href targets without dropping their text', () => {
    const html = sanitizeReportBodyHtml(
      '<p><a href="https://finance.example/#/transactions?label=food">inventado</a> <a href="https://attacker.test/#/transaction/tx-1">externo</a> <a href="https://finance.example/#/transactions/s=N4IgZiBc-$">válido</a></p>',
      'https://finance.example',
    );

    expect(html).toBe(
      '<p><span>inventado</span> <span>externo</span> <a href="https://finance.example/#/transactions/s=N4IgZiBc-$">válido</a></p>',
    );
  });

  it('derives a plain-text fallback without making the model write Markdown', () => {
    expect(reportHtmlToText('<h2>Achado</h2><p>Alta de <strong>20%</strong>.</p>')).toBe(
      'Achado Alta de 20%.',
    );
  });
});
