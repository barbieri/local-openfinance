import type { UIMessage } from 'ai';

export function uiMessageText(message: UIMessage): string {
  let text = '';
  for (const part of message.parts) {
    if (part.type === 'text') {
      text += part.text;
    }
  }
  return text;
}

export function findFailedChatTurn(messages: readonly UIMessage[]): {
  readonly previousMessages: UIMessage[];
  readonly text: string;
} | null {
  const userIndex = messages.findLastIndex((message) => message.role === 'user');
  if (userIndex < 0) {
    return null;
  }
  const userMessage = messages[userIndex];
  if (!userMessage) {
    return null;
  }
  return {
    previousMessages: messages.slice(0, userIndex),
    text: uiMessageText(userMessage),
  };
}
