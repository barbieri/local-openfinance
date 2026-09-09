import { createElement, Fragment, type ReactNode, useMemo } from 'react';
import {
  REPORT_HTML_CLASSES,
  REPORT_HTML_TAGS,
} from '../../../intelligence/report-html-contract.js';
import { isSupportedReportHref } from '../../../intelligence/report-links.js';

const REPORT_TAG_SET = new Set<string>(REPORT_HTML_TAGS);
const REPORT_CLASS_SET = new Set<string>(REPORT_HTML_CLASSES);

export function ReportHtml({ html }: { readonly html: string }) {
  const content = useMemo(() => parseReportHtml(html), [html]);
  return <>{content}</>;
}

function parseReportHtml(html: string): ReactNode {
  if (typeof DOMParser === 'undefined') return null;
  const document = new DOMParser().parseFromString(html, 'text/html');
  return [...document.body.childNodes].map((node, index) => renderNode(node, `root-${index}`));
}

function renderNode(node: Node, key: string): ReactNode {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent;
  if (!(node instanceof Element)) return null;
  const tag = node.tagName.toLowerCase();
  const children = [...node.childNodes].map((child, index) => renderNode(child, `${key}-${index}`));
  if (!REPORT_TAG_SET.has(tag)) return createElement(Fragment, { key }, ...children);
  const className = node.className
    .split(/\s+/u)
    .filter((name) => REPORT_CLASS_SET.has(name))
    .join(' ');
  const href = tag === 'a' ? node.getAttribute('href') : null;
  const safeHref =
    href && isSupportedReportHref(href, window.location.origin + window.location.pathname)
      ? href
      : null;
  return createElement(
    tag,
    {
      key,
      ...(className ? { className } : {}),
      ...(safeHref ? { href: safeHref } : {}),
    },
    ...children,
  );
}
