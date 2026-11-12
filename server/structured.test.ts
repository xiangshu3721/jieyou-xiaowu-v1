import { describe, expect, it } from 'vitest';
import { analyzeConversation, buildConversationUnderstanding, emergencyReply, safetyClarificationReply } from './rules.js';
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

  it('Fallback 尊重倾诉意愿和 ask_question=false，不机械追问或给建议', () => {
    const comfort = analyzeConversation('我最近很累，只想倾诉，不想听建议');
    expect(fallbackReply(comfort)).toContain('先听着');
    expect(fallbackReply(comfort)).not.toMatch(/[？?]/);
    expect(fallbackReply(comfort)).not.toMatch(/建议你|可以先做|试试|应该/);

    const noQuestion = analyzeConversation('最近总是焦虑怎么办');
    expect(noQuestion.ask_question).toBe(false);
    expect(fallbackReply(noQuestion)).not.toMatch(/[？?]/);

    const clarification = analyzeConversation('最近很累，能帮我理清楚吗');
    expect(clarification.ask_question).toBe(true);
    expect(fallbackReply(clarification)).toMatch(/[？?]/);
    expect(fallbackReply(clarification, { allowQuestion: false })).not.toMatch(/[？?]/);
  });

  it('普通 Fallback 会直接回应求助，并只在上一条确为旧模板时补救', () => {
    const first = analyzeConversation('工作压力很大怎么办？');
    const firstReply = fallbackReply(first, { latestUserMessage: '工作压力很大怎么办？', allowQuestion: false });
    expect(firstReply).toMatch(/任务|工作量|范围/);
    expect(firstReply).not.toContain('按自己的节奏继续说');

    const second = analyzeConversation('你这话啥意思？', '用户：工作压力很大怎么办？');
    const secondReply = fallbackReply(second, {
      latestUserMessage: '你这话啥意思？',
      recentUserMessages: ['工作压力很大怎么办？'],
      recentAssistantReplies: ['我先听着，也接住你刚才说的这部分。你可以按自己的节奏继续说，不必急着回答问题。'],
      allowQuestion: false,
    });
    expect(secondReply).toContain('没有回答');
    expect(secondReply).not.toBe('我先听着，也接住你刚才说的这部分。你可以按自己的节奏继续说，不必急着回答问题。');
  });

  it('连续三轮普通降级不会在两个固定模板间循环', () => {
    const first = fallbackReply(analyzeConversation('今天心里很乱'), {
      latestUserMessage: '今天心里很乱',
      allowQuestion: false,
    });
    const second = fallbackReply(analyzeConversation('我不知道怎么说'), {
      latestUserMessage: '我不知道怎么说',
      recentUserMessages: ['今天心里很乱', '我不知道怎么说'],
      recentAssistantReplies: [first],
      allowQuestion: false,
    });
    const third = fallbackReply(analyzeConversation('我只是觉得很累'), {
      latestUserMessage: '我只是觉得很累',
      recentUserMessages: ['我不知道怎么说', '我只是觉得很累'],
      recentAssistantReplies: [first, second],
      allowQuestion: false,
    });
    expect(new Set([first, second, third]).size).toBe(3);
    [first, second, third].forEach((reply) => expect(reply).not.toMatch(/我不重复刚才那句|建议你|可以先做|试试|应该/));
  });

  it('追问只解释真实上一条回复，不把话题拉回工作或强行给建议', () => {
    const workAdvice = '先把今天必须完成的任务列出来，只推进最紧急的一件，必要时提前说明期限风险。';
    const workExplanation = fallbackReply(analyzeConversation('你这话什么意思？'), {
      latestUserMessage: '你这话什么意思？',
      recentAssistantReplies: [workAdvice],
      allowQuestion: false,
    });
    expect(workExplanation).toMatch(/任务|期限/);
    expect(workExplanation).not.toContain('没有回答');

    const relationshipReply = '听起来你和伴侣最近总在沟通时卡住，这会让人很疲惫。';
    const relationshipExplanation = fallbackReply(analyzeConversation('你这话什么意思？', '用户：工作压力很大怎么办？'), {
      latestUserMessage: '你这话什么意思？',
      recentAssistantReplies: [relationshipReply],
      allowQuestion: false,
    });
    expect(relationshipExplanation).toContain(relationshipReply);
    expect(relationshipExplanation).not.toMatch(/工作|任务|期限/);

    const noAdvice = fallbackReply(analyzeConversation('不要建议，只解释下'), {
      latestUserMessage: '不要建议，只解释下',
      recentAssistantReplies: [workAdvice],
      allowQuestion: false,
    });
    expect(noAdvice).toMatch(/只解释|不再补充/);
    expect(noAdvice).not.toMatch(/先把|推进|提前说明/);
  });

  it('已记录用户目标时只删除重复提问，保留对上一条建议的完整解释', () => {
    const original = analyzeConversation('你刚才的建议是什么意思？', '用户：工作压力很大怎么办？');
    const analysis = {
      ...original,
      known_facts: {
        ...original.known_facts,
        user_goal: { value: '希望得到一个现实可行的下一步', source: 'user_explicit' as const, confidence: 1 },
      },
    };
    const reply = '我的意思是先把工作任务分出轻重缓急，今天只推进一个最紧急的小步骤。你现在最想先解决什么？';
    const normalized = normalizeUserReply(reply, analysis, { latestUserMessage: '你刚才的建议是什么意思？' });
    expect(normalized).toBe('我的意思是先把工作任务分出轻重缓急，今天只推进一个最紧急的小步骤。');
    expect(normalized).not.toMatch(/记住了|不重复问/);

    const sameSentence = normalizeUserReply('我是在建议先确定今天的优先级，你最想先解决什么？', analysis);
    expect(sameSentence).toBe('我是在建议先确定今天的优先级，');

    const onlyDuplicate = normalizeUserReply('你现在最想先解决什么？', analysis);
    expect(onlyDuplicate).toMatch(/不重复问|记住/);
  });

  it('Fallback 保留安全澄清和危机指引例外', () => {
    expect(fallbackReply(analyzeConversation('我现在正准备伤害自己'))).toBe(emergencyReply);
    expect(fallbackReply(analyzeConversation('我不想活了'))).toBe(safetyClarificationReply);
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

  it('真人交接话术区分主动要求，并引用快速交接的明确事实', () => {
    const direct = analyzeConversation('我想找真人导师聊聊', '', { issueId: 'direct-handoff' });
    const directReply = normalizeUserReply('我听到了。', direct);
    expect(directReply).toContain('免费预约真人聊聊');
    expect(directReply).not.toMatch(/[？?]/);
    expect(directReply).not.toMatch(/撑了很久|事情可能有点复杂|一个人扛着/);

    const quick = analyzeConversation(
      '晚上睡不好，白天状态也受影响。',
      '工作压力很大\n已经两三个月了，每天都不想上班',
      { issueId: 'quick-handoff', userTurnCount: 3 },
    );
    const quickReply = fallbackReply(quick);
    expect(quick.handoff_mode).toBe('QUICK_HANDOFF');
    expect(quickReply).toMatch(/睡眠|工作/);
    expect(quickReply).toContain('免费预约真人聊聊');
    expect(quickReply).not.toMatch(/[？?]/);
    expect(quickReply).not.toMatch(/撑了很久|一个人扛着/);
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

  it('V1.7 回复质量守门会拦截对已确认字段的重复提问', () => {
    const messages = [
      { role: 'user' as const, content: '最近总是焦虑' },
      { role: 'assistant' as const, content: '如果用 0～10 分估计，现在的难受程度大概是多少？' },
      { role: 'user' as const, content: '7' },
    ];
    const baseline = analyzeConversation('7', '最近总是焦虑', {
      understanding: buildConversationUnderstanding(messages),
      userTurnCount: 2,
    });
    const normalized = normalizeUserReply('那你现在的难受程度大概是几分？', baseline);
    expect(normalized).not.toMatch(/[？?]/);
    expect(normalized).toContain('记住');
  });
});
