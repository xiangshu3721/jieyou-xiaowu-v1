import { describe, expect, it } from 'vitest';
import { analyzeConversation, resetForAwaitingTopic } from './rules.js';
import { applyDeclinedHandoff, detectConversationControl, messagesForIssue, parseIssueContext, resolveCurrentIssue, userMessagesForIssue } from './issue.js';

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
      handoff_state: 'ACCEPTED',
      booking_case_id: 'case-a',
    });
  });

  it('TEST_A：旧 Issue 已推荐真人时，明确换话题会创建等待新话题的 Issue', () => {
    const resolution = resolveCurrentIssue({
      message: '算了跟你聊点别的吧',
      currentIssueId: 'issue-a',
      currentIssue: parseIssueContext({ issue_id: 'issue-a', status: 'HANDOFF_OFFERED', handoff_offered: true }),
      previousMessages: [{ role: 'user', content: '工作压力很大', issueId: 'issue-a' }],
      previousTopics: ['CAREER', 'EMOTION'],
    });
    expect(resolution.control_intent).toBe('SWITCH_TOPIC');
    expect(resolution.issue_action).toBe('CREATE_NEW');
    expect(resolution.awaiting_topic).toBe(true);
    expect(resolution.previous_issue_id).toBe('issue-a');
    expect(resolution.current_issue_id).not.toBe('issue-a');
  });

  it('TEST_B：换话题消息本身带有新困扰时，直接创建新 Issue', () => {
    const resolution = resolveCurrentIssue({
      message: '这个先不聊了，我最近还有个情感关系的烦恼',
      currentIssueId: 'issue-a',
      currentIssue: parseIssueContext({ issue_id: 'issue-a', status: 'HANDOFF_OFFERED', handoff_offered: true }),
      previousMessages: [{ role: 'user', content: '工作压力很大', issueId: 'issue-a' }],
      previousTopics: ['CAREER', 'EMOTION'],
    });
    expect(resolution.control_intent).toBe('NEW_ISSUE');
    expect(resolution.awaiting_topic).toBe(false);
    const analysis = analyzeConversation('我最近还有个情感关系的烦恼', '', { issueId: resolution.current_issue_id, userTurnCount: 1, newIssueDetected: true });
    expect(analysis.show_booking_button).toBe(false);
  });

  it('TEST_C：新 Issue 第一轮不会继承旧 Issue 的预约状态', () => {
    const analysis = analyzeConversation('我最近有另外一个烦恼，就是情感关系。', '', {
      issueId: 'issue-b',
      userTurnCount: 1,
      handoffOffered: false,
      newIssueDetected: true,
    });
    expect(analysis.current_issue_id).toBe('issue-b');
    expect(analysis.user_turn_count).toBe(1);
    expect(analysis.handoff_offered).toBe(false);
    expect(analysis.handoff_state).toBe('NOT_READY');
    expect(analysis.show_booking_button).toBe(false);
  });

  it('TEST_D：等待新话题的 Issue 会清空 Handoff、复杂度和旧问题地图', () => {
    const old = analyzeConversation('工作压力很大，已经持续很久，晚上也睡不好', '', { issueId: 'issue-a', userTurnCount: 4, handoffOffered: true, issueStatus: 'HANDOFF_OFFERED' });
    const fresh = resetForAwaitingTopic(old, 'issue-a');
    expect(fresh.issue_status).toBe('AWAITING_TOPIC');
    expect(fresh.user_turn_count).toBe(0);
    expect(fresh.handoff_ready).toBe(false);
    expect(fresh.handoff_offered).toBe(false);
    expect(fresh.show_booking_button).toBe(false);
    expect(fresh.problem_map.main_issue).toBeNull();
  });

  it('TEST_E：预约 CTA 状态属于产生它的消息，而不是整个 Conversation', () => {
    const old = analyzeConversation('我想找真人导师聊聊', '', { issueId: 'issue-a' });
    const fresh = analyzeConversation('我最近和我爸关系很差', '', { issueId: 'issue-b', userTurnCount: 1, newIssueDetected: true });
    expect(old.show_booking_button).toBe(true);
    expect(fresh.show_booking_button).toBe(false);
    expect(old.current_issue_id).not.toBe(fresh.current_issue_id);
  });

  it('TEST_F：用户拒绝真人后继续当前 Issue，不再重复推荐', () => {
    expect(detectConversationControl('不找真人了，继续聊吧', true)).toBe('DECLINE_HANDOFF');
    const baseline = analyzeConversation('我还是跟你聊吧', '工作压力很大', { issueId: 'issue-a', userTurnCount: 4, handoffOffered: true, issueStatus: 'HANDOFF_OFFERED' });
    const declined = applyDeclinedHandoff(baseline);
    expect(declined.issue_status).toBe('ACTIVE');
    expect(declined.handoff_state).toBe('DECLINED');
    expect(declined.show_booking_button).toBe(false);
    expect(declined.routing).toBe('AI_SUPPORT');
  });

  it('TEST_F2：刷新后仍保留当前 Issue 的 DECLINED 状态', () => {
    const context = parseIssueContext({ issue_id: 'issue-a', status: 'ACTIVE', handoff_offered: true, handoff_state: 'DECLINED' });
    expect(context.handoff_state).toBe('DECLINED');
    const baseline = analyzeConversation('我还是想先自己聊聊', '工作压力很大', {
      issueId: 'issue-a',
      userTurnCount: 5,
      handoffOffered: false,
      issueStatus: context.status,
    });
    const continued = applyDeclinedHandoff(baseline);
    expect(continued.handoff_state).toBe('DECLINED');
    expect(continued.show_booking_button).toBe(false);
  });

  it('TEST_G：回到刚才的话题时不创建异常 Issue', () => {
    const resolution = resolveCurrentIssue({
      message: '我们回到刚才工作的问题吧',
      currentIssueId: 'issue-b',
      currentIssue: parseIssueContext({ issue_id: 'issue-b', status: 'ACTIVE' }),
      previousMessages: [{ role: 'user', content: '感情关系让我很烦', issueId: 'issue-b' }],
      previousTopics: ['INTIMACY'],
    });
    expect(resolution.control_intent).toBe('CONTINUE_CURRENT_TOPIC');
    expect(resolution.issue_action).toBe('CONTINUE_CURRENT');
    expect(resolution.current_issue_id).toBe('issue-b');
  });
});
