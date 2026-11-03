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
});
