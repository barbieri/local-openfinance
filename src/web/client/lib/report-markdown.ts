import { createElement } from 'react';
import type { Components } from 'react-markdown';
import { isSupportedReportHref } from '../../../intelligence/report-links.js';

export const REPORT_MARKDOWN_COMPONENTS: Components = {
  a: ({ children, href }) => {
    const safeHref = href && isSupportedReportHref(href, reportHrefBaseUrl()) ? href : undefined;
    return createElement(safeHref ? 'a' : 'span', safeHref ? { href: safeHref } : {}, children);
  },
  img: () => null,
};

export function normalizeReportChatMarkdown(markdown: string): string {
  return markdown.replaceAll(
    /<a\s+href=(['"])(.*?)\1\s*>(.*?)<\/a>/gisu,
    (anchor, _quote: string, href: string, text: string) =>
      isSupportedReportHref(href, reportHrefBaseUrl()) ? `[${text}](${href})` : anchor,
  );
}

function reportHrefBaseUrl(): string | undefined {
  const location = (
    globalThis as {
      readonly location?: { readonly origin: string; readonly pathname: string };
    }
  ).location;
  return location ? location.origin + location.pathname : undefined;
}
