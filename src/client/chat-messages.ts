import type { LocalMessage, LocalSession } from './storage.js';

export const FIRST_WELCOME_MESSAGE_ID = 'jieyou-first-welcome';
export const FIRST_WELCOME_MESSAGE = `嗨，欢迎你来。🌿

在这里，不需要想好怎么说，也不用急着整理好情绪。

如果愿意，就从最近最想说的一件小事开始吧。

我在听。`;

export function createFirstWelcomeMessage(session: Pick<LocalSession, 'id' | 'createdAt' | 'currentIssueId'>): LocalMessage {
  return {
    id: FIRST_WELCOME_MESSAGE_ID,
    sessionId: session.id,
    role: 'assistant',
    content: FIRST_WELCOME_MESSAGE,
    createdAt: session.createdAt,
    issueId: session.currentIssueId,
  };
}

/**
 * The welcome message is presentation-only. Keep it outside the persisted
 * business message list so it is never sent to the API or booking summary.
 */
export function messagesForDisplay(session: Pick<LocalSession, 'id' | 'createdAt' | 'currentIssueId'>, messages: LocalMessage[]) {
  return [createFirstWelcomeMessage(session), ...messages.filter((message) => message.id !== FIRST_WELCOME_MESSAGE_ID)];
}
