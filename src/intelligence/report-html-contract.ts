export const REPORT_HTML_CLASSES = [
  'report-dashboard',
  'report-metrics',
  'report-metric',
  'report-metric-label',
  'report-metric-value',
  'report-metric-delta',
  'report-findings',
  'report-finding',
  'report-finding-attention',
  'report-finding-positive',
  'report-finding-neutral',
  'report-finding-title',
  'report-evidence',
  'report-note',
  'report-citation',
  'report-table',
  'report-table-value',
  'report-table-positive',
  'report-table-negative',
  'report-table-section',
] as const;

export const REPORT_HTML_TAGS = [
  'h2',
  'h3',
  'p',
  'strong',
  'b',
  'em',
  'a',
  'ul',
  'ol',
  'li',
  'table',
  'thead',
  'tbody',
  'tr',
  'th',
  'td',
  'div',
  'section',
  'span',
] as const;

export const REPORT_HTML_CSS = `
.report-dashboard { color:var(--text); background:var(--surface); font:400 15px/1.5 Roboto,"Open Sans","Helvetica Neue",Arial,sans-serif; }
.report-metrics { display:grid; grid-template-columns:repeat(auto-fit,minmax(180px,1fr)); gap:16px; }
.report-metric { background:var(--surface-raised); border:1px solid var(--border); border-radius:12px; padding:18px; }
.report-metric-label,.report-evidence,.report-note,.report-metric-delta { color:var(--text-muted); font-size:13px; }
.report-metric-value { font-size:28px; font-weight:500; font-variant-numeric:tabular-nums; }
.report-findings { display:grid; gap:16px; }
.report-finding { padding:16px; border-left:4px solid var(--border-strong); }
.report-finding-attention { border-color:var(--warning); background:var(--warning-bg); color:var(--warning); }
.report-finding-positive { border-color:var(--success); background:var(--success-bg); color:var(--success); }
.report-table { width:100%; border-collapse:collapse; font-size:14px; }
.report-table th,.report-table td { border:1px solid var(--border-strong); padding:8px; font-variant-numeric:tabular-nums; }
.report-table th,.report-table-section { background:var(--accent-soft); font-weight:500; }
.report-table-value { text-align:right; }
.report-table-positive { color:var(--positive); }
.report-table-negative { color:var(--negative); }
`;
