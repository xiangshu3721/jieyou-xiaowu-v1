import { describe, expect, it } from 'vitest';
import { messagesForIssue, parseIssueContext, userMessagesForIssue } from './issue.js';

describe('V1.6 Issue 上下文边界', () => {
  it('摘要和导诊上下文只读取指定 Issue', () => {
    const messages = [
      { role: 'user' as const, content: '工作焦虑和失眠', issueId: 'issue-a' },
      { role: 'assistant' as const, content: '旧 Issue 的 AI 回复', issueId: 'issue-a' },
      { role: 'user' as const, content: '刚离婚后很迷茫', issueId: 'issue-b' },
    ];
    expect(messagesForIssue(messages, 'issue-b')).toHaveLength(1);
    expect(userMessagesForIssue(messages, 'issue-b').map((message) => message.content)).toEqual(['刚离婚后很迷茫']);
  });

  it('兼容没有 Issue 标签的旧客户端请求', () => {
    const messages = [{ role: 'user' as const, content: '旧消息' }];
    expect(messagesForIssue(messages, 'issue-current')).toEqual(messages);
  });

  it('预约提交后的 Issue 保留不可变 Booking Case 标识', () => {
    expect(parseIssueContext({ issue_id: 'issue-a', status: 'BOOKING_SUBMITTED', booking_case_id: 'case-a' })).toEqual({
      issue_id: 'issue-a',
      status: 'BOOKING_SUBMITTED',
      topic_tags: [],
      handoff_offered: true,
      booking_case_id: 'case-a',
    });
  });
});
