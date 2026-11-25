import { describe, expect, it } from 'vitest';
import { analyzeConversation, buildConversationUnderstanding, classifyConcern, detectHelpProgress, detectIssueSwitch, detectSafety, isDuplicateQuestion, isMedicationDecisionRequest, recentSafetyStatus, resolveConversationIntent, routeConcern } from './rules.js';
import { detectConversationControl } from './issue.js';

describe('解忧小屋智能导诊规则', () => {
  it('工作压力延伸到伴侣关系不自动拆成新 Issue，独立关系话题仍可切换', () => {
    expect(detectIssueSwitch('工作压力已经影响了和伴侣的关系', '最近工作压力很大', ['CAREER', 'EMOTION']).detected).toBe(false);
    expect(detectIssueSwitch('工作导致我和伴侣经常吵架', '最近工作压力很大', ['CAREER']).detected).toBe(false);
    expect(detectIssueSwitch('我最近情绪低落', '最近工作压力很大', ['CAREER']).detected).toBe(false);
    expect(detectIssueSwitch('我和伴侣最近频繁吵架', '最近工作压力很大', ['CAREER']).detected).toBe(true);
    expect(detectIssueSwitch('另外我还想说感情关系问题', '最近工作压力很大', ['CAREER']).detected).toBe(true);
  });

  it('照护家人时围绕辞职、收入和工作安排的决策不拆分 Issue', () => {
    const careContext = '妈妈下个月要做手术，我在北京刚转正。弟弟能陪她去医院，但他请不了很长的假。';
    expect(detectIssueSwitch('我一想到辞职回去就害怕以后找不到现在这样的工作。', careContext, ['FAMILY']).detected).toBe(false);
    expect(detectIssueSwitch('为了照顾她，我在考虑请假还是换工作，收入要怎么安排？', careContext, ['FAMILY']).detected).toBe(false);
    expect(detectIssueSwitch('另外，我想辞职转去做设计，和妈妈手术无关。', careContext, ['FAMILY']).detected).toBe(true);
    expect(detectIssueSwitch('我最近在考虑换工作，想去薪水更高的公司。', careContext, ['FAMILY']).detected).toBe(true);
    expect(detectIssueSwitch('我考虑辞职创业，做和之前不同的项目。', careContext, ['FAMILY']).detected).toBe(true);
  });

  it('支持多标签分类，并保留当前主题优先顺序', () => {
    expect(classifyConcern('最近工作压力很大，和伴侣也总是吵架')).toEqual(['EMOTION', 'CAREER', 'INTIMACY']);
  });

  it('对可信即时危险进入安全支持，对模糊表达先澄清', () => {
    expect(detectSafety('我现在正准备伤害自己')).toBe('URGENT');
    expect(detectSafety('“我现在正准备伤害自己”')).toBe('URGENT');
    expect(detectSafety('我现在想“自杀”')).not.toBe('NO_SIGNAL_DETECTED');
    expect(detectSafety('我没有想过自杀，但现在正准备伤害自己')).toBe('URGENT');
    expect(detectSafety('我已经不想活了')).toBe('NEEDS_CLARIFICATION');
    expect(routeConcern('我现在正准备伤害自己，我想预约真人', 'URGENT')).toBe('EMERGENCY_SUPPORT');
    expect(analyzeConversation('我现在正准备伤害自己').conversation_state).toBe('SAFETY_SUPPORT');
  });

  it('安全识别覆盖否定、引述和矛盾表达，不把普通低落当成即时危险', () => {
    expect(detectSafety('最近很焦虑、睡不着，也很疲惫')).toBe('NO_SIGNAL_DETECTED');
    expect(detectSafety('我没有自杀念头，但有点活不下去的感觉')).toBe('NEEDS_CLARIFICATION');
    expect(detectSafety('朋友说"我不想活了"，我不知道怎么帮他')).toBe('NO_SIGNAL_DETECTED');
  });

  // SAFE-01：间接轻生意念（条件/愿望/假设框架、无即时计划）→ NEEDS_CLARIFICATION
  it('SAFE-01：间接轻生表达进入安全澄清，不误伤普通离开与第三人称引述', () => {
    // 正向：第一人称间接轻生意念 → NEEDS_CLARIFICATION
    expect(detectSafety('有时候想，如果我不在了就好了')).toBe('NEEDS_CLARIFICATION');
    expect(detectSafety('真希望明天不用再醒过来')).toBe('NEEDS_CLARIFICATION');
    expect(detectSafety('有时候会想如果不在了就好了')).toBe('NEEDS_CLARIFICATION');
    expect(detectSafety('要是没有我这个人是就好了')).toBe('NEEDS_CLARIFICATION');
    expect(detectSafety('感觉如果消失了也不会有人在意')).toBe('NEEDS_CLARIFICATION');
    // 反向：普通离开、第三人称引述、文学讨论、明确否定 → NO_SIGNAL_DETECTED
    expect(detectSafety('我今天不在家')).toBe('NO_SIGNAL_DETECTED');
    expect(detectSafety('我不在家，在朋友那里')).toBe('NO_SIGNAL_DETECTED');
    expect(detectSafety('我出门了')).toBe('NO_SIGNAL_DETECTED');
    expect(detectSafety('我离开公司了')).toBe('NO_SIGNAL_DETECTED');
    expect(detectSafety('朋友说他最近不想活了')).toBe('NO_SIGNAL_DETECTED');
    expect(detectSafety('她消失了好几天')).toBe('NO_SIGNAL_DETECTED');
    expect(detectSafety('那本书里提到轻生的角色')).toBe('NO_SIGNAL_DETECTED');
    expect(detectSafety('我没有自杀的想法')).toBe('NO_SIGNAL_DETECTED');
    expect(detectSafety('我不会伤害自己')).toBe('NO_SIGNAL_DETECTED');
    // 混合：第一人称间接+第三人称提及，第一人称信号优先
    expect(detectSafety('有时候会想如果不在了就好了，朋友也说过类似的话')).toBe('NEEDS_CLARIFICATION');
  });

  it('SAFE-01：recentSafetyStatus 能保持间接轻生的 NEEDS_CLARIFICATION 连续性', () => {
    const indirect = [
      { role: 'user' as const, content: '有时候想，如果我不在了就好了', issueId: 'issue-safe01' },
    ];
    expect(recentSafetyStatus(indirect)).toBe('NEEDS_CLARIFICATION');
    // 普通后续消息不解除间接轻生 pending
    expect(recentSafetyStatus([...indirect, { role: 'user' as const, content: '今天工作很忙', issueId: 'issue-safe01' }])).toBe('NEEDS_CLARIFICATION');
    // 明确安全澄清可以解除
    expect(recentSafetyStatus([...indirect, { role: 'user' as const, content: '我现在安全，身边有人', issueId: 'issue-safe01' }])).toBe('NO_SIGNAL_DETECTED');
  });

  // SAFE-01 修订：P0-A 混合语境漏判 + P1-B 间接意念误报
  it('SAFE-01 修订：混合语境（第三方/文学+本人风险）不漏判用户本人意念', () => {
    // 第三方转述+本人间接轻生 → 应 NEEDS_CLARIFICATION
    expect(detectSafety('朋友说他最近不想活了，我也不想活了')).toBe('NEEDS_CLARIFICATION');
    expect(detectSafety('朋友说他不想活了，我有时候想如果我不在了就好了')).toBe('NEEDS_CLARIFICATION');
    expect(detectSafety('朋友说他最近不想活了，我也觉得活不下去')).toBe('NEEDS_CLARIFICATION');
    // 文学讨论+本人间接轻生 → 应 NEEDS_CLARIFICATION
    expect(detectSafety('那本书里提到轻生的角色，我也不想活了')).toBe('NEEDS_CLARIFICATION');
    // 纯第三方/文学 → 仍 NO_SIGNAL
    expect(detectSafety('朋友说他最近不想活了，我不知道怎么帮他')).toBe('NO_SIGNAL_DETECTED');
    expect(detectSafety('那本书里提到轻生的角色，写得很真实')).toBe('NO_SIGNAL_DETECTED');
  });

  it('SAFE-01 修订：间接意念不误报非第一人称主体', () => {
    // 第三人称 → NO_SIGNAL
    expect(detectSafety('如果他不在了就好了')).toBe('NO_SIGNAL_DETECTED');
    expect(detectSafety('要是她消失了就好了')).toBe('NO_SIGNAL_DETECTED');
    expect(detectSafety('她希望明天不用再醒来')).toBe('NO_SIGNAL_DETECTED');
    // 项目/工作/物品 → NO_SIGNAL
    expect(detectSafety('如果这个项目不存在了就好了')).toBe('NO_SIGNAL_DETECTED');
    expect(detectSafety('如果这份工作不存在了就好了')).toBe('NO_SIGNAL_DETECTED');
    expect(detectSafety('要是这个麻烦消失了就好了')).toBe('NO_SIGNAL_DETECTED');
    // 小说/虚构角色 → NO_SIGNAL
    expect(detectSafety('如果小说主人公不在了就好了')).toBe('NO_SIGNAL_DETECTED');
    // 第一人称显式/省略 → 仍 NEEDS_CLARIFICATION
    expect(detectSafety('如果我不在了就好了')).toBe('NEEDS_CLARIFICATION');
    expect(detectSafety('有时候想，如果不在了就好了')).toBe('NEEDS_CLARIFICATION');
    expect(detectSafety('要是没有我就好了')).toBe('NEEDS_CLARIFICATION');
  });

  // SAFE-01 第三轮：P0-A 否定语句不能屏蔽后面独立出现的间接轻生意念
  it('SAFE-01 第三轮 P0-A：否定+间接意念混合仍澄清', () => {
    // 否定+间接意念 → 应 NEEDS_CLARIFICATION
    expect(detectSafety('我没有自杀念头，但有时候想如果我不在了就好了')).toBe('NEEDS_CLARIFICATION');
    expect(detectSafety('我没有自杀念头，但我真希望明天不用再醒过来')).toBe('NEEDS_CLARIFICATION');
    expect(detectSafety('我没有想过自杀，但有时候会想如果不在了就好了')).toBe('NEEDS_CLARIFICATION');
    // 纯否定 → 仍 NO_SIGNAL
    expect(detectSafety('我没有自杀的想法')).toBe('NO_SIGNAL_DETECTED');
    expect(detectSafety('我没有想过自杀')).toBe('NO_SIGNAL_DETECTED');
  });

  // SAFE-01 第三轮：P0-B 缺标点的第三人称转述不能吞掉用户本人风险
  it('SAFE-01 第三轮 P0-B：缺标点混合语境不漏判用户本人风险', () => {
    // 缺标点：第三方+本人风险 → 应 NEEDS_CLARIFICATION
    expect(detectSafety('朋友说他最近很累我也不想活了')).toBe('NEEDS_CLARIFICATION');
    expect(detectSafety('朋友说他不想活了我也觉得活不下去')).toBe('NEEDS_CLARIFICATION');
    expect(detectSafety('朋友说不想活了我也想如果我不在了就好了')).toBe('NEEDS_CLARIFICATION');
    // 有标点：第三方+本人风险 → 应 NEEDS_CLARIFICATION
    expect(detectSafety('朋友说他最近很累，我也不想活了')).toBe('NEEDS_CLARIFICATION');
    expect(detectSafety('朋友说他不想活了，我也觉得活不下去')).toBe('NEEDS_CLARIFICATION');
    // 纯第三方（有/无标点）→ 仍 NO_SIGNAL
    expect(detectSafety('朋友说他最近很累我不知道怎么帮他')).toBe('NO_SIGNAL_DETECTED');
    expect(detectSafety('朋友说他最近很累，我不知道怎么帮他')).toBe('NO_SIGNAL_DETECTED');
  });

  // SAFE-01 第三轮：P1-C 前导语不能把他人或工作事项错误归因为用户本人
  it('SAFE-01 第三轮 P1-C：前导语归因必须可靠指向用户本人', () => {
    // 有时候想+第三人称 → NO_SIGNAL
    expect(detectSafety('有时候想如果他不在了就好了')).toBe('NO_SIGNAL_DETECTED');
    // 觉得+第三人称/工作 → NO_SIGNAL
    expect(detectSafety('觉得如果他消失了也没有人会在意')).toBe('NO_SIGNAL_DETECTED');
    expect(detectSafety('感觉如果这份工作消失了也没有人会在意')).toBe('NO_SIGNAL_DETECTED');
    // 她+真希望 → NO_SIGNAL
    expect(detectSafety('她真希望明天不用再醒过来')).toBe('NO_SIGNAL_DETECTED');
    // 第一人称前导语+省略主语 → 仍 NEEDS_CLARIFICATION
    expect(detectSafety('有时候想如果不在了就好了')).toBe('NEEDS_CLARIFICATION');
    expect(detectSafety('感觉如果消失了也没有人会在意')).toBe('NEEDS_CLARIFICATION');
    expect(detectSafety('真希望明天不用再醒过来')).toBe('NEEDS_CLARIFICATION');
  });

  // SAFE-01 第四轮：句段级过滤过宽 — 同段内的第三方/否定/非第一人称不能一票否决全段
  it('SAFE-01 第四轮：同段第三方不能屏蔽本人即时危险（URGENT 优先）', () => {
    // 本人即时危险在前、朋友说在后 → URGENT
    expect(detectSafety('我现在准备伤害自己朋友说让我别这样')).toBe('URGENT');
    // 本人可能危险在前、朋友说在后 → NEEDS_CLARIFICATION
    expect(detectSafety('我不想活了朋友说让我别这样')).toBe('NEEDS_CLARIFICATION');
  });

  it('SAFE-01 第四轮：同段局部否定不能屏蔽后面的独立间接意念', () => {
    // 无标点：否定+间接意念 → NEEDS_CLARIFICATION
    expect(detectSafety('我没有自杀念头但有时候想如果我不在了就好了')).toBe('NEEDS_CLARIFICATION');
    // 更危险：否定+即时危险 → URGENT
    expect(detectSafety('我没有自杀念头但现在准备伤害自己')).toBe('URGENT');
  });

  it('SAFE-01 第四轮：同段后半的非第一人称主体不能否决前半本人间接意念', () => {
    // 前半本人间接意念、后半她希望 → NEEDS_CLARIFICATION
    expect(detectSafety('有时候想如果我不在了就好了但她希望我好好活')).toBe('NEEDS_CLARIFICATION');
  });

  // SAFE-01 第五轮：同段多风险词必须全部检查，不能只查首个匹配
  it('SAFE-01 第五轮：同段多风险词首匹配被否定时后续独立风险词仍须检出', () => {
    // 首个"自杀"被否定，第二个独立 → NEEDS_CLARIFICATION
    expect(detectSafety('我没有自杀念头但偶尔想自杀')).toBe('NEEDS_CLARIFICATION');
    // 首个"伤害自己"被否定，后面"自残"独立 → NEEDS_CLARIFICATION
    expect(detectSafety('我不会伤害自己只是经常想自残')).toBe('NEEDS_CLARIFICATION');
    // 对照：纯否定仍 NO_SIGNAL
    expect(detectSafety('我没有自杀念头')).toBe('NO_SIGNAL_DETECTED');
  });

  it('当前 Issue 的风险不会被下一句真人请求或普通回复自动清除，但明确安全澄清可以恢复', () => {
    const urgent = [
      { role: 'user' as const, content: '我现在正准备伤害自己', issueId: 'issue-a' },
      { role: 'user' as const, content: '我想找真人导师', issueId: 'issue-a' },
    ];
    expect(recentSafetyStatus(urgent)).toBe('URGENT');
    expect(recentSafetyStatus([...urgent, { role: 'user' as const, content: '我现在安全，身边有人', issueId: 'issue-a' }])).toBe('NO_SIGNAL_DETECTED');
    expect(recentSafetyStatus([
      { role: 'user' as const, content: '我已经不想活了', issueId: 'issue-a' },
      { role: 'user' as const, content: '我想预约真人', issueId: 'issue-a' },
    ])).toBe('NEEDS_CLARIFICATION');
  });

  it('只有明确肯定的安全陈述可以解除风险，疑问或矛盾表达不能解除', () => {
    const urgent = { role: 'user' as const, content: '我现在正准备伤害自己', issueId: 'issue-a' };
    expect(recentSafetyStatus([urgent, { role: 'user' as const, content: '我现在安全，身边有人', issueId: 'issue-a' }])).toBe('NO_SIGNAL_DETECTED');
    for (const content of ['我现在安全了吗？', '我现在安全还是不安全？', '我现在安全，但我很怕自己会失控', '我想找真人导师']) {
      expect(recentSafetyStatus([urgent, { role: 'user' as const, content, issueId: 'issue-a' }])).toBe('URGENT');
    }
  });

  it('用户明确要真人时不要求先完成探索', () => {
    const analysis = analyzeConversation('我想找真人导师聊聊');
    expect(analysis.conversation_state).toBe('HUMAN_SERVICE');
    expect(analysis.routing_state).toBe('HUMAN_SUPPORT');
    expect(analysis.booking_preference).toBe('ACCEPTED');
  });

  it('询问是否需要咨询师时继续对话，不展示自动预约按钮', () => {
    for (const message of ['要不要找咨询师啊？', '我是不是该找真人聊聊？', '我需要找心理咨询师吗？']) {
      const analysis = analyzeConversation(message, '', { issueId: 'issue-undecided' });
      expect(analysis.user_intent).toBe('WANTS_CLARITY');
      expect(analysis.routing).toBe('AI_SUPPORT');
      expect(analysis.booking_preference).toBe('INTERESTED');
      expect(analysis.handoff_mode).toBe('NONE');
      expect(analysis.handoff_ready).toBe(false);
      expect(analysis.show_booking_button).toBe(false);
      expect(analysis.handoff_state).toBe('NOT_READY');
      expect(analysis.conversation_state).not.toBe('HUMAN_SERVICE');
    }
    expect(analyzeConversation('我想找真人导师聊聊').handoff_mode).toBe('DIRECT_HANDOFF');
    expect(analyzeConversation('我现在正准备伤害自己，要不要找咨询师').show_booking_button).toBe(false);
  });

  it('用户拒绝真人后不触发真人分流', () => {
    const analysis = analyzeConversation('我暂时不想找真人，先这样聊聊就好');
    expect(analysis.routing_state).toBe('AI_SELF_HELP');
    expect(analysis.booking_preference).toBe('DECLINED');
  });

  it('按当前意图选择对话状态', () => {
    expect(analyzeConversation('我只想倾诉，不想听建议').conversation_state).toBe('EMOTIONAL_SUPPORT');
    expect(analyzeConversation('帮我理清这段关系到底怎么回事').conversation_state).toBe('EXPLORATION');
    expect(analyzeConversation('我该不该辞职，下一步怎么做').conversation_state).toBe('PROBLEM_SOLVING');
  });

  it('P2：纠正理解不触发导诊追问，纠正后明确求助和倾诉后求助可切换为实际帮助', () => {
    for (const text of [
      '你别往自信上分析，不是这个问题。',
      '我不是不自信，是主管根本不排优先级。',
      '不是要你分析我，我只是想把这件事说清楚。',
    ]) {
      const correction = analyzeConversation(text, '用户：我开会总被同事打断，后来我就不想说了。', { userTurnCount: 3 });
      expect(correction).toMatchObject({ user_intent: 'WANTS_COMFORT', response_goal: 'LISTEN', primary_response_strategy: 'EMPATHIZE', ask_question: false, no_more_questions: true });
    }

    const correctionWithHelp = analyzeConversation('你别往自信上分析，我现在到底该怎么和主管谈？', '用户：部门临时活都塞给我。', { userTurnCount: 3 });
    expect(correctionWithHelp).toMatchObject({ user_intent: 'WANTS_ACTION', response_goal: 'HELP', primary_response_strategy: 'PROVIDE_HELP', ask_question: false });

    const actionAfterVenting = analyzeConversation('那你说，我今天先做哪一件？', '用户：我现在只想说说，不用给建议。\n用户：失业以后房租快交不上了。', { userTurnCount: 3 });
    expect(actionAfterVenting).toMatchObject({ user_intent: 'WANTS_ACTION', response_goal: 'HELP', primary_response_strategy: 'PROVIDE_HELP', ask_question: false });
    expect(analyzeConversation('能不能帮我分析一下我为什么总在会议上沉默？').user_intent).toBe('WANTS_CLARITY');
  });

  it('P2：拒绝建议时不把被否定的行动词当作求助', () => {
    for (const text of [
      '别给我建议，我只想说说。',
      '你别往自信上分析，也别给我方案。',
      '不是要你分析我，不要告诉我怎么办。',
      '不用教我怎么办，我只想把感受说出来。',
    ]) {
      const analysis = analyzeConversation(text, '用户：主管总在最后一刻调整优先级。', { userTurnCount: 3 });
      expect(analysis).toMatchObject({ user_intent: 'WANTS_COMFORT', response_goal: 'LISTEN', primary_response_strategy: 'EMPATHIZE', ask_question: false, no_more_questions: true });
    }

    expect(analyzeConversation('你别往自信上分析，我现在该怎么和主管谈？').user_intent).toBe('WANTS_ACTION');
    expect(analyzeConversation('不用安慰我，给我一个具体办法。').user_intent).toBe('WANTS_ACTION');
    expect(analyzeConversation('不用教我怎么办，但我现在该怎么和主管谈？').user_intent).toBe('WANTS_ACTION');
  });

  it('P2：倾诉意愿跨同一 Issue 的事实补充延续，新的求助立即解除', () => {
    const context = '用户：我只想把这些乱七八糟的感觉说出来。\n用户：其实最怕的是下个月房租。';
    expect(resolveConversationIntent('其实最怕的是下个月房租。', '用户：我只想把这些乱七八糟的感觉说出来。')).toBe('WANTS_COMFORT');
    expect(analyzeConversation('其实最怕的是下个月房租。', context, { userTurnCount: 3 }))
      .toMatchObject({ user_intent: 'WANTS_COMFORT', response_goal: 'LISTEN', ask_question: false, no_more_questions: true });
    expect(analyzeConversation('现在我愿意做点事，但别给长计划。', context, { userTurnCount: 4 }))
      .toMatchObject({ user_intent: 'WANTS_ACTION', response_goal: 'HELP', ask_question: false, no_more_questions: false });
    expect(analyzeConversation('那今天我该先看什么？')).toMatchObject({ user_intent: 'WANTS_ACTION', response_goal: 'HELP' });
  });

  it('专业需求进入专业转介，而不是被普通自助覆盖', () => {
    const analysis = analyzeConversation('我想知道自己是不是需要心理治疗或精神科帮助');
    expect(analysis.routing_state).toBe('PROFESSIONAL_REFERRAL');
    expect(routeConcern('我想了解心理咨询', 'NO_SIGNAL_DETECTED')).toBe('AI_SELF_HELP');
  });

  it('口语化用药决策进入专业边界，但普通服药叙述不误判', () => {
    for (const text of [
      '我正在吃抗抑郁药，药是不是该自己减量？',
      '我想自己停药，应该怎么做？',
      '药物副作用让我想换药，能自己调整吗？',
      '我今天漏吃了，能补两片吗？',
      '药想少吃一点可以吗？',
      '我想把剂量调成一半可以吗？',
    ]) {
      expect(isMedicationDecisionRequest(text)).toBe(true);
      expect(analyzeConversation(text)).toMatchObject({ routing: 'PROFESSIONAL_REFERRAL', show_booking_button: false });
    }
    for (const text of ['我最近按医生说的吃药，睡得比以前好。', '我今天忘了吃药，有点担心。', '我去年停药以后睡得好多了。']) {
      expect(isMedicationDecisionRequest(text)).toBe(false);
      expect(analyzeConversation(text).routing).toBe('AI_SUPPORT');
    }
    expect(analyzeConversation('我想找真人导师聊聊，但药是不是该自己减量？').routing).toBe('PROFESSIONAL_REFERRAL');
  });

  it('用药背景可承接省略主语的后续决策，但不跨 Issue 串线', () => {
    const medicationContext = '用户：我在服用抗抑郁药。';
    expect(isMedicationDecisionRequest('那我能不能减一点？', medicationContext)).toBe(true);
    expect(analyzeConversation('那我能不能减一点？', medicationContext).routing).toBe('PROFESSIONAL_REFERRAL');
    expect(isMedicationDecisionRequest('最近工作压力很大，能不能减一点任务？', medicationContext)).toBe(false);
    expect(analyzeConversation('能不能减一点？', '用户：最近工作压力很大。').routing).toBe('AI_SUPPORT');
    expect(analyzeConversation('我按医生说的吃药，最近睡得好一些。').routing).toBe('AI_SUPPORT');
  });

  it('普通交流允许开放探索，只有明确边界才禁止提问', () => {
    expect(analyzeConversation('最近工作压力很大')).toMatchObject({ no_more_questions: false });
    expect(analyzeConversation('事情有点乱，心里着急').no_more_questions).toBe(false);
    expect(analyzeConversation('我只想说说，别给建议')).toMatchObject({ ask_question: false, no_more_questions: true });
    expect(analyzeConversation('我现在想要一个具体办法')).toMatchObject({ no_more_questions: false });
    expect(analyzeConversation('我先不聊了')).toMatchObject({ ask_question: false, no_more_questions: true });
  });

  it('记录用户对帮助效果的反馈', () => {
    expect(analyzeConversation('你刚才说的方法对我没什么用').support_feedback).toBe('用户反馈当前帮助效果不足');
  });

  it('求助本身不提前交接，但长期反复、实际影响且 AI 无效时允许完整交接判断', () => {
    const shortTerm = analyzeConversation(
      '我该怎么开口才不会又变成谁对谁错？',
      '上周我和对象因为家务吵了一次。他两天没怎么说话，后来像什么都没发生。',
      { userTurnCount: 3 },
    );
    expect(shortTerm).toMatchObject({ routing: 'AI_SUPPORT', handoff_ready: false, show_booking_button: false });

    const exhausted = analyzeConversation(
      '前面这些建议没用，我现在到底怎么办？',
      '工作压力已经持续三个月，反复睡不好，白天工作效率受影响。我试过列优先级和跟领导沟通，但没有改善。',
      { userTurnCount: 4 },
    );
    expect(exhausted).toMatchObject({
      user_intent: 'WANTS_ACTION', support_feedback: '用户反馈当前帮助效果不足',
      routing: 'HUMAN_MENTOR', handoff_ready: true, handoff_mode: 'QUICK_HANDOFF', show_booking_button: true,
    });
  });

  it('证据不足时使用 OTHER，不补齐背景', () => {
    expect(classifyConcern('我有点说不上来')).toEqual(['OTHER']);
  });

  it('只想倾诉时保持 AI 陪伴，不强制真人导流', () => {
    const analysis = analyzeConversation('我最近很累，只想倾诉，不想听建议');
    expect(analysis.user_intent).toBe('WANTS_COMFORT');
    expect(analysis.routing).toBe('AI_SUPPORT');
    expect(analysis.routing_state).toBe('AI_SELF_HELP');
    expect(analysis.conversation_state).toBe('EMOTIONAL_SUPPORT');
  });

  it('建立问题地图，并只提出一个高价值缺口', () => {
    const analysis = analyzeConversation('最近三个月工作压力很大，每天都焦虑，已经影响睡眠和工作效率。我试过请假，但没有改善，希望先找到能执行的办法。');
    expect(analysis.problem_map.onset_duration).toContain('三个月');
    expect(analysis.problem_map.functional_impacts).toEqual(expect.arrayContaining(['sleep', 'work_study']));
    expect(analysis.problem_map.attempts.some((attempt) => attempt.includes('请假'))).toBe(true);
    expect(analysis.complexity).toBe('COMPLEX');
    expect(analysis.information_gaps.length).toBeLessThanOrEqual(1);
    expect(analysis.next_question).toBeNull();
    const sparse = analyzeConversation('最近工作压力很大');
    expect(sparse.information_gaps.length).toBeGreaterThan(0);
    expect(sparse.next_question).toBeTruthy();
  });

  it('V1.7A 只记录用户明确说出的严重程度、功能影响和诱因', () => {
    const sparse = analyzeConversation('工作压力很大');
    const sparseUnderstanding = buildConversationUnderstanding([{ role: 'user', content: '工作压力很大' }]);
    expect(sparse.problem_map.severity_score).toBeNull();
    expect(sparse.problem_map.functional_impacts).not.toContain('work_study');
    expect(sparseUnderstanding.known_facts.severity_score).toBeUndefined();
    expect(sparseUnderstanding.known_facts.functional_impact).toBeUndefined();

    const corrected = buildConversationUnderstanding([{ role: 'user', content: '我只是最近项目太多，不是因为害怕失败。' }]);
    expect(corrected.known_facts.trigger).toBeUndefined();

    const explicit = analyzeConversation('我现在有 7 分，晚上睡不好，白天状态也受影响，已经影响工作能力');
    const explicitUnderstanding = buildConversationUnderstanding([{ role: 'user', content: '我现在有 7 分，晚上睡不好，白天状态也受影响，已经影响工作能力' }]);
    expect(explicit.problem_map.severity_score).toBe(7);
    expect(explicit.problem_map.functional_impacts).toEqual(expect.arrayContaining(['sleep', 'work_study', 'daily_life']));
    expect(explicitUnderstanding.known_facts.severity_score?.value).toBe(7);
    expect(explicitUnderstanding.known_facts.functional_impact?.value).toEqual(expect.stringContaining('work_study'));

    const sleepOnly = analyzeConversation('工作压力影响睡眠');
    expect(sleepOnly.problem_map.functional_impacts).toEqual(['sleep']);

    const deniedWorkImpact = analyzeConversation('最近失眠，但没有影响工作');
    expect(deniedWorkImpact.problem_map.functional_impacts).toEqual(['sleep']);

    const deniedWorkCapacityImpact = analyzeConversation('工作压力很大，但没影响我的工作能力');
    expect(deniedWorkCapacityImpact.problem_map.functional_impacts).toEqual([]);

    for (const text of ['工作不受影响', '工作没有受影响', '不会影响工作']) {
      expect(analyzeConversation(text).problem_map.functional_impacts).toEqual([]);
    }

    const explicitWorkImpact = analyzeConversation('已经影响工作能力');
    expect(explicitWorkImpact.problem_map.functional_impacts).toContain('work_study');
    expect(analyzeConversation('工作受到影响').problem_map.functional_impacts).toContain('work_study');
  });

  it('跨领域长期困扰时推荐单一辅助测评，但不将其当成诊断', () => {
    const analysis = analyzeConversation('我长期在亲密关系里不安，总担心被抛下，也想知道自己是不是总在重复类似的关系模式');
    expect(analysis.assessment.needed).toBe(true);
    expect(analysis.assessment.recommended_tool).toContain('成人依恋');
    expect(analysis.reply_strategy).toContain('不是诊断');
  });

  it('用户拒绝测评时不重复推荐', () => {
    const analysis = analyzeConversation('我不想做测评，只想先聊聊最近的关系问题');
    expect(analysis.assessment.needed).toBe(false);
    expect(analysis.routing).toBe('AI_SUPPORT');
  });

  it('V1.3 默认先由 AI 支持，不因中度标签提前展示真人入口', () => {
    const analysis = analyzeConversation('最近总是焦虑怎么办');
    expect(analysis.routing).toBe('AI_SUPPORT');
    expect(analysis.handoff_state).toBe('NOT_READY');
    expect(analysis.show_booking_button).toBe(false);
    expect(analysis.response_goal).not.toBe('HANDOFF');
  });

  it('V1.3 信息充分且继续 AI 收益有限时停止追问并交接', () => {
    const analysis = analyzeConversation(
      '8分，而且已经持续两三个月、影响睡眠和做事状态了。我想搞清楚焦虑来源。',
      '最近总是焦虑怎么办\n晚上，脑子停不下来\n两三个月吧，最近还失眠，什么都提不起劲',
    );
    expect(analysis.handoff_ready).toBe(true);
    expect(analysis.handoff_state).toBe('OFFERED');
    expect(analysis.show_booking_button).toBe(true);
    expect(analysis.response_goal).toBe('HANDOFF');
    expect(analysis.ask_question).toBe(false);
    expect(analysis.routing).toBe('HUMAN_MENTOR');
  });

  it('V1.3 用户直接提出真人需求时立即展示交接入口', () => {
    const analysis = analyzeConversation('我想找真人导师聊聊');
    expect(analysis.handoff_state).toBe('OFFERED');
    expect(analysis.show_booking_button).toBe(true);
    expect(analysis.ask_question).toBe(false);
    expect(analysis.response_goal).toBe('HANDOFF');
  });

  it('V1.3 用户拒绝真人后保持 AI 支持且不再展示入口', () => {
    const analysis = analyzeConversation('我暂时不想找真人，先这样聊聊就好');
    expect(analysis.handoff_state).toBe('DECLINED');
    expect(analysis.show_booking_button).toBe(false);
    expect(analysis.routing).toBe('AI_SUPPORT');
  });

  it('V1.3 安全路径不展示商业交接入口', () => {
    const analysis = analyzeConversation('我现在正准备伤害自己');
    expect(analysis.handoff_state).toBe('NOT_READY');
    expect(analysis.show_booking_button).toBe(false);
    expect(analysis.routing).toBe('SAFETY_SUPPORT');
  });

  it('V1.4 用户提到心理咨询师时直接进入真人交接，不宣称资质', () => {
    const analysis = analyzeConversation('我想找心理咨询师聊聊');
    expect(analysis.routing).toBe('HUMAN_MENTOR');
    expect(analysis.human_intent).toBe('EXPLICIT');
    expect(analysis.handoff_mode).toBe('DIRECT_HANDOFF');
    expect(analysis.minimum_sufficient_judgment).toBe(false);
    expect(analysis.show_booking_button).toBe(true);
    expect(analysis.booking_button_text).toBe('免费预约真人聊聊');
    expect(analysis.ask_question).toBe(false);
    expect(analysis.no_more_questions).toBe(true);
  });

  it('咨询服务可用性询问不视为明确预约，也不展示预约入口', () => {
    for (const text of ['有没有心理咨询师？', '有没有老师可以聊？', '有咨询服务吗']) {
      const analysis = analyzeConversation(text);
      expect(analysis.user_intent).toBe('WANTS_CLARITY');
      expect(analysis.handoff_mode).toBe('NONE');
      expect(analysis.human_intent).toBe('NOT_EXPLICIT');
      expect(analysis.booking_preference).toBe('INTERESTED');
      expect(analysis.show_booking_button).toBe(false);
      expect(analysis.routing).toBe('AI_SUPPORT');
    }
    expect(analyzeConversation('我想找心理咨询师聊聊').handoff_mode).toBe('DIRECT_HANDOFF');
  });

  it('V1.4 用户明确拒绝真人时不触发交接', () => {
    const analysis = analyzeConversation('我不想找心理咨询师，先自己聊聊');
    expect(analysis.human_intent).toBe('DECLINED');
    expect(analysis.handoff_mode).toBe('NONE');
    expect(analysis.routing).toBe('AI_SUPPORT');
    expect(analysis.show_booking_button).toBe(false);
  });

  it('V1.6 新 Issue 未满三次有效表达时，即使信息看起来充分也不主动交接', () => {
    const analysis = analyzeConversation('最近三个月总是焦虑，晚上睡不着，白天没精神');
    expect(analysis.minimum_sufficient_judgment).toBe(true);
    expect(analysis.user_turn_count).toBe(1);
    expect(analysis.handoff_mode).toBe('NONE');
    expect(analysis.routing).toBe('AI_SUPPORT');
    expect(analysis.show_booking_button).toBe(false);
  });

  it('V1.6 至少三次有效表达且达到最低充分判断后才允许主动交接', () => {
    const analysis = analyzeConversation(
      '其实两边都有，晚上也睡不好，白天状态也受影响。',
      '工作压力很大\n已经两三个月了，每天都不想上班',
    );
    expect(analysis.user_turn_count).toBe(3);
    expect(analysis.minimum_sufficient_judgment).toBe(true);
    expect(analysis.handoff_mode).toBe('QUICK_HANDOFF');
    expect(analysis.show_booking_button).toBe(true);
    expect(analysis.ask_question).toBe(false);
  });

  it('V1.6 HANDOFF_OFFERED 不阻塞后续聊天，也不重复推销', () => {
    const analysis = analyzeConversation('我其实更担心以后一个人生活', '刚经历离婚，对未来很迷茫', {
      issueId: 'issue-a',
      userTurnCount: 4,
      handoffOffered: true,
      issueStatus: 'HANDOFF_OFFERED',
      previousTopics: ['INTIMACY', 'EMOTION'],
    });
    expect(analysis.current_issue_id).toBe('issue-a');
    expect(analysis.handoff_offered).toBe(true);
    expect(analysis.show_booking_button).toBe(false);
    expect(analysis.routing).toBe('AI_SUPPORT');
  });

  it('V1.6 用户再次明确要求真人时仍可直接进入预约', () => {
    const analysis = analyzeConversation('那我还是想预约真人', '之前已经聊过一阵子了', {
      issueId: 'issue-a',
      userTurnCount: 5,
      handoffOffered: true,
      issueStatus: 'HANDOFF_OFFERED',
    });
    expect(analysis.handoff_mode).toBe('DIRECT_HANDOFF');
    expect(analysis.show_booking_button).toBe(true);
  });

  it('V1.6 明显换成新的主要困扰时切换 Issue，并重新计数', () => {
    const switched = detectIssueSwitch('刚离完婚，对未来特别迷茫', '最近工作压力很大，晚上也失眠', ['EMOTION', 'CAREER']);
    expect(switched.detected).toBe(true);
    const analysis = analyzeConversation('刚离完婚，对未来特别迷茫', '', { issueId: 'issue-b', userTurnCount: 1, newIssueDetected: true, newIssueConfidence: switched.confidence });
    expect(analysis.new_issue_detected).toBe(true);
    expect(analysis.current_issue_id).toBe('issue-b');
    expect(analysis.user_turn_count).toBe(1);
    expect(analysis.show_booking_button).toBe(false);
  });

  it('V1.6 当前问题的影响不被误切成新 Issue', () => {
    const switched = detectIssueSwitch('所以我晚上也总失眠', '最近工作压力很大', ['EMOTION', 'CAREER']);
    expect(switched.detected).toBe(false);
  });

  it('阶段 1.3 用户纠正 AI 理解时不切换 Issue', () => {
    const switched = detectIssueSwitch('你理解错了，不要往自我价值感上分析', '最近工作压力很大', ['CAREER']);
    expect(switched.detected).toBe(false);
    expect(analyzeConversation('暂时不想找真人，先这样聊聊就好').user_intent).toBe('VENTING');
  });

  it('V1.4 信息仍不足且 AI 还有明显帮助价值时继续 AI 支持', () => {
    const analysis = analyzeConversation('最近总是焦虑怎么办');
    expect(analysis.handoff_mode).toBe('NONE');
    expect(analysis.minimum_sufficient_judgment).toBe(false);
    expect(analysis.routing).toBe('AI_SUPPORT');
    expect(analysis.show_booking_button).toBe(false);
  });

  it('V1.7 将短答绑定到上一条问题，并记住严重程度和持续时间', () => {
    const messages = [
      { role: 'user' as const, content: '最近总是焦虑' },
      { role: 'assistant' as const, content: '如果用 0～10 分估计，现在的难受程度大概是多少？' },
      { role: 'user' as const, content: '7' },
      { role: 'assistant' as const, content: '这种状态大概持续多久了？' },
      { role: 'user' as const, content: '有好几年了' },
    ];
    const understanding = buildConversationUnderstanding(messages);
    expect(understanding.known_facts.severity_score?.value).toBe(7);
    expect(understanding.known_facts.duration?.value).toContain('好几年');
    expect(understanding.asked_questions).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: 'severity_score', answered: true }),
      expect.objectContaining({ field: 'duration', answered: true }),
    ]));
    const analysis = analyzeConversation('有好几年了', '最近总是焦虑\n7', {
      understanding,
      userTurnCount: 3,
    });
    expect(analysis.problem_map.severity_score).toBe(7);
    expect(analysis.problem_map.onset_duration).toContain('好几年');
    expect(analysis.next_question).not.toMatch(/0-10|持续多久|什么时候开始/);
    expect(analysis.primary_response_strategy).not.toBe('QUANTIFY');
    expect(isDuplicateQuestion('如果用 0-10 分估计，现在的难受程度大概是多少？', analysis)).toBe(true);
  });

  it('V1.7 没有高价值缺口时可以承接，不强制问句收尾', () => {
    const analysis = analyzeConversation('我就是觉得特别累');
    expect(analysis.primary_response_strategy).toMatch(/LISTEN|MIRROR|EMPATHIZE/);
    expect(analysis.ask_question).toBe(false);
  });

  it('V1.7 当前 Issue 的主题优先于后续泛化情绪词', () => {
    const analysis = analyzeConversation('其实最难受的地方都差不多', '我换了四份工作，每次最后都特别痛苦', {
      issueTopicTags: ['CAREER'],
      previousTopics: ['CAREER'],
      userTurnCount: 2,
    });
    expect(analysis.primary_topic).toBe('CAREER');
  });

  // JTBD-02B：对话策略冲突修复
  it('JTBD-02B D3：WANTS_END 的 response_goal 不能是 CLARIFY（应 MIRROR 或 LISTEN）', () => {
    const analysis = analyzeConversation('先这样吧，我先不聊了，晚安');
    expect(analysis.user_intent).toBe('WANTS_END');
    expect(analysis.response_goal).not.toBe('CLARIFY');
    expect(analysis.response_goal).toMatch(/MIRROR|LISTEN/);
    expect(analysis.no_more_questions).toBe(true);
    expect(analysis.reply_length).toBe('SHORT');
  });

  it('JTBD-02B D5：纠正理解后不应触发真人交接（即使多轮）', () => {
    const ctx = '用户：我最近特别崩溃，工作压力大\nAI：听起来很不容易\n用户：每天都觉得很累，睡不好';
    const analysis = analyzeConversation('你理解错了，不是收入的问题，是我和伴侣之间缺少沟通', ctx, { userTurnCount: 3 });
    expect(analysis.user_intent).toBe('VENTING');
    expect(analysis.routing).not.toBe('HUMAN_MENTOR');
    expect(analysis.handoff_ready).toBe(false);
  });

  it('JTBD-02B D5b：纠正后策略应为 MIRROR/EMPATHIZE，不应追问事实', () => {
    const ctx = '用户：我最近压力很大\nAI：能多说说吗\n用户：工作压力大，每天都累\nAI：这种状态持续多久了\n用户：好几个月了\nAI：有没有试过什么办法\n用户：试过沟通但没用';
    const analysis = analyzeConversation('你理解错了，不是工作的问题，是我和伴侣的沟通方式', ctx, { userTurnCount: 5 });
    expect(analysis.user_intent).toBe('VENTING');
    expect(analysis.primary_response_strategy).not.toBe('CLARIFY_FACT');
    expect(analysis.primary_response_strategy).toMatch(/MIRROR|EMPATHIZE|LISTEN/);
  });

  it('JTBD-02B D6：讨论专业支持时不应追问事实，应说明专业边界', () => {
    const ctx = '用户：我最近心情很低落\nAI：听起来不容易\n用户：持续好几个月了';
    const analysis = analyzeConversation('我这种情况是不是需要心理咨询', ctx, { userTurnCount: 3 });
    expect(analysis.routing).toBe('AI_SUPPORT');
    expect(analysis.primary_response_strategy).not.toBe('CLARIFY_FACT');
    expect(analysis.primary_response_strategy).toMatch(/MIRROR|LISTEN/);
  });

  it('JTBD-02B D7：拒绝分析+想倾诉应为 WANTS_COMFORT，不是 WANTS_CLARITY', () => {
    expect(resolveConversationIntent('别给我分析了，我就想把心里的感受说出来')).toBe('WANTS_COMFORT');
    expect(resolveConversationIntent('别给我分析了，我就想把这件事说出来')).toBe('WANTS_COMFORT');
  });

  it('JTBD-02B D7b：纠正理解后策略应为 MIRROR，不应追问事实', () => {
    const analysis = analyzeConversation('你理解错了，我不是想换工作');
    expect(analysis.user_intent).toBe('VENTING');
    expect(analysis.primary_response_strategy).not.toBe('CLARIFY_FACT');
  });

  // JTBD-03：帮助进展信号 — 正反向测试
  describe('JTBD-03：帮助进展信号（detectHelpProgress）', () => {
    it('用户明确表达理解进展 → PROGRESS', () => {
      expect(detectHelpProgress('我好像看清了一些，原来我一直在担心别人的评价')).toBe('PROGRESS');
      expect(detectHelpProgress('我知道明天先做什么了')).toBe('PROGRESS');
      expect(detectHelpProgress('这件事我决定先试试跟伴侣谈一次')).toBe('PROGRESS');
      expect(detectHelpProgress('听你这么一说，我明白了')).toBe('PROGRESS');
      expect(detectHelpProgress('好像有点头绪了')).toBe('PROGRESS');
    });

    it('用户明确表达当前帮助没用 → NO_HELP', () => {
      expect(detectHelpProgress('这对我没什么帮助')).toBe('NO_HELP');
      expect(detectHelpProgress('你一直问相同的问题')).toBe('NO_HELP');
      expect(detectHelpProgress('不是我想解决的问题')).toBe('NO_HELP');
      expect(detectHelpProgress('聊了这么久好像还是回到原点')).toBe('NO_HELP');
    });

    it('中性回应或无证据 → UNDETERMINED（不得宣称已解决）', () => {
      expect(detectHelpProgress('嗯')).toBe('UNDETERMINED');
      expect(detectHelpProgress('好吧')).toBe('UNDETERMINED');
      expect(detectHelpProgress('谢谢')).toBe('UNDETERMINED');
      expect(detectHelpProgress('我不太知道')).toBe('UNDETERMINED');
      expect(detectHelpProgress('很累')).toBe('UNDETERMINED');
      expect(detectHelpProgress('工作压力很大')).toBe('UNDETERMINED');
    });

    it('analyzeConversation 输出 help_progress 字段', () => {
      const progress = analyzeConversation('我好像看清了，原来我一直在担心别人的评价', '', { controlIntent: 'GENERAL_CHAT' });
      expect(progress.help_progress).toBe('PROGRESS');
      const noHelp = analyzeConversation('这对我没什么帮助', '', { controlIntent: 'GENERAL_CHAT' });
      expect(noHelp.help_progress).toBe('NO_HELP');
      const neutral = analyzeConversation('嗯，好吧', '', { controlIntent: 'GENERAL_CHAT' });
      expect(neutral.help_progress).toBe('UNDETERMINED');
    });
  });

  // JTBD-04：暂停/结束/解决区分 — 正反向测试
  describe('JTBD-04：暂停/结束/解决区分（detectConversationControl）', () => {
    it('暂停意图 → PAUSE_TOPIC', () => {
      expect(detectConversationControl('我先安静一会儿')).toBe('PAUSE_TOPIC');
      expect(detectConversationControl('等下再聊')).toBe('PAUSE_TOPIC');
      expect(detectConversationControl('今天先到这儿')).toBe('PAUSE_TOPIC');
      expect(detectConversationControl('给我点时间想想')).toBe('PAUSE_TOPIC');
      expect(detectConversationControl('现在不方便说')).toBe('PAUSE_TOPIC');
      expect(detectConversationControl('暂时不想聊了')).toBe('PAUSE_TOPIC');
    });

    it('明确已解决 → RESOLVE_TOPIC', () => {
      expect(detectConversationControl('这件事解决了')).toBe('RESOLVE_TOPIC');
      expect(detectConversationControl('问题处理好了，不用再聊它了')).toBe('RESOLVE_TOPIC');
      expect(detectConversationControl('我的焦虑已经没事了')).toBe('RESOLVE_TOPIC');
    });

    it('否定/不确定/好转未解 → 不是 RESOLVE_TOPIC（阻断 2 修复）', () => {
      expect(detectConversationControl('这件事好像解决了')).not.toBe('RESOLVE_TOPIC');
      expect(detectConversationControl('不用再来聊它了')).not.toBe('RESOLVE_TOPIC');
      expect(detectConversationControl('我的困扰好了点但还没解决')).not.toBe('RESOLVE_TOPIC');
    });

    it('否定已解决 → 不是 RESOLVE_TOPIC', () => {
      expect(detectConversationControl('我不是说已经解决了')).not.toBe('RESOLVE_TOPIC');
      expect(detectConversationControl('我朋友的问题解决了但我的没有')).not.toBe('RESOLVE_TOPIC');
    });

    it('结束聊天 → CLOSE_TOPIC（不是 RESOLVE_TOPIC）', () => {
      expect(detectConversationControl('先这样吧')).toBe('CLOSE_TOPIC');
      expect(detectConversationControl('我先不聊了')).toBe('CLOSE_TOPIC');
      expect(detectConversationControl('晚安')).toBe('CLOSE_TOPIC');
      expect(detectConversationControl('再见')).toBe('CLOSE_TOPIC');
    });

    it('谢谢/明白 ≠ 已解决', () => {
      expect(detectConversationControl('谢谢你听我说')).not.toBe('RESOLVE_TOPIC');
      expect(detectConversationControl('我明白了')).not.toBe('RESOLVE_TOPIC');
    });

    it('还想继续 → GENERAL_CHAT', () => {
      expect(detectConversationControl('我累了但还想聊')).toBe('GENERAL_CHAT');
      expect(detectConversationControl('我还想继续说')).toBe('GENERAL_CHAT');
    });
  });

  // JTBD-04：Issue 状态集成 — 通过 analyzeConversation 验证
  describe('JTBD-04：Issue 状态集成', () => {
    it('用户明确解决 → issue_status=CLOSED', () => {
      const r = analyzeConversation('这件事解决了，不用再聊了', '', { controlIntent: 'RESOLVE_TOPIC' });
      expect(r.issue_status).toBe('CLOSED');
    });

    it('用户想暂停 → issue_status=PAUSED', () => {
      const r = analyzeConversation('我先安静一会儿', '', { controlIntent: 'PAUSE_TOPIC' });
      expect(r.issue_status).toBe('PAUSED');
    });

    it('结束聊天 ≠ 已解决 → issue_status=ACTIVE（不是 CLOSED）', () => {
      const r = analyzeConversation('先这样吧，晚安', '', { controlIntent: 'CLOSE_TOPIC' });
      expect(r.issue_status).toBe('ACTIVE');
    });

    it('同轮风险不得被结案信号遮蔽：安全+解决 → 不安慰结案，走安全路径', () => {
      const r = analyzeConversation('这件事解决了，但我现在想自杀', '', { controlIntent: 'RESOLVE_TOPIC', userTurnCount: 3 });
      expect(r.safety_status).toBe('URGENT');
      expect(r.routing).toBe('SAFETY_SUPPORT');
      expect(r.issue_status).not.toBe('CLOSED');
    });

    it('否定已解决 → 不触发 CLOSED', () => {
      const r = analyzeConversation('我不是说已经解决了，只是好一点', '', { controlIntent: 'GENERAL_CHAT' });
      expect(r.issue_status).toBe('ACTIVE');
    });

    it('第三方已解决 ≠ 我解决了', () => {
      const r = analyzeConversation('我朋友的问题解决了但我的没有', '', { controlIntent: 'GENERAL_CHAT' });
      expect(r.issue_status).toBe('ACTIVE');
    });
  });

  // JTBD-03/04：多轮对话序列
  describe('JTBD-03/04：多轮对话序列', () => {
    it('进展序列：倾诉 → 理解 → 明确下一步', () => {
      const ctx = '用户：最近工作压力很大\nAI：能多说说吗\n用户：每天都觉得很累\nAI：听起来很不容易\n用户：是啊';
      const r = analyzeConversation('我知道明天先做什么了', ctx, { userTurnCount: 3, controlIntent: 'GENERAL_CHAT' });
      expect(r.help_progress).toBe('PROGRESS');
      expect(r.issue_status).toBe('ACTIVE');
    });

    it('无帮助序列：倾诉 → 追问 → 反馈无效', () => {
      const ctx = '用户：我和伴侣总是吵架\nAI：什么时候开始的\n用户：好几个月了\nAI：有没有试过沟通\n用户：试过但没用';
      const r = analyzeConversation('你一直问相同的问题', ctx, { userTurnCount: 3, controlIntent: 'GENERAL_CHAT' });
      expect(r.help_progress).toBe('NO_HELP');
    });

    it('暂停序列：倾诉 → 暂停 → 不自动关闭', () => {
      const ctx = '用户：最近压力很大\nAI：能多说说吗\n用户：每天都觉得很累';
      const r = analyzeConversation('今天先到这儿吧', ctx, { userTurnCount: 2, controlIntent: 'PAUSE_TOPIC' });
      expect(r.issue_status).toBe('PAUSED');
      expect(r.no_more_questions).toBe(true);
    });

    it('纠正已解决：先说解决了然后改口 → 不触发 CLOSED', () => {
      const ctx = '用户：这件事解决了\nAI：那就好\n用户：不对';
      const r = analyzeConversation('我不是说已经解决了，只是好一点', ctx, { userTurnCount: 3, controlIntent: 'GENERAL_CHAT' });
      expect(r.issue_status).toBe('ACTIVE');
    });
  });
});
