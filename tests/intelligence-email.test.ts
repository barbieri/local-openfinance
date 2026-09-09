import { describe, expect, it, vi } from 'vitest';
import type { IntelligenceChart } from '../src/intelligence/charts.js';
import {
  buildReportEmailMessage,
  buildSmtpTransportOptions,
  deliverReportEmail,
  escapeHtml,
  type ReportEmailContent,
} from '../src/intelligence/email.js';
import type { ResolvedAppConfig } from '../src/types.js';

const smtp: NonNullable<ResolvedAppConfig['notify']['smtp']> = {
  host: 'smtp.example.test',
  port: 587,
  secure: false,
  from: 'reports@example.test',
  to: ['owner@example.test'],
  auth: { user: 'reports', passEnvVar: 'REPORT_SMTP_PASSWORD' },
};

const chart: IntelligenceChart = {
  name: 'cashflow',
  filename: 'report-cashflow.png',
  cid: 'report-cashflow@local-openfinance',
  mimeType: 'image/png',
  bytes: Uint8Array.from([1, 2, 3]),
  altText: 'Cash flow chart',
};

const content: ReportEmailContent = {
  reportName: 'Weekly',
  subject: 'Weekly finances',
  period: { start: '2026-08-10', end: '2026-08-16' },
  dateStyle: 'weekly',
  language: 'pt-BR',
  html: '<p>Report body</p>',
  text: 'Report body',
  charts: [chart],
};

describe('intelligence report email', () => {
  it('centralizes complete HTML escaping for rendered email values', () => {
    expect(escapeHtml(`<tag attr="x">'&`)).toBe('&lt;tag attr=&quot;x&quot;&gt;&#39;&amp;');
  });

  it('embeds PNG attachments by CID in one message', () => {
    const message = buildReportEmailMessage(smtp, content);

    expect(message).toMatchObject({
      from: 'reports@example.test',
      to: ['owner@example.test'],
      subject: 'Weekly finances',
    });
    expect(message.html).toContain('src="cid:report-cashflow@local-openfinance"');
    expect(message.attachments).toEqual([
      expect.objectContaining({
        filename: 'report-cashflow.png',
        cid: 'report-cashflow@local-openfinance',
        contentType: 'image/png',
        disposition: 'inline',
      }),
    ]);
    expect(JSON.stringify(message)).not.toContain('REPORT_SMTP_PASSWORD');
  });

  it('renders the required alternative text for every inline image', () => {
    const message = buildReportEmailMessage(smtp, {
      ...content,
      charts: [{ ...chart, altText: 'Balance & allocation <chart>' }],
    });

    expect(message.html).toContain('alt="Balance &amp; allocation &lt;chart&gt;"');
  });

  it('returns the complete message without opening a transport in dry-run mode', async () => {
    const sendMail = vi.fn(async () => undefined);
    const result = await deliverReportEmail({
      smtp,
      content,
      dryRun: true,
      transport: { sendMail },
    });

    expect(result.sent).toBe(false);
    expect(result.message.attachments).toHaveLength(1);
    expect(sendMail).not.toHaveBeenCalled();
  });

  it('sends exactly once through an injected transport', async () => {
    const sendMail = vi.fn(async () => ({ messageId: 'message-1' }));
    const result = await deliverReportEmail({
      smtp,
      content,
      dryRun: false,
      transport: { sendMail },
    });

    expect(result.sent).toBe(true);
    expect(sendMail).toHaveBeenCalledOnce();
    expect(sendMail).toHaveBeenCalledWith(result.message);
  });

  it('fails before connecting when the configured password variable is missing', async () => {
    await expect(deliverReportEmail({ smtp, content, dryRun: false, env: {} })).rejects.toThrow(
      'REPORT_SMTP_PASSWORD',
    );
  });

  it('requires STARTTLS before authenticating when TLS does not start with the connection', () => {
    const options = buildSmtpTransportOptions(smtp, {
      REPORT_SMTP_PASSWORD: 'secret',
    });

    expect(options).toMatchObject({
      secure: false,
      requireTLS: true,
      auth: { user: 'reports', pass: 'secret' },
    });
  });
});
