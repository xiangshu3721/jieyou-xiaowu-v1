import { describe, expect, it } from 'vitest';
import { analyzeConversation, classifyConcern, detectSafety, routeConcern } from './rules.js';

describe('解忧小屋智能导诊规则', () => {
  it('支持多标签分类，并保留当前主题优先顺序', () => {
    expect(classifyConcern('最近工作压力很大，和伴侣也总是吵架')).toEqual(['EMOTION', 'CAREER', 'INTIMACY']);
  });

  it('对可信即时危险进入安全支持，对模糊表达先澄清', () => {
    expect(detectSafety('我现在正准备伤害自己')).toBe('URGENT');
    expect(detectSafety('我没有想过自杀，但现在正准备伤害自己')).toBe('URGENT');
    expect(detectSafety('我已经不想活了')).toBe('NEEDS_CLARIFICATION');
    expect(routeConcern('我现在正准备伤害自己，我想预约真人', 'URGENT')).toBe('EMERGENCY_SUPPORT');
    expect(analyzeConversation('我现在正准备伤害自己').conversation_state).toBe('SAFETY_SUPPORT');
  });

  it('用户明确要真人时不要求先完成探索', () => {
    const analysis = analyzeConversation('我想找真人导师聊聊');
    expect(analysis.conversation_state).toBe('HUMAN_SERVICE');
    expect(analysis.routing_state).toBe('HUMAN_SUPPORT');
    expect(analysis.booking_preference).toBe('ACCEPTED');
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

  it('专业需求进入专业转介，而不是被普通自助覆盖', () => {
    const analysis = analyzeConversation('我想知道自己是不是需要心理治疗或精神科帮助');
    expect(analysis.routing_state).toBe('PROFESSIONAL_REFERRAL');
    expect(routeConcern('我想了解心理咨询', 'NO_SIGNAL_DETECTED')).toBe('PROFESSIONAL_REFERRAL');
  });

  it('记录用户对帮助效果的反馈', () => {
    expect(analyzeConversation('你刚才说的方法对我没什么用').support_feedback).toBe('用户反馈当前帮助效果不足');
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

  it('V1.4 覆盖咨询服务和老师沟通等明确真人表达', () => {
    for (const text of ['有没有心理咨询师？', '有没有老师可以聊？', '有咨询服务吗']) {
      const analysis = analyzeConversation(text);
      expect(analysis.handoff_mode).toBe('DIRECT_HANDOFF');
      expect(analysis.human_intent).toBe('EXPLICIT');
      expect(analysis.show_booking_button).toBe(true);
      expect(analysis.ask_question).toBe(false);
    }
  });

  it('V1.4 用户明确拒绝真人时不触发交接', () => {
    const analysis = analyzeConversation('我不想找心理咨询师，先自己聊聊');
    expect(analysis.human_intent).toBe('DECLINED');
    expect(analysis.handoff_mode).toBe('NONE');
    expect(analysis.routing).toBe('AI_SUPPORT');
    expect(analysis.show_booking_button).toBe(false);
  });

  it('V1.4 达到最低充分判断后快速交接，不继续追问完整背景', () => {
    const analysis = analyzeConversation('最近三个月总是焦虑，晚上睡不着，白天没精神');
    expect(analysis.minimum_sufficient_judgment).toBe(true);
    expect(analysis.handoff_mode).toBe('QUICK_HANDOFF');
    expect(analysis.routing).toBe('HUMAN_MENTOR');
    expect(analysis.show_booking_button).toBe(true);
    expect(analysis.ask_question).toBe(false);
    expect(analysis.next_question).toBeNull();
  });

  it('V1.4 信息仍不足且 AI 还有明显帮助价值时继续 AI 支持', () => {
    const analysis = analyzeConversation('最近总是焦虑怎么办');
    expect(analysis.handoff_mode).toBe('NONE');
    expect(analysis.minimum_sufficient_judgment).toBe(false);
    expect(analysis.routing).toBe('AI_SUPPORT');
    expect(analysis.show_booking_button).toBe(false);
  });
});
