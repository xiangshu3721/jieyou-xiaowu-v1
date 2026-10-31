import { describe, expect, it } from 'vitest';
import { FIRST_WELCOME_MESSAGE, FIRST_WELCOME_MESSAGE_ID, messagesForDisplay } from './chat-messages.js';
import type { LocalMessage } from './storage.js';

const session = { id: 'jieyou-main-session', createdAt: '2026-10-31T00:00:00.000Z', currentIssueId: 'issue-001' };

function businessMessage(content: string): LocalMessage {
  return { id: 'business-001', sessionId: session.id, role: 'user', content, createdAt: '2026-10-31T00:01:00.000Z', issueId: session.currentIssueId };
}

describe('first welcome message', () => {
  it('adds one presentation-only assistant message before business messages', () => {
    const messages = [businessMessage('最近有点累')];
    const visible = messagesForDisplay(session, messages);

    expect(visible.map((message) => message.id)).toEqual([FIRST_WELCOME_MESSAGE_ID, 'business-001']);
    expect(visible[0]).toMatchObject({ role: 'assistant', content: FIRST_WELCOME_MESSAGE, sessionId: session.id, issueId: session.currentIssueId });
    expect(messages).toHaveLength(1);
  });

  it('keeps one welcome message after refresh-like reconstruction and after clearing business messages', () => {
    const welcomeOnly = messagesForDisplay(session, []);
    const reconstructed = messagesForDisplay(session, [welcomeOnly[0], businessMessage('继续说说')]);

    expect(welcomeOnly.filter((message) => message.id === FIRST_WELCOME_MESSAGE_ID)).toHaveLength(1);
    expect(reconstructed.filter((message) => message.id === FIRST_WELCOME_MESSAGE_ID)).toHaveLength(1);
    expect(reconstructed[1].content).toBe('继续说说');
  });
});
