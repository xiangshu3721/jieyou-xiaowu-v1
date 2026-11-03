import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./main.tsx', import.meta.url), 'utf8');

describe('聊天删除边界', () => {
  it('send 不再根据聊天文本触发本地或学习数据删除', () => {
    const sendStart = source.indexOf('  async function send()');
    const revokeStart = source.indexOf('  async function revokeLearningConsent()');
    expect(sendStart).toBeGreaterThanOrEqual(0);
    expect(revokeStart).toBeGreaterThan(sendStart);
    const sendBody = source.slice(sendStart, revokeStart);

    expect(sendBody).not.toContain('clearLocalMessages');
    expect(sendBody).not.toContain('deleteLearningSession');
    expect(sendBody).toContain("api<ChatResponse>('/api/chat'");
  });

  it('撤回学习授权与清空本地对话使用独立处理函数', () => {
    const revokeStart = source.indexOf('  async function revokeLearningConsent()');
    const clearStart = source.indexOf('  async function clearCurrentConversation()');
    expect(revokeStart).toBeGreaterThanOrEqual(0);
    expect(clearStart).toBeGreaterThan(revokeStart);
    const revokeBody = source.slice(revokeStart, clearStart);

    expect(revokeBody).toContain('setLearningConsent(false)');
    expect(revokeBody).toContain('deleteLearningSession(learningSessionId');
    expect(revokeBody).not.toContain('clearLocalMessages');
    expect(source).toContain('当前浏览器的本地聊天、相关问题状态和本地预约快照');
  });

  it('发送期间禁止清空，并区分清空事务与回读失败', () => {
    const clearStart = source.indexOf('  async function clearCurrentConversation()');
    const clearEnd = source.indexOf('\n  function useQuickPrompt', clearStart);
    expect(clearStart).toBeGreaterThanOrEqual(0);
    expect(clearEnd).toBeGreaterThan(clearStart);
    const clearBody = source.slice(clearStart, clearEnd);

    expect(clearBody).toContain('if (sending) return;');
    expect(source).toContain('<button disabled={sending} onClick={() => void clearCurrentConversation()}>清空本次对话</button>');
    expect(clearBody).toContain('本地记录未清除，当前页面未更改，请重试。');
    expect(clearBody).toContain('本地记录已清除，但页面重新读取失败，请刷新页面重试。');
    expect(clearBody).toContain('await clearLocalMessages();');
    expect(clearBody).toContain('const freshSession = await getOrCreateSession();');
  });

  it('真人快捷预约的异步过程也使用 sending 保护', () => {
    const bookingStart = source.indexOf('if (wantsHumanBooking(content))');
    const normalSendStart = source.indexOf("\n    setInput(''); setError(''); setSending(true); setSendingPhase('listening');", bookingStart + 1);
    expect(bookingStart).toBeGreaterThanOrEqual(0);
    expect(normalSendStart).toBeGreaterThan(bookingStart);
    const bookingBody = source.slice(bookingStart, normalSendStart);

    expect(bookingBody).toContain("setInput(''); setError(''); setSending(true); setSendingPhase('listening');");
    expect(bookingBody).toContain('await ensureBookingIssueId()');
    expect(bookingBody).toContain('await moveToBooking(issueId || undefined);');
    expect(bookingBody).toContain('setSending(false); setSendingPhase(\'listening\');');
  });
});
