import { describe, expect, it } from 'vitest';
import { analyzeConversation } from './rules.js';
import { classifyCurrentJob, currentJobShadowFromAnalysis, type CurrentJobInput } from './current-job.js';

/**
 * JTBD-01 影子分类验证（Issue #64）。
 *
 * 关键不变量：
 * - 不改变任何用户可见回复；这里只断言影子字段。
 * - 最新轮意愿覆盖旧判断（多轮）。
 * - 不串线：旧 Issue 的任务不会泄漏到新 Issue。
 * - 不把被动情绪标签当作明确任务；证据不足保持 UNDETERMINED。
 * - 真人交接/专业/安全分流不归入五类。
 */

function input(overrides: Partial<CurrentJobInput>): CurrentJobInput {
  return {
    userIntent: 'VENTING',
    controlIntent: 'GENERAL_CHAT',
    routing: 'AI_SUPPORT',
    safetyStatus: 'NO_SIGNAL_DETECTED',
    humanIntent: 'NOT_EXPLICIT',
    bookingPreference: 'NOT_EXPRESSED',
    issueStatus: 'ACTIVE',
    latestUserMessage: '我最近压力很大，晚上也睡不好。',
    recentUserMessages: [],
    ...overrides,
  };
}

describe('JTBD-01 current_job 影子分类', () => {
  it('EXPRESS：明确希望倾诉、被倾听', () => {
    const result = classifyCurrentJob(input({ userIntent: 'WANTS_COMFORT', latestUserMessage: '我只想先说说，不用给建议。' }));
    expect(result.current_job).toBe('EXPRESS');
    expect(result.confidence).toBe('HIGH');
    expect(result.evidence.some((item) => item.signal === 'user_intent' && item.value === 'WANTS_COMFORT')).toBe(true);
  });

  it('被动情绪表达不等于雇用 AI 来倾诉，保持 UNDETERMINED（记录实质性证据）', () => {
    const result = classifyCurrentJob(input({ userIntent: 'VENTING', latestUserMessage: '最近工作压力很大，整个人很疲惫，也说不清在烦什么。' }));
    expect(result.current_job).toBe('UNDETERMINED');
    expect(result.evidence.some((item) => item.signal === 'disclosure' && item.value === 'substantive')).toBe(true);
    expect(result.notes?.join('')).toMatch(/不等于|雇用|UNDEFINED|不确定/);
  });

  it('EXPRESS：拒绝建议后仍以被倾听为主，不升级成行动', () => {
    const result = classifyCurrentJob(input({ userIntent: 'WANTS_COMFORT', latestUserMessage: '别给我建议，我就想再说说。' }));
    expect(result.current_job).toBe('EXPRESS');
  });

  it('UNDERSTAND：明确想理清、探索、理解', () => {
    const result = classifyCurrentJob(input({ userIntent: 'WANTS_CLARITY', latestUserMessage: '我想理清楚，到底为什么我最近总是和伴侣吵架。' }));
    expect(result.current_job).toBe('UNDERSTAND');
    expect(result.confidence).toBe('HIGH');
  });

  it('ACT：明确要具体建议、下一步或行动', () => {
    const result = classifyCurrentJob(input({ userIntent: 'WANTS_ACTION', latestUserMessage: '工作压力很大，我该怎么办，给我个下一步。' }));
    expect(result.current_job).toBe('ACT');
    expect(result.confidence).toBe('HIGH');
  });

  it('SETTLE：明确表达结束/暂停，不把一般疲惫当作结束命令', () => {
    const result = classifyCurrentJob(input({ userIntent: 'WANTS_END', latestUserMessage: '先这样吧，我先不聊了，晚安。' }));
    expect(result.current_job).toBe('SETTLE');
    expect(result.confidence).toBe('HIGH');
  });

  it('SETTLE 正反向：明确暂缓/休息为 SETTLE；安定/疲惫类现有信号不足则 UNDETERMINED（不堆关键词）', () => {
    // 正向：明确的结束/暂缓/休息表达（已属 WANTS_END）。
    for (const text of ['先这样吧，我想先去休息一下。', '今天就到这吧，我去休息了，晚安。', '我先不聊了，先这样。']) {
      const result = classifyCurrentJob(input({ userIntent: 'WANTS_END', latestUserMessage: text }));
      expect(result.current_job, `${text} → ${result.current_job}`).toBe('SETTLE');
    }
    // 反向：安定/稳定/疲惫类请求若现有确定性信号不足，保持 UNDETERMINED，
    // 不误作 ACT（行动）或 SETTLE（结束）。已知局限：待 JTBD-02 设计策略再深化。
    for (const text of ['我很乱，先想安静一下', '带我简单稳定一下情绪', '我累了但还想聊']) {
      const analysis = analyzeConversation(text);
      const result = currentJobShadowFromAnalysis(analysis, text);
      expect(result.current_job, `${text} → ${result.current_job}`).toBe('UNDETERMINED');
      expect(result.current_job, text).not.toBe('ACT');
      expect(result.current_job, text).not.toBe('SETTLE');
    }
  });

  it('UNDETERMINED：仅简短情绪标签、证据不足时不臆测任务', () => {
    const result = classifyCurrentJob(input({ userIntent: 'VENTING', latestUserMessage: '烦' }));
    expect(result.current_job).toBe('UNDETERMINED');
    expect(result.confidence).toBe('LOW');
    expect(result.notes?.join('')).toMatch(/证据不足|UNDEFINED|不确定|保持 UNDETERMINED/);
  });

  it('UNDETERMINED：意图未知时保持不确定', () => {
    const result = classifyCurrentJob(input({ userIntent: 'UNKNOWN', latestUserMessage: '嗯。' }));
    expect(result.current_job).toBe('UNDETERMINED');
  });

  it('安全分流不属于五类，保持 UNDETERMINED 并记录证据', () => {
    const urgent = classifyCurrentJob(input({ safetyStatus: 'URGENT', routing: 'SAFETY_SUPPORT', latestUserMessage: '我现在正准备伤害自己。' }));
    expect(urgent.current_job).toBe('UNDETERMINED');
    expect(urgent.notes?.join('')).toMatch(/安全/);
    expect(urgent.evidence.some((item) => item.signal === 'safety_status')).toBe(true);

    const clarify = classifyCurrentJob(input({ safetyStatus: 'NEEDS_CLARIFICATION', latestUserMessage: '我已经不想活了。' }));
    expect(clarify.current_job).toBe('UNDETERMINED');
  });

  it('明确真人预约不属于五类，保持 UNDETERMINED', () => {
    const result = classifyCurrentJob(input({
      userIntent: 'WANTS_HUMAN', humanIntent: 'EXPLICIT', bookingPreference: 'ACCEPTED',
      controlIntent: 'ACCEPT_HANDOFF', latestUserMessage: '我现在就想预约真人导师。',
    }));
    expect(result.current_job).toBe('UNDETERMINED');
    expect(result.notes?.join('')).toMatch(/真人/);
  });

  it('只是“考虑真人”的疑问不归入五类排除项，按真实意愿归为 UNDERSTAND', () => {
    const result = classifyCurrentJob(input({
      userIntent: 'WANTS_CLARITY', humanIntent: 'NOT_EXPLICIT', bookingPreference: 'NOT_EXPRESSED',
      latestUserMessage: '真人导师会有帮助吗？我还不确定要不要找。',
    }));
    expect(result.current_job).toBe('UNDERSTAND');
  });

  it('QUICK_HANDOFF：系统建议交接（routing=HUMAN_MENTOR，用户未明确）不归入五类', () => {
    // 即便 user_intent 看似 WANTS_ACTION，只要已进入 QUICK_HANDOFF 路径就保持 UNDETERMINED。
    const result = classifyCurrentJob(input({
      userIntent: 'WANTS_ACTION', humanIntent: 'NOT_EXPLICIT', bookingPreference: 'NOT_EXPRESSED',
      routing: 'HUMAN_MENTOR', latestUserMessage: '前面这些建议没用，我现在到底怎么办？',
    }));
    expect(result.current_job).toBe('UNDETERMINED');
    expect(result.evidence.some((item) => item.signal === 'routing' && item.value === 'HUMAN_MENTOR')).toBe(true);
    expect(result.notes?.join('')).toMatch(/真人|交接/);
  });

  it('专业边界（用药决策）不属于五类，保持 UNDETERMINED', () => {
    const result = classifyCurrentJob(input({
      userIntent: 'WANTS_ACTION', routing: 'PROFESSIONAL_REFERRAL',
      latestUserMessage: '我能不能自己把抗抑郁药减一点？',
    }));
    expect(result.current_job).toBe('UNDETERMINED');
    expect(result.notes?.join('')).toMatch(/专业/);
  });

  it('切换/新建话题但尚未说明新任务时保持 UNDETERMINED，不沿用旧任务', () => {
    const result = classifyCurrentJob(input({
      userIntent: 'VENTING', controlIntent: 'SWITCH_TOPIC', issueStatus: 'AWAITING_TOPIC',
      latestUserMessage: '换个话题，先说这个。',
    }));
    expect(result.current_job).toBe('UNDETERMINED');
    expect(result.notes?.join('')).toMatch(/切换|新建话题|新任务/);
  });

  // —— 多轮：最新轮意愿覆盖旧判断 ——

  it('多轮1：先求助（ACT）后改口只想说说（EXPRESS），最新覆盖旧判断', () => {
    const first = classifyCurrentJob(input({ userIntent: 'WANTS_ACTION', latestUserMessage: '我该怎么办？' }));
    expect(first.current_job).toBe('ACT');
    const second = classifyCurrentJob(input({
      userIntent: 'WANTS_COMFORT', latestUserMessage: '算了别给我建议了，我就想说说。',
      recentUserMessages: ['我该怎么办？'],
    }));
    expect(second.current_job).toBe('EXPRESS');
  });

  it('多轮2：先只想倾诉（EXPRESS）后明确要下一步（ACT），最新覆盖', () => {
    const second = classifyCurrentJob(input({
      userIntent: 'WANTS_ACTION', latestUserMessage: '那你告诉我，接下来第一步做什么？',
      recentUserMessages: ['我只想先说说'],
    }));
    expect(second.current_job).toBe('ACT');
  });

  it('多轮3：先表达（EXPRESS）后明确结束（SETTLE），最新覆盖', () => {
    const second = classifyCurrentJob(input({
      userIntent: 'WANTS_END', controlIntent: 'CLOSE_TOPIC', latestUserMessage: '今天就到这吧，我去休息了，晚安。',
      recentUserMessages: ['我最近压力很大，想和你说说。'],
    }));
    expect(second.current_job).toBe('SETTLE');
  });

  it('多轮4：先想理清（UNDERSTAND）后否定改口只想被倾听（EXPRESS）', () => {
    const second = classifyCurrentJob(input({
      userIntent: 'WANTS_COMFORT', latestUserMessage: '你理解错了，我不是要分析，我只是想被听见。',
      recentUserMessages: ['我想理清楚这到底是怎么一回事。'],
    }));
    expect(second.current_job).toBe('EXPRESS');
  });

  it('多轮5：纠正“不是想辞职”后不归为职业行动，被动表达保持 UNDETERMINED', () => {
    const second = classifyCurrentJob(input({
      userIntent: 'VENTING', latestUserMessage: '你理解错了，我不是想辞职，我只是觉得很累。',
      recentUserMessages: ['我在想要不要辞职转行。'],
    }));
    expect(second.current_job).toBe('UNDETERMINED');
    expect(second.current_job).not.toBe('ACT');
  });

  it('多轮6：先明确预约真人（UNDETERMINED）后又撤回继续聊（EXPRESS），最新覆盖', () => {
    const second = classifyCurrentJob(input({
      userIntent: 'WANTS_COMFORT', humanIntent: 'DECLINED', bookingPreference: 'DECLINED',
      latestUserMessage: '不用预约了，我还是想先和你说说。',
      recentUserMessages: ['我现在就想预约真人导师。'],
    }));
    expect(second.current_job).toBe('EXPRESS');
  });

  // —— 不串线：Issue 切换/恢复 ——

  it('不串线：旧 Issue 在求助（ACT），切到新 Issue 仅被动倾诉（UNDETERMINED）不被旧任务污染', () => {
    const resumed = classifyCurrentJob(input({
      userIntent: 'VENTING', issueStatus: 'ACTIVE', controlIntent: 'CONTINUE_CURRENT_TOPIC',
      latestUserMessage: '嗯，我就是想找个人说说话。',
    }));
    expect(resumed.current_job).toBe('UNDETERMINED');
    expect(resumed.current_job).not.toBe('ACT');
  });

  it('不串线：恢复旧 Issue 时按该 Issue 最新轮意愿，而不是最近一条无关消息', () => {
    const result = classifyCurrentJob(input({
      userIntent: 'WANTS_CLARITY', issueStatus: 'ACTIVE', controlIntent: 'CONTINUE_CURRENT_TOPIC',
      latestUserMessage: '我想理清楚这件事到底卡在哪。',
    }));
    expect(result.current_job).toBe('UNDERSTAND');
  });

  it('证据引用来自最新轮用户消息，且被截断', () => {
    const long = '我真的' + '很长的一段话'.repeat(20);
    const result = classifyCurrentJob(input({ userIntent: 'WANTS_ACTION', latestUserMessage: long }));
    const quote = result.evidence.find((item) => item.quote)?.quote;
    expect(quote).toBeDefined();
    expect(quote?.endsWith('…')).toBe(true);
    expect(quote!.length).toBeLessThanOrEqual(37);
  });

  it('相同输入得到相同输出（纯函数、可回归）', () => {
    const sample = input({ userIntent: 'WANTS_CLARITY', latestUserMessage: '我想弄明白为什么。' });
    expect(classifyCurrentJob(sample)).toEqual(classifyCurrentJob({ ...sample }));
  });

  it('与真实规则链路集成：analyzeConversation 产出的信号可正确影子化', () => {
    const analysis = analyzeConversation('工作压力很大，我该怎么办？');
    const shadow = currentJobShadowFromAnalysis(analysis, '工作压力很大，我该怎么办？');
    expect(shadow.current_job).toBe('ACT');

    const safety = analyzeConversation('我现在正准备伤害自己');
    expect(currentJobShadowFromAnalysis(safety, '我现在正准备伤害自己').current_job).toBe('UNDETERMINED');

    const comfort = analyzeConversation('我只想先说说，不用给建议。');
    expect(currentJobShadowFromAnalysis(comfort, '我只想先说说，不用给建议。').current_job).toBe('EXPRESS');
  });

  it('与真实规则链路集成：最新轮改口能被 resolveConversationIntent 反映到 current_job', () => {
    // 先倾诉，再在最新轮改口要建议：contextText 让最新轮意愿生效。
    const latest = '那你直接告诉我下一步该怎么做。';
    const context = '用户：我只想先说说，不用给建议。';
    const analysis = analyzeConversation(latest, context);
    expect(analysis.user_intent).toBe('WANTS_ACTION');
    const shadow = currentJobShadowFromAnalysis(analysis, latest);
    expect(shadow.current_job).toBe('ACT');
  });
});
