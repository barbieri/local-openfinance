import { useChat } from '@ai-sdk/react';
import { useQuery } from '@tanstack/react-query';
import { DefaultChatTransport, type UIMessage } from 'ai';
import { type FormEvent, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import Markdown from 'react-markdown';
import { toast } from 'sonner';
import { apiFetch, apiJson } from '../lib/api.js';
import { useAppNavigation } from '../lib/navigation.js';
import { findFailedChatTurn, uiMessageText } from '../lib/report-chat.js';
import { normalizeReportChatMarkdown, REPORT_MARKDOWN_COMPONENTS } from '../lib/report-markdown.js';

type ChatBootstrap = {
  readonly chatId: string;
  readonly messages: readonly UIMessage[];
};

export function ReportChat({
  reportId,
  reportName,
  runId,
}: {
  readonly reportId: string;
  readonly reportName: string;
  readonly runId: string | null;
}) {
  const { t } = useTranslation();
  const query = runId ? `?runId=${encodeURIComponent(runId)}` : '';
  const endpoint = `/api/intelligence/reports/${encodeURIComponent(reportId)}/chat`;
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['intelligence-chat', reportId, runId],
    queryFn: () => apiJson<ChatBootstrap>(`${endpoint}${query}`),
  });

  if (isLoading) {
    return <p className="text-sm text-muted-foreground">{t('reports.loading')}</p>;
  }
  if (isError || !data) {
    return (
      <p className="text-sm text-destructive">
        {error instanceof Error ? error.message : t('toast.error')}
      </p>
    );
  }
  return (
    <ReportChatConversation
      key={data.chatId}
      chatId={data.chatId}
      endpoint={endpoint}
      initialMessages={data.messages}
      reportId={reportId}
      reportName={reportName}
      runId={runId}
    />
  );
}

function ReportChatConversation({
  chatId,
  endpoint,
  initialMessages,
  reportId,
  reportName,
  runId,
}: {
  readonly chatId: string;
  readonly endpoint: string;
  readonly initialMessages: readonly UIMessage[];
  readonly reportId: string;
  readonly reportName: string;
  readonly runId: string | null;
}) {
  const { t } = useTranslation();
  const { setReportsSection } = useAppNavigation();
  const [input, setInput] = useState('');
  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: endpoint,
        fetch: apiFetch,
        body: { runId },
      }),
    [endpoint, runId],
  );
  const { messages, sendMessage, regenerate, setMessages, clearError, status, error, stop } =
    useChat({
      id: chatId,
      messages: [...initialMessages],
      transport,
    });
  const busy = status === 'submitted' || status === 'streaming';
  const failedTurn = error ? findFailedChatTurn(messages) : null;
  const clearChat = async () => {
    try {
      await apiJson<{ cleared: boolean }>(
        `${endpoint}${runId ? `?runId=${encodeURIComponent(runId)}` : ''}`,
        {
          method: 'DELETE',
        },
      );
      setMessages([]);
      clearError();
      toast.success(t('reports.chatCleared'));
    } catch (clearError) {
      toast.error(t('toast.error'), {
        description: clearError instanceof Error ? clearError.message : undefined,
      });
    }
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const text = input.trim();
    if (!text || busy) {
      return;
    }
    setInput('');
    void sendMessage({ text });
  };

  const retry = () => {
    clearError();
    void regenerate();
  };

  const editFailedMessage = () => {
    if (!failedTurn) {
      return;
    }
    setInput(failedTurn.text);
    setMessages(failedTurn.previousMessages);
    clearError();
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded border p-3 text-sm">
        <span>{reportName}</span>
        {runId ? (
          <button
            type="button"
            className="rounded border px-3 py-1.5 text-sm"
            onClick={() => setReportsSection(reportId, 'run', runId)}
          >
            {t('reports.chatViewReport')}
          </button>
        ) : null}
      </div>
      {runId ? <p className="text-xs text-muted-foreground">{t('reports.chatSeeded')}</p> : null}
      <div className="space-y-3" aria-live="polite">
        {messages.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('reports.chatEmpty')}</p>
        ) : (
          messages.map((message) => (
            <article
              key={message.id}
              className={`rounded-lg border p-3 text-sm ${
                message.role === 'user' ? 'ml-8 bg-accent' : 'mr-8 bg-background'
              }`}
            >
              <p className="mb-1 text-xs font-medium text-muted-foreground">
                {message.role === 'user' ? t('reports.chatYou') : t('reports.chatAssistant')}
              </p>
              <ReportChatMessage message={message} />
            </article>
          ))
        )}
      </div>
      {error ? (
        <div className="flex flex-wrap items-center gap-2 text-sm text-destructive">
          <p>{t('reports.chatError')}</p>
          {failedTurn ? (
            <>
              <button type="button" className="rounded border px-3 py-1.5" onClick={retry}>
                {t('reports.chatRetry')}
              </button>
              <button
                type="button"
                className="rounded border px-3 py-1.5"
                onClick={editFailedMessage}
              >
                {t('reports.chatEdit')}
              </button>
            </>
          ) : (
            <button type="button" className="rounded border px-3 py-1.5" onClick={clearError}>
              {t('reports.chatDismiss')}
            </button>
          )}
        </div>
      ) : null}
      <form className="space-y-2" onSubmit={submit}>
        <textarea
          aria-label={t('reports.chatInput')}
          className="min-h-24 w-full rounded border border-border bg-background p-3 text-sm"
          value={input}
          maxLength={8_000}
          onChange={(event) => setInput(event.target.value)}
          placeholder={t('reports.chatPlaceholder')}
        />
        <div className="flex justify-end gap-2">
          <button
            type="button"
            className="rounded border px-4 py-2 text-sm disabled:opacity-50"
            disabled={busy || messages.length === 0}
            onClick={() => void clearChat()}
          >
            {t('reports.chatClear')}
          </button>
          {busy ? (
            <button
              type="button"
              className="rounded border px-4 py-2 text-sm"
              onClick={() => void stop()}
            >
              {t('reports.chatStop')}
            </button>
          ) : null}
          <button
            type="submit"
            className="rounded bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
            disabled={busy || error !== undefined || input.trim().length === 0}
          >
            {t('reports.chatSend')}
          </button>
        </div>
      </form>
    </div>
  );
}

export function ReportChatMessage({ message }: { readonly message: UIMessage }) {
  const text = uiMessageText(message);
  if (message.role === 'user') {
    return <p className="whitespace-pre-wrap">{text}</p>;
  }
  return (
    <div className="space-y-2 whitespace-pre-wrap [&_a]:text-primary [&_a]:underline [&_ol]:ml-5 [&_ol]:list-decimal [&_ul]:ml-5 [&_ul]:list-disc">
      <Markdown components={REPORT_MARKDOWN_COMPONENTS}>
        {normalizeReportChatMarkdown(text)}
      </Markdown>
    </div>
  );
}
