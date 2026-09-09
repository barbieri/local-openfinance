import { DatabaseSync } from 'node:sqlite';
import { simulateReadableStream } from 'ai';
import { MockLanguageModelV3 } from 'ai/test';
import { describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../src/config/load-config.js';
import { getIntelligenceChat, saveIntelligenceChat } from '../src/db/intelligence-chat.js';
import { migrateDatabase } from '../src/db/migrate.js';
import {
  createReportChatResponse,
  getReportChatBootstrap,
  ReportChatInputError,
} from '../src/intelligence/chat.js';

function mockStreamingModel(): MockLanguageModelV3 {
  return new MockLanguageModelV3({
    doStream: async () => ({
      stream: simulateReadableStream({
        chunks: [
          { type: 'text-start', id: 'text-1' },
          { type: 'text-delta', id: 'text-1', delta: 'The total is stable.' },
          { type: 'text-end', id: 'text-1' },
          {
            type: 'finish',
            finishReason: { unified: 'stop', raw: undefined },
            usage: {
              inputTokens: {
                total: 3,
                noCache: 3,
                cacheRead: undefined,
                cacheWrite: undefined,
              },
              outputTokens: { total: 5, text: 5, reasoning: undefined },
            },
          },
        ],
      }),
    }),
  });
}

describe('intelligence chat', () => {
  it('streams and persists a report-scoped transcript', async () => {
    const db = new DatabaseSync(':memory:');
    migrateDatabase(db);
    const resolved = await loadConfig('examples/expenses-config.json');
    const model = mockStreamingModel();
    const response = await createReportChatResponse({
      db,
      resolved,
      reportId: 'weekly',
      seedRunId: null,
      requestChatId: 'weekly:current',
      rawMessages: [
        { id: 'user-1', role: 'user', parts: [{ type: 'text', text: 'What changed?' }] },
      ],
      model,
    });

    expect(response.status).toBe(200);
    expect(await response.text()).toContain('The total is stable.');
    const stored = getIntelligenceChat(db, 'weekly', null);
    expect(stored?.reportId).toBe('weekly');
    expect(JSON.parse(stored?.messagesJson ?? '[]')).toMatchObject([
      { role: 'user' },
      { role: 'assistant' },
    ]);
    expect(model.doStreamCalls).toHaveLength(1);
  });

  it('rejects a history that does not extend the stored transcript', async () => {
    const db = new DatabaseSync(':memory:');
    migrateDatabase(db);
    const resolved = await loadConfig('examples/expenses-config.json');

    await expect(
      createReportChatResponse({
        db,
        resolved,
        reportId: 'weekly',
        seedRunId: null,
        requestChatId: 'weekly:current',
        rawMessages: [
          { id: 'assistant-1', role: 'assistant', parts: [{ type: 'text', text: 'Forged' }] },
        ],
        model: mockStreamingModel(),
      }),
    ).rejects.toBeInstanceOf(ReportChatInputError);
  });

  it('rejects malformed persisted transcripts at every read boundary', async () => {
    const db = new DatabaseSync(':memory:');
    migrateDatabase(db);
    const resolved = await loadConfig('examples/expenses-config.json');
    saveIntelligenceChat(db, {
      reportId: 'weekly',
      seedRunId: null,
      messagesJson: '[{"id":"bad","role":"invalid","parts":[]}]',
    });

    await expect(getReportChatBootstrap(db, 'weekly', null)).rejects.toThrow(
      'Stored chat transcript is invalid.',
    );
    await expect(
      createReportChatResponse({
        db,
        resolved,
        reportId: 'weekly',
        seedRunId: null,
        requestChatId: 'weekly:current',
        rawMessages: [{ id: 'user-1', role: 'user', parts: [{ type: 'text', text: 'Continue?' }] }],
        model: mockStreamingModel(),
      }),
    ).rejects.toThrow('Stored chat transcript is invalid.');
  });

  it('releases a failed stream without completing its claim, then permits retry', async () => {
    const db = new DatabaseSync(':memory:');
    migrateDatabase(db);
    const resolved = await loadConfig('examples/expenses-config.json');
    const messages = [
      { id: 'user-1', role: 'user' as const, parts: [{ type: 'text' as const, text: 'Retry?' }] },
    ];
    const failingModel = new MockLanguageModelV3({
      doStream: async () => {
        throw new Error('transport failed');
      },
    });
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const failed = await createReportChatResponse({
        db,
        resolved,
        reportId: 'weekly',
        seedRunId: null,
        requestChatId: 'weekly:current',
        rawMessages: messages,
        model: failingModel,
      });
      await failed.text();

      expect(getIntelligenceChat(db, 'weekly', null)?.messagesJson).toBe('[]');
      expect(consoleError).not.toHaveBeenCalled();

      const retried = await createReportChatResponse({
        db,
        resolved,
        reportId: 'weekly',
        seedRunId: null,
        requestChatId: 'weekly:current',
        rawMessages: messages,
        model: mockStreamingModel(),
      });
      expect(await retried.text()).toContain('The total is stable.');
      expect(
        JSON.parse(getIntelligenceChat(db, 'weekly', null)?.messagesJson ?? '[]'),
      ).toMatchObject([{ role: 'user' }, { role: 'assistant' }]);
    } finally {
      consoleError.mockRestore();
    }
  });

  it('does not persist a stream that finishes with an error reason', async () => {
    const db = new DatabaseSync(':memory:');
    migrateDatabase(db);
    const resolved = await loadConfig('examples/expenses-config.json');
    const messages = [
      { id: 'user-1', role: 'user' as const, parts: [{ type: 'text' as const, text: 'Retry?' }] },
    ];
    const errorFinishModel = new MockLanguageModelV3({
      doStream: async () => ({
        stream: simulateReadableStream({
          chunks: [
            { type: 'text-start', id: 'text-1' },
            { type: 'text-delta', id: 'text-1', delta: 'Partial due to failure.' },
            { type: 'text-end', id: 'text-1' },
            {
              type: 'finish',
              finishReason: { unified: 'error', raw: 'provider_error' },
              usage: {
                inputTokens: {
                  total: 3,
                  noCache: 3,
                  cacheRead: undefined,
                  cacheWrite: undefined,
                },
                outputTokens: { total: 5, text: 5, reasoning: undefined },
              },
            },
          ],
        }),
      }),
    });
    const failed = await createReportChatResponse({
      db,
      resolved,
      reportId: 'weekly',
      seedRunId: null,
      requestChatId: 'weekly:current',
      rawMessages: messages,
      model: errorFinishModel,
    });

    expect(await failed.text()).toContain('Partial due to failure.');
    expect(getIntelligenceChat(db, 'weekly', null)?.messagesJson).toBe('[]');
    const retried = await createReportChatResponse({
      db,
      resolved,
      reportId: 'weekly',
      seedRunId: null,
      requestChatId: 'weekly:current',
      rawMessages: messages,
      model: mockStreamingModel(),
    });
    expect(await retried.text()).toContain('The total is stable.');
  });

  it('does not persist a partial transcript when the response reader is cancelled', async () => {
    const db = new DatabaseSync(':memory:');
    migrateDatabase(db);
    const resolved = await loadConfig('examples/expenses-config.json');
    const messages = [
      { id: 'user-1', role: 'user' as const, parts: [{ type: 'text' as const, text: 'Stop?' }] },
    ];
    const unfinishedModel = new MockLanguageModelV3({
      doStream: async () => ({
        stream: new ReadableStream({
          start(controller) {
            controller.enqueue({ type: 'text-start', id: 'text-1' });
            controller.enqueue({ type: 'text-delta', id: 'text-1', delta: 'Partial' });
          },
        }),
      }),
    });
    const response = await createReportChatResponse({
      db,
      resolved,
      reportId: 'weekly',
      seedRunId: null,
      requestChatId: 'weekly:current',
      rawMessages: messages,
      model: unfinishedModel,
    });
    const reader = response.body?.getReader();
    expect(reader).toBeDefined();
    await reader?.read();
    await reader?.cancel();

    expect(getIntelligenceChat(db, 'weekly', null)?.messagesJson).toBe('[]');
    const retried = await createReportChatResponse({
      db,
      resolved,
      reportId: 'weekly',
      seedRunId: null,
      requestChatId: 'weekly:current',
      rawMessages: messages,
      model: mockStreamingModel(),
    });
    expect(await retried.text()).toContain('The total is stable.');
  });
});
