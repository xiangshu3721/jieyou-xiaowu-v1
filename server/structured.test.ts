import { describe, expect, it } from 'vitest';
import { analyzeConversation } from './rules.js';
import { fallbackReply, mergeAnalysis, naturalReply, normalizeUserReply, parseAssistantOutput } from './structured.js';

describe('结构化 AI 输出校验', () => {
  it('解析合法 JSON，不把内部字段直接当成用户回复', () => {
    const parsed = parseAssistantOutput(JSON.stringify({
      conversation_state: 'EXPLORATION',
      primary_topic: 'CAREER',
      secondary_topics: ['EMOTION'],
      user_intent: 'WANTS_CLARITY',
      routing_state: 'AI_SELF_HELP',
      booking_preference: 'NOT_EXPRESSED',
      safety_status: 'NO_SIGNAL_DETECTED',
      confirmed_facts: ['最近工作压力很大'],
      assistant_reply: '我们先把你最想厘清的那一部分说具体一点。',
    }));
    expect(parsed?.reply).toContain('厘清');
    expect(parsed?.analysis.primary_topic).toBe('CAREER');
  });

  it('解析 V1.2 导诊字段，并限制枚举和值域', () => {
    const parsed = parseAssistantOutput(JSON.stringify({
      routing: 'AI_SUPPORT',
      complexity: 'MODERATE',
      depth_level: 'D1',
      diagnostic_sufficiency: 1.4,
      information_gaps: ['现实约束'],
      assessment: { needed: true, recommended_tool: '职业兴趣与决策辅助', reason: '帮助比较选项' },
      assistant_reply: '我们先看一个最关键的现实约束。',
    }));
    expect(parsed?.analysis.routing).toBe('AI_SUPPORT');
    expect(parsed?.analysis.complexity).toBe('MODERATE');
    expect(parsed?.analysis.depth_level).toBe('D1');
    expect(parsed?.analysis.diagnostic_sufficiency).toBe(1);
    expect(parsed?.analysis.assessment?.needed).toBe(true);
  });

  it('解析 V1.3 回复节奏和交接字段，并限制值域', () => {
    const parsed = parseAssistantOutput(JSON.stringify({
      conversation_mode: 'HANDOFF',
      response_goal: 'HANDOFF',
      problem_clarity: 1.4,
      severity_level: 'MODERATE_HIGH',
      ai_help_value: -1,
      human_help_value: 0.8,
      handoff_state: 'OFFERED',
      reply_length: 'SHORT',
      ask_question: true,
      show_booking_button: true,
      handoff_ready: true,
      assistant_reply: '我们先停在这里，不再继续追问。',
    }));
    expect(parsed?.analysis.conversation_mode).toBe('HANDOFF');
    expect(parsed?.analysis.problem_clarity).toBe(1);
    expect(parsed?.analysis.ai_help_value).toBe(0);
    expect(parsed?.analysis.handoff_state).toBe('OFFERED');
    expect(parsed?.analysis.reply_length).toBe('SHORT');
  });

  it('解析 V1.4 快速交接字段，并限制枚举和值域', () => {
    const parsed = parseAssistantOutput(JSON.stringify({
      handoff_mode: 'QUICK_HANDOFF',
      minimum_sufficient_judgment: true,
      human_intent: 'NOT_EXPLICIT',
      ai_can_help_now: false,
      ai_further_value: 'LOW',
      human_help_level: 'HIGH',
      no_more_questions: true,
      booking_button_text: '免费预约真人聊聊',
      booking_summary_ready: true,
      assistant_reply: '这个事情找真人完整聊一次会更合适。',
    }));
    expect(parsed?.analysis.handoff_mode).toBe('QUICK_HANDOFF');
    expect(parsed?.analysis.minimum_sufficient_judgment).toBe(true);
    expect(parsed?.analysis.human_intent).toBe('NOT_EXPLICIT');
    expect(parsed?.analysis.ai_further_value).toBe('LOW');
    expect(parsed?.analysis.human_help_level).toBe('HIGH');
    expect(parsed?.analysis.no_more_questions).toBe(true);
    expect(parsed?.analysis.booking_button_text).toBe('免费预约真人聊聊');
  });

  it('模型输出异常时返回安全降级结果', () => {
    expect(parseAssistantOutput('{not-json}')).toBeNull();
    const analysis = analyzeConversation('我最近工作压力很大');
    expect(fallbackReply(analysis)).toContain('听');
  });

  it('模型未遵守 JSON 协议时保留安全的自然语言回复，避免重复固定降级文案', () => {
    expect(naturalReply('抱歉，刚才的回复可能显示不全。我重新说一遍：\n\n我在听你说。')).toContain('显示不全');
    expect(naturalReply('{"assistant_reply":"内部字段"}')).toBeNull();
    expect(naturalReply('```json\n{"assistant_reply":"内部字段"}\n```')).toBeNull();
  });

  it('把旧的真人服务流程句替换为温和的用户文案', () => {
    const normalized = normalizeUserReply('提交后由运营人员在飞书里人工分配导师并联系你。');
    expect(normalized).toMatch(/预约.*免费/);
    expect(normalized).toMatch(/真人|导师/);
    expect(normalized).not.toContain('人工分配');
  });

  it('真人交接文案会随当前 Issue 稳定变化，而不是每次完全相同', () => {
    const replies = ['issue-a', 'issue-b', 'issue-c', 'issue-d'].map((issueId) => normalizeUserReply(
      '我听到了。',
      analyzeConversation('我想找真人导师聊聊', '', { issueId }),
    ));
    expect(new Set(replies).size).toBeGreaterThan(1);
    replies.forEach((reply) => expect(reply).toMatch(/预约|真人|导师/));
  });

  it('移除同一条回复中重复的真人服务文案', () => {
    const normalized = normalizeUserReply('将会有专门的导师好好倾听你的诉求，放心，预约是免费的。你可以先填写信息。将会有专门的导师好好倾听你的诉求，放心，预约是免费的。。');
    expect((normalized.match(/预约/g) || []).length).toBe(1);
    expect(normalized).toContain('你可以先填写信息。');
    expect(normalized).not.toMatch(/。\s*。/);
  });

  it('服务端规则覆盖模型对安全和真人路径的误判', () => {
    const baseline = analyzeConversation('我想找真人导师聊聊');
    const merged = mergeAnalysis(baseline, parseAssistantOutput(JSON.stringify({
      conversation_state: 'LISTENING',
      routing_state: 'AI_SELF_HELP',
      safety_status: 'NO_SIGNAL_DETECTED',
      assistant_reply: '我们再多聊几轮看看。',
    })));
    expect(merged.conversation_state).toBe('HUMAN_SERVICE');
    expect(merged.routing_state).toBe('HUMAN_SUPPORT');
  });

  it('服务端规则保留问题地图和 AI 自助路径，不被模型强行改成真人', () => {
    const baseline = analyzeConversation('我最近很累，只想倾诉，不想听建议');
    const merged = mergeAnalysis(baseline, parseAssistantOutput(JSON.stringify({
      routing: 'HUMAN_MENTOR',
      complexity: 'COMPLEX',
      problem_map: { main_issue: '模型猜测的主诉' },
      assistant_reply: '我建议你预约真人。',
    })));
    expect(merged.routing).toBe('AI_SUPPORT');
    expect(merged.routing_state).toBe('AI_SELF_HELP');
    expect(merged.problem_map).toEqual(baseline.problem_map);
  });

  it('服务端不接受模型提前打开真人入口，并拦截未准备好时的导流文案', () => {
    const baseline = analyzeConversation('最近总是焦虑怎么办');
    const parsed = parseAssistantOutput(JSON.stringify({
      routing: 'HUMAN_MENTOR',
      handoff_state: 'OFFERED',
      show_booking_button: true,
      assistant_reply: '你可以预约真人导师继续聊聊。',
    }));
    const merged = mergeAnalysis(baseline, parsed);
    expect(merged.routing).toBe('AI_SUPPORT');
    expect(merged.show_booking_button).toBe(false);
    expect(normalizeUserReply(parsed?.reply || '', merged)).not.toMatch(/真人|导师|预约|人工|分配/);
  });

  it('V1.4 真人交接时服务端不接受模型继续追问', () => {
    const baseline = analyzeConversation('我想找心理咨询师聊聊');
    const merged = mergeAnalysis(baseline, parseAssistantOutput(JSON.stringify({
      ask_question: true,
      no_more_questions: false,
      assistant_reply: '你愿意先说说持续多久了吗？',
    })));
    expect(merged.show_booking_button).toBe(true);
    expect(merged.ask_question).toBe(false);
    expect(merged.no_more_questions).toBe(true);
    expect(normalizeUserReply('你愿意先说说持续多久了吗？', merged)).not.toMatch(/[？?]/);
  });
});
