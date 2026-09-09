import sanitizeHtml from 'sanitize-html';
import { z } from 'zod';
import { REPORT_HTML_CLASSES, REPORT_HTML_TAGS } from './report-html-contract.js';
import { isSupportedReportHref } from './report-links.js';

export { REPORT_HTML_CLASSES } from './report-html-contract.js';

const reportGenerationOutputSchema = z.strictObject({
  subject: z
    .string()
    .trim()
    .min(1)
    .max(200)
    .refine((value) => !/<[^>]+>/u.test(value), 'Subject must be plain text'),
  bodyHtml: z.string().trim().min(1).max(50_000),
  memoryMarkdown: z.string().trim().min(1).max(50_000),
});

export type ReportGenerationOutput = z.infer<typeof reportGenerationOutputSchema>;

export const REPORT_GENERATION_OUTPUT_SCHEMA = reportGenerationOutputSchema;

export function parseReportGenerationOutput(value: unknown): ReportGenerationOutput {
  return reportGenerationOutputSchema.parse(value);
}

export function sanitizeReportBodyHtml(value: string, publicBaseUrl?: string): string {
  return sanitizeHtml(value, {
    allowedTags: [...REPORT_HTML_TAGS],
    allowedAttributes: {
      '*': ['class'],
      a: ['href'],
    },
    allowedClasses: {
      '*': [...REPORT_HTML_CLASSES],
    },
    allowedSchemes: ['http', 'https'],
    allowProtocolRelative: false,
    allowedSchemesAppliedToAttributes: ['href'],
    transformTags: {
      a: (_tagName, attribs) =>
        isSupportedReportHref(attribs['href'], publicBaseUrl)
          ? { tagName: 'a', attribs }
          : { tagName: 'span', attribs: {} },
    },
  }).trim();
}

export function reportHtmlToText(value: string): string {
  const separated = value.replaceAll(/<\/(?:div|h2|h3|li|p|section|table|tr)>/giu, ' ');
  return sanitizeHtml(separated, {
    allowedTags: [],
    allowedAttributes: {},
    textFilter: (text) => text.replaceAll(/\s+/gu, ' '),
  })
    .replaceAll(/\s+/gu, ' ')
    .trim();
}

export function ensureVisibleReportBody(value: string, language: string): string {
  if (reportHtmlToText(value).length > 0) return value;

  const status = language.toLowerCase().startsWith('pt')
    ? 'Nenhum achado material foi identificado neste período.'
    : 'No material finding was identified for this period.';
  return (
    '<div class="report-dashboard"><div class="report-findings"><p class="report-note">' +
    status +
    '</p></div></div>'
  );
}

export function compactReportMemoryMarkdown(value: string, language: string): string {
  const sections = value
    .trim()
    .split(/(?=^#{1,6}\s)/gmu)
    .map((section) => section.trim())
    .filter((section) => {
      const [firstLine, ...content] = section.split(/\r?\n/u);
      return !/^#{1,6}\s/u.test(firstLine ?? '') || content.some((line) => line.trim().length > 0);
    });
  if (sections.length > 0) return sections.join('\n\n');
  return language.toLowerCase().startsWith('pt') ? '# Memória' : '# Memory';
}
