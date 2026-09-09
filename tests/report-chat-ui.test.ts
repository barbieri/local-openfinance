import { Chat } from '@ai-sdk/react';
import { type ChatTransport, simulateReadableStream, type UIMessage } from 'ai';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import Markdown from 'react-markdown';
import { describe, expect, it } from 'vitest';
import { findFailedChatTurn } from '../src/web/client/lib/report-chat.js';
import {
  normalizeReportChatMarkdown,
  REPORT_MARKDOWN_COMPONENTS,
} from '../src/web/client/lib/report-markdown.js';

describe('report chat UI recovery', () => {
  it('renders assistant Markdown and supported transaction anchors', () => {
    const html = renderToStaticMarkup(
      createElement(
        Markdown,
        { components: REPORT_MARKDOWN_COMPONENTS },
        normalizeReportChatMarkdown(
          'O maior gasto foi **R$ 50.000,00**. <a href="#/transaction/9fab890c-a0e4-486e-bd6b-f80702695c01">Ver lançamento</a>.',
        ),
      ),
    );

    expect(html).toContain('<strong>R$ 50.000,00</strong>');
    expect(html).toContain('href="#/transaction/9fab890c-a0e4-486e-bd6b-f80702695c01"');
    expect(html).not.toContain('&lt;a href=');
  });

  it('does not turn an unsupported HTML anchor into a Markdown link', () => {
    const markdown = '<a href="https://attacker.invalid/">See more</a>';

    expect(normalizeReportChatMarkdown(markdown)).toBe(markdown);
  });

  it('renders an absolute transaction anchor from the current app origin', () => {
    const originalLocation = Object.getOwnPropertyDescriptor(globalThis, 'location');
    Object.defineProperty(globalThis, 'location', {
      configurable: true,
      value: {
        origin: 'https://finance.example',
        pathname: '/',
      },
    });
    try {
      expect(
        normalizeReportChatMarkdown(
          '<a href="https://finance.example/#/transaction/9fab890c-a0e4-486e-bd6b-f80702695c01">Ver lançamento</a>',
        ),
      ).toBe(
        '[Ver lançamento](https://finance.example/#/transaction/9fab890c-a0e4-486e-bd6b-f80702695c01)',
      );
    } finally {
      if (originalLocation) {
        Object.defineProperty(globalThis, 'location', originalLocation);
      } else {
        Reflect.deleteProperty(globalThis, 'location');
      }
    }
  });

  it('regenerates a failed request without appending a second user message', async () => {
    const requests: UIMessage[][] = [];
    const transport: ChatTransport<UIMessage> = {
      sendMessages: async ({ messages }) => {
        requests.push(messages);
        if (requests.length === 1) {
          throw new TypeError('network failure');
        }
        return simulateReadableStream({
          chunks: [
            { type: 'start', messageId: 'assistant-1' },
            { type: 'text-start', id: 'text-1' },
            { type: 'text-delta', id: 'text-1', delta: 'Recovered' },
            { type: 'text-end', id: 'text-1' },
            { type: 'finish', finishReason: 'stop' },
          ],
        });
      },
      reconnectToStream: async () => null,
    };
    const chat = new Chat({ id: 'weekly:current', transport });

    await chat.sendMessage({ text: 'Retry me' });
    expect(chat.status).toBe('error');
    chat.clearError();
    await chat.regenerate();

    expect(requests.map((messages) => messages.map((message) => message.role))).toEqual([
      ['user'],
      ['user'],
    ]);
    expect(chat.messages.map((message) => message.role)).toEqual(['user', 'assistant']);
  });

  it('recovers the last failed user turn without retaining partial assistant output', () => {
    const persisted: UIMessage = {
      id: 'assistant-1',
      role: 'assistant',
      parts: [{ type: 'text', text: 'Stored answer' }],
    };
    const failed: UIMessage = {
      id: 'user-2',
      role: 'user',
      parts: [{ type: 'text', text: 'Please retry this' }],
    };
    const partial: UIMessage = {
      id: 'assistant-2',
      role: 'assistant',
      parts: [{ type: 'text', text: 'Partial' }],
    };

    expect(findFailedChatTurn([persisted, failed, partial])).toEqual({
      previousMessages: [persisted],
      text: 'Please retry this',
    });
  });
});
