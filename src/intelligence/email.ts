import process from 'node:process';
import nodemailer, { type SendMailOptions } from 'nodemailer';
import type SMTPTransport from 'nodemailer/lib/smtp-transport/index.js';
import type { ResolvedAppConfig } from '../types.js';
import type { IntelligenceChart } from './charts.js';
import type { LocalDatePeriod } from './period.js';
import { formatLocalizedReportPeriod, type ReportDateStyle } from './report-date-format.js';

type ResolvedSmtpConfig = ResolvedAppConfig['notify']['smtp'];

export type EmailContent = {
  readonly subject: string;
  readonly html: string;
  readonly text: string;
  readonly attachments: readonly InlineImageAttachment[];
  readonly language?: string | undefined;
};

export type InlineImageAttachment = {
  readonly filename: string;
  readonly bytes: Uint8Array;
  readonly mimeType: `image/${string}`;
  readonly cid: string;
  readonly altText: string;
};

export type ReportEmailContent = Omit<EmailContent, 'attachments'> & {
  readonly reportName: string;
  readonly period: LocalDatePeriod;
  readonly dateStyle: ReportDateStyle;
  readonly language: string;
  readonly charts: readonly IntelligenceChart[];
};

export type ReportEmailTransport = {
  readonly sendMail: (message: SendMailOptions) => Promise<unknown>;
};

export type ReportEmailDelivery = {
  readonly sent: boolean;
  readonly message: SendMailOptions;
};

export async function deliverEmail(input: {
  readonly smtp: ResolvedSmtpConfig;
  readonly content: EmailContent;
  readonly dryRun: boolean;
  readonly env?: NodeJS.ProcessEnv | undefined;
  readonly transport?: ReportEmailTransport | undefined;
}): Promise<ReportEmailDelivery> {
  if (!input.smtp) {
    throw new Error('SMTP delivery requires notify.smtp in the topic config.');
  }
  const message = buildEmailMessage(input.smtp, input.content);
  if (input.dryRun) {
    return { sent: false, message };
  }
  const transport = input.transport ?? createSmtpTransport(input.smtp, input.env ?? process.env);
  await transport.sendMail(message);
  return { sent: true, message };
}

export function buildReportEmailMessage(
  smtp: NonNullable<ResolvedSmtpConfig>,
  content: ReportEmailContent,
): SendMailOptions {
  return buildEmailMessage(smtp, toEmailContent(content));
}

function toEmailContent(content: ReportEmailContent): EmailContent {
  const period = formatLocalizedReportPeriod(content.period, content.dateStyle, content.language);
  return {
    subject: content.subject,
    html: `<header style="margin:0 0 24px"><p style="margin:0 0 6px;color:#64748b">${escapeHtml(period)}</p><p style="margin:0;font-size:24px;font-weight:700">${escapeHtml(content.reportName)}</p></header>${content.html}`,
    text: `${content.reportName}\n${period}\n\n${content.text}`,
    attachments: content.charts,
    language: content.language,
  };
}

function buildEmailMessage(
  smtp: NonNullable<ResolvedSmtpConfig>,
  content: EmailContent,
): SendMailOptions {
  return {
    from: smtp.from,
    to: [...smtp.to],
    subject: content.subject,
    text: content.text,
    html: renderEmailHtml(content),
    attachments: content.attachments.map((chart) => ({
      filename: chart.filename,
      content: Buffer.from(chart.bytes),
      contentType: chart.mimeType,
      cid: chart.cid,
      disposition: 'inline',
    })),
  };
}

export async function deliverReportEmail(input: {
  readonly smtp: ResolvedSmtpConfig;
  readonly content: ReportEmailContent;
  readonly dryRun: boolean;
  readonly env?: NodeJS.ProcessEnv | undefined;
  readonly transport?: ReportEmailTransport | undefined;
}): Promise<ReportEmailDelivery> {
  return deliverEmail({
    smtp: input.smtp,
    dryRun: input.dryRun,
    env: input.env,
    transport: input.transport,
    content: toEmailContent(input.content),
  });
}

function createSmtpTransport(
  smtp: NonNullable<ResolvedSmtpConfig>,
  env: NodeJS.ProcessEnv,
): ReportEmailTransport {
  return nodemailer.createTransport(buildSmtpTransportOptions(smtp, env));
}

export function buildSmtpTransportOptions(
  smtp: NonNullable<ResolvedSmtpConfig>,
  env: NodeJS.ProcessEnv,
): SMTPTransport.Options {
  const auth = smtp.auth
    ? {
        user: smtp.auth.user,
        pass: requireSmtpPassword(env, smtp.auth.passEnvVar),
      }
    : undefined;
  return {
    host: smtp.host,
    port: smtp.port,
    secure: smtp.secure,
    requireTLS: !smtp.secure,
    auth,
    connectionTimeout: 60_000,
    greetingTimeout: 30_000,
    socketTimeout: 5 * 60_000,
  };
}

function requireSmtpPassword(env: NodeJS.ProcessEnv, variableName: string): string {
  const password = env[variableName];
  if (!password) {
    throw new Error(`SMTP password environment variable ${variableName} is not set.`);
  }
  return password;
}

function renderEmailHtml(content: EmailContent): string {
  const chartHtml = content.attachments
    .map(
      (chart) =>
        `<figure style="margin:24px 0"><img src="cid:${escapeHtml(chart.cid)}" alt="${escapeHtml(chart.altText)}" style="display:block;width:100%;max-width:1200px;height:auto" /></figure>`,
    )
    .join('');
  return `<!doctype html>
<html lang="${escapeHtml(content.language ?? 'en')}">
  <head><meta charset="utf-8" /><meta name="viewport" content="width=device-width" /></head>
  <body style="margin:0;background:#f8fafc;color:#0f172a;font-family:Arial,sans-serif">
    <main style="max-width:1200px;margin:0 auto;padding:32px;background:#ffffff">
      ${content.html}
      ${chartHtml}
    </main>
  </body>
</html>`;
}

export function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
