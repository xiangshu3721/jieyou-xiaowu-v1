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

  it('询问要不要真人不是接受交接，明确要求时仍接受', () => {
    expect(detectConversationControl('要不要找真人聊聊？', true)).toBe('GENERAL_CHAT');
    expect(detectConversationControl('我是不是该找导师？', true)).toBe('GENERAL_CHAT');
    expect(detectConversationControl('我想找真人导师聊聊', true)).toBe('ACCEPT_HANDOFF');
    expect(detectConversationControl('我想预约真人导师', true)).toBe('ACCEPT_HANDOFF');
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

  it('TEST_G：工作 → 感情 → 亲子后，提到以前工作应恢复原 Issue 而不是创建新的', () => {
    const allPreviousMessages = [
      { role: 'user' as const, content: '工作项目太多，我已经有点睡不着', issueId: 'issue-a' },
      { role: 'assistant' as const, content: '先列出最紧急的一件事', issueId: 'issue-a' },
      { role: 'user' as const, content: '和伴侣关系很紧张', issueId: 'issue-b' },
      { role: 'user' as const, content: '孩子最近不愿意上学', issueId: 'issue-c' },
    ];
    const resolution = resolveCurrentIssue({
      message: '我们回到之前工作的问题吧',
      currentIssueId: 'issue-c',
      currentIssue: parseIssueContext({ issue_id: 'issue-c', status: 'ACTIVE', topic_tags: ['PARENTING'] }),
      previousMessages: [{ role: 'user', content: '孩子最近不愿意上学', issueId: 'issue-c' }],
      allPreviousMessages,
      knownIssues: [
        parseIssueContext({ issue_id: 'issue-a', status: 'PAUSED', topic_tags: ['EMOTION', 'CAREER'] }),
        parseIssueContext({ issue_id: 'issue-b', status: 'PAUSED', topic_tags: ['INTIMACY'] }),
        parseIssueContext({ issue_id: 'issue-c', status: 'ACTIVE', topic_tags: ['PARENTING'] }),
      ],
      previousTopics: ['PARENTING'],
    });
    expect(resolution).toMatchObject({
      control_intent: 'CONTINUE_CURRENT_TOPIC',
      issue_action: 'RESUME_PREVIOUS',
      current_issue_id: 'issue-a',
      previous_issue_id: 'issue-c',
      new_issue_detected: false,
      awaiting_topic: false,
    });
    expect(allPreviousMessages).toHaveLength(4);
  });

  it('回到刚才的旧话题取最近的上一 Issue，继续当前则不误切', () => {
    const allPreviousMessages = [
      { role: 'user' as const, content: '工作压力很大', issueId: 'issue-a' },
      { role: 'user' as const, content: '我和伴侣吵架了', issueId: 'issue-b' },
      { role: 'user' as const, content: '孩子最近不愿上学', issueId: 'issue-c' },
    ];
    const common = {
      currentIssueId: 'issue-c',
      currentIssue: parseIssueContext({ issue_id: 'issue-c', status: 'ACTIVE', topic_tags: ['PARENTING'] }),
      previousMessages: [{ role: 'user' as const, content: '孩子最近不愿上学', issueId: 'issue-c' }],
      allPreviousMessages,
      previousTopics: ['PARENTING' as const],
    };
    expect(resolveCurrentIssue({ ...common, message: '回到刚才那个话题' }).current_issue_id).toBe('issue-b');
    expect(resolveCurrentIssue({ ...common, message: '继续聊这个问题' }).current_issue_id).toBe('issue-c');
  });

  it('多个旧工作困扰时不擅自归并；从未有过的旧主题也不虚构', () => {
    const prior = [
      { role: 'user' as const, content: '工作里的同事冲突', issueId: 'issue-a' },
      { role: 'user' as const, content: '我因为求职很迷茫', issueId: 'issue-b' },
      { role: 'user' as const, content: '我和伴侣最近不合', issueId: 'issue-c' },
    ];
    const common = {
      currentIssueId: 'issue-c',
      currentIssue: parseIssueContext({ issue_id: 'issue-c', status: 'ACTIVE' }),
      previousMessages: [{ role: 'user' as const, content: '我和伴侣最近不合', issueId: 'issue-c' }],
      allPreviousMessages: prior,
    };
    expect(resolveCurrentIssue({ ...common, message: '回到之前的工作问题吧' })).toMatchObject({
      issue_action: 'CONTINUE_CURRENT', return_lookup: 'AMBIGUOUS', current_issue_id: 'issue-c',
    });
    expect(resolveCurrentIssue({ ...common, message: '回到之前的亲子问题吧' })).toMatchObject({
      issue_action: 'CONTINUE_CURRENT', return_lookup: 'NOT_FOUND', current_issue_id: 'issue-c',
    });
  });

  it('未发生明确回顾时，工作压力导致睡眠问题仍留在原 Issue', () => {
    const r = resolveCurrentIssue({
      message: '工作压力让我晚上一直失眠',
      currentIssueId: 'issue-work',
      currentIssue: parseIssueContext({ issue_id: 'issue-work', status: 'ACTIVE', topic_tags: ['CAREER', 'EMOTION'] }),
      previousMessages: [{ role: 'user', content: '最近工作压力太大', issueId: 'issue-work' }],
      previousTopics: ['CAREER', 'EMOTION'],
    });
    expect(r.issue_action).toBe('CONTINUE_CURRENT');
    expect(r.current_issue_id).toBe('issue-work');
  });

  it('仅存在当前话题时“回到刚才”仍继续，不谎称历史记录不存在', () => {
    const current = parseIssueContext({ issue_id: 'issue-current', status: 'ACTIVE', topic_tags: ['CAREER'] });
    for (const message of ['回到刚才的话题', '回到之前工作的问题吧']) {
      const resolution = resolveCurrentIssue({
        message, currentIssueId: 'issue-current', currentIssue: current,
        previousMessages: [{ role: 'user', content: '最近工作压力大', issueId: 'issue-current' }],
        allPreviousMessages: [{ role: 'user', content: '最近工作压力大', issueId: 'issue-current' }],
      });
      expect(resolution.current_issue_id).toBe('issue-current');
      expect(resolution.issue_action).toBe('CONTINUE_CURRENT');
      expect(resolution.return_lookup).toBeUndefined();
    }
  });

  it('恢复 Issue 可携带已保存的轮次数，不丢历史进展和预约状态', () => {
    const issue = parseIssueContext({
      issue_id: 'issue-old', status: 'BOOKING_SUBMITTED', handoff_state: 'ACCEPTED',
      booking_case_id: 'case-old', user_turn_count: 61,
    });
    expect(issue.user_turn_count).toBe(61);
    expect(issue.status).toBe('BOOKING_SUBMITTED');
    expect(issue.booking_case_id).toBe('case-old');
  });

  it('阶段 1.3：用户纠正 AI 理解时继续当前 Issue', () => {
    const resolution = resolveCurrentIssue({
      message: '你理解错了，不要往自我价值感上分析',
      currentIssueId: 'issue-a',
      currentIssue: parseIssueContext({ issue_id: 'issue-a', status: 'ACTIVE', topic_tags: ['CAREER'] }),
      previousMessages: [{ role: 'user', content: '最近工作压力很大', issueId: 'issue-a' }],
      previousTopics: ['CAREER'],
    });
    expect(resolution.control_intent).toBe('GENERAL_CHAT');
    expect(resolution.issue_action).toBe('CONTINUE_CURRENT');
    expect(resolution.current_issue_id).toBe('issue-a');
    expect(resolution.new_issue_detected).toBe(false);
  });

  it('阶段 1.3：明确拒绝真人时保留当前 Issue 并继续聊天', () => {
    const message = '暂时不想找真人，先这样聊聊就好';
    const resolution = resolveCurrentIssue({
      message,
      currentIssueId: 'issue-a',
      currentIssue: parseIssueContext({ issue_id: 'issue-a', status: 'HANDOFF_OFFERED', handoff_offered: true, handoff_state: 'OFFERED' }),
      previousMessages: [{ role: 'user', content: '工作压力很大', issueId: 'issue-a' }],
      previousTopics: ['CAREER'],
    });
    expect(detectConversationControl(message, true)).toBe('DECLINE_HANDOFF');
    expect(resolution.control_intent).toBe('DECLINE_HANDOFF');
    expect(resolution.issue_action).toBe('CONTINUE_CURRENT');
    expect(resolution.current_issue_id).toBe('issue-a');
    expect(resolution.new_issue_detected).toBe(false);
  });

  it('阶段 1.3：明确拒绝真人且尚未展示入口时也不误判为接受真人', () => {
    expect(detectConversationControl('我暂时不想找真人，先自己聊聊', false)).toBe('DECLINE_HANDOFF');
    expect(detectConversationControl('我想找真人导师聊聊', false)).toBe('ACCEPT_HANDOFF');
  });

  it('阶段 1.3：算了和不用了只有在真人入口已展示时才视为拒绝预约', () => {
    for (const message of ['算了', '不用了']) {
      expect(detectConversationControl(message, false)).not.toBe('DECLINE_HANDOFF');
      expect(detectConversationControl(message, true)).toBe('DECLINE_HANDOFF');
    }
    expect(detectConversationControl('不想找真人', false)).toBe('DECLINE_HANDOFF');
  });
});
