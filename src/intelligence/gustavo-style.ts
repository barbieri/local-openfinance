// Generated Gustavo Style include. See design/README.md.
export const GUSTAVO_STYLE_CSS =
  '/* Generated from barbieri-playground/design/DESIGN.md. Do not edit tokens. */\n:root{color-scheme:light dark;\n--surface:#ffffff;\n--surface-sunken:#f6f7f9;\n--surface-raised:#ffffff;\n--border:#e5e7eb;\n--border-strong:#d8dee8;\n--text:#1f2937;\n--text-muted:#64748b;\n--accent:#2563eb;\n--accent-strong:#1d4ed8;\n--accent-soft:#eef2ff;\n--success:#047857;\n--success-bg:#ecfdf5;\n--error:#b91c1c;\n--error-bg:#fef2f2;\n--warning:#b45309;\n--warning-bg:#fffbeb;\n--info:#1d4ed8;\n--info-bg:#eff6ff;\n--positive:#16a34a;\n--negative:#dc2626;\n}\n\n@media(prefers-color-scheme:dark){:root:not([data-theme=light]){--surface:#1f2937;\n--surface-sunken:#111827;\n--surface-raised:#243044;\n--border:#374151;\n--border-strong:#4b5563;\n--text:#f9fafb;\n--text-muted:#9ca3af;\n--accent:#60a5fa;\n--accent-strong:#93c5fd;\n--accent-soft:#1e3a8a;\n--success:#34d399;\n--success-bg:#064e3b;\n--error:#fb7185;\n--error-bg:#4c0519;\n--warning:#fbbf24;\n--warning-bg:#451a03;\n--info:#60a5fa;\n--info-bg:#1e3a8a;\n--positive:#4ade80;\n--negative:#f87171;\n}\n}\n\n:root[data-theme=light]{color-scheme:light;\n--surface:#ffffff;\n--surface-sunken:#f6f7f9;\n--surface-raised:#ffffff;\n--border:#e5e7eb;\n--border-strong:#d8dee8;\n--text:#1f2937;\n--text-muted:#64748b;\n--accent:#2563eb;\n--accent-strong:#1d4ed8;\n--accent-soft:#eef2ff;\n--success:#047857;\n--success-bg:#ecfdf5;\n--error:#b91c1c;\n--error-bg:#fef2f2;\n--warning:#b45309;\n--warning-bg:#fffbeb;\n--info:#1d4ed8;\n--info-bg:#eff6ff;\n--positive:#16a34a;\n--negative:#dc2626;\n}\n\n:root[data-theme=dark]{color-scheme:dark;\n--surface:#1f2937;\n--surface-sunken:#111827;\n--surface-raised:#243044;\n--border:#374151;\n--border-strong:#4b5563;\n--text:#f9fafb;\n--text-muted:#9ca3af;\n--accent:#60a5fa;\n--accent-strong:#93c5fd;\n--accent-soft:#1e3a8a;\n--success:#34d399;\n--success-bg:#064e3b;\n--error:#fb7185;\n--error-bg:#4c0519;\n--warning:#fbbf24;\n--warning-bg:#451a03;\n--info:#60a5fa;\n--info-bg:#1e3a8a;\n--positive:#4ade80;\n--negative:#f87171;\n}\n\nbody{margin:0;\npadding:24px;\nbackground:#f6f7f9;\nbackground:var(--surface-sunken);\ncolor:#1f2937;\ncolor:var(--text);\nfont:400 15px/1.5 Roboto, "Open Sans", "Helvetica Neue", Arial, sans-serif;\n}\n\nmain{max-width:760px;\nmargin:auto;\npadding:24px;\nbackground:#ffffff;\nbackground:var(--surface);\ncolor:#1f2937;\ncolor:var(--text);\nborder:1px solid var(--border);\nborder-radius:12px}\n\nh1{font-size:24px;\nfont-weight:500}\nh2{font-size:18px;\nfont-weight:500}\nh3{font-size:16px;\nfont-weight:500}\n\na{color:#2563eb;\ncolor:var(--accent);\ntext-decoration:underline}\n\ntable{width:100%;\nborder-collapse:collapse;\nfont-size:14px;\nfont-variant-numeric:tabular-nums}\n\nth,td{border:1px solid var(--border-strong);\npadding:8px;\ntext-align:left}\nth{background:var(--accent-soft);\nfont-weight:500}\n\ntd.report-table-value{text-align:right}\n\nhr{border:0;\nborder-top:1px solid var(--border);\nmargin:22px 0}\n\npre{white-space:pre-wrap;\noverflow-wrap:anywhere;\nbackground:#f6f7f9;\nbackground:var(--surface-sunken);\ncolor:#1f2937;\ncolor:var(--text);\npadding:16px;\nborder-radius:12px}\n\n.material-icon{width:24px;\nheight:24px;\nvertical-align:middle;\nfill:currentColor;\nmargin-right:8px}\n\n';
export const CHART_FAMILIES = {
  indigo: ['#e0e7ff', '#a5b4fc', '#6366f1', '#4338ca', '#312e81'],
  blue: ['#dbeafe', '#93c5fd', '#3b82f6', '#1d4ed8', '#1e3a8a'],
  teal: ['#ccfbf1', '#5eead4', '#14b8a6', '#0f766e', '#134e4a'],
  green: ['#dcfce7', '#86efac', '#22c55e', '#15803d', '#14532d'],
  amber: ['#fef3c7', '#fcd34d', '#f59e0b', '#b45309', '#78350f'],
  orange: ['#ffedd5', '#fdba74', '#f97316', '#c2410c', '#7c2d12'],
  rose: ['#ffe4e6', '#fda4af', '#f43f5e', '#be123c', '#881337'],
  violet: ['#ede9fe', '#c4b5fd', '#8b5cf6', '#6d28d9', '#4c1d95'],
  slate: ['#f1f5f9', '#cbd5e1', '#94a3b8', '#475569', '#1e293b'],
} as const;
export const LIGHT_TOKENS = {
  surface: '#ffffff',
  'surface-sunken': '#f6f7f9',
  'surface-raised': '#ffffff',
  border: '#e5e7eb',
  'border-strong': '#d8dee8',
  text: '#1f2937',
  'text-muted': '#64748b',
  accent: '#2563eb',
  'accent-strong': '#1d4ed8',
  'accent-soft': '#eef2ff',
  success: '#047857',
  'success-bg': '#ecfdf5',
  error: '#b91c1c',
  'error-bg': '#fef2f2',
  warning: '#b45309',
  'warning-bg': '#fffbeb',
  info: '#1d4ed8',
  'info-bg': '#eff6ff',
  positive: '#16a34a',
  negative: '#dc2626',
} as const;
