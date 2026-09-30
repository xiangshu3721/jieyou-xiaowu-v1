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

it('把旧的真人服务流程句替换为当前用户文案', () => {
  expect(normalizeUserReply('提交后由运营人员在飞书里人工分配导师并联系你。')).toBe('将会有专门的导师好好倾听你的诉求，放心，预约是免费的。');
});

it('移除同一条回复中重复的真人服务文案', () => {
  expect(normalizeUserReply('将会有专门的导师好好倾听你的诉求，放心，预约是免费的。你可以先填写信息。将会有专门的导师好好倾听你的诉求，放心，预约是免费的。。')).toBe('将会有专门的导师好好倾听你的诉求，放心，预约是免费的。你可以先填写信息。');
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
});
