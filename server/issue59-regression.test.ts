import { describe, expect, it } from 'vitest';
import { analyzeConversation, buildConversationUnderstanding, resolveConversationIntent } from './rules.js';

describe('Issue #59 导师式开放探索回归', () => {
  it('把纠正误解和明确拒绝探索区分开', () => {
    const correction = analyzeConversation(
      '我没有提到经济压力吧',
      '用户：最近工作压力很大。\n用户：完全没有收入。',
      { issueTopicTags: ['CAREER', 'MONEY'], userTurnCount: 3 },
    );
    expect(correction.user_intent).toBe('VENTING');
    // JTBD-02B：纠正后先镜像确认，不追问事实（覆盖 Issue #59 旧行为）
    expect(correction.primary_response_strategy).toMatch(/MIRROR|EMPATHIZE|LISTEN/);
    expect(correction.ask_question).toBe(false);
    expect(correction.no_more_questions).toBe(false);

    const refusal = analyzeConversation('我只想倾诉，不想被问问题。', '用户：最近工作压力很大。', { userTurnCount: 3 });
    expect(refusal).toMatchObject({ user_intent: 'WANTS_COMFORT', ask_question: false, no_more_questions: true });
  });

  it('然后呢和混乱焦急会推进到具体事件，而不是重复空泛承接', () => {
    const context = '用户：最近工作压力很大，开会时总被同事打断。';
    const then = analyzeConversation('然后呢？', context, { issueTopicTags: ['CAREER'], userTurnCount: 3 });
    expect(then).toMatchObject({ user_intent: 'WANTS_CLARITY', ask_question: true, no_more_questions: false });
    expect(then.next_question).toBe('你说的工作压力，最近具体卡在哪一件事上？');

    const messy = analyzeConversation('事情有点乱，心里着急', context, { issueTopicTags: ['CAREER'], userTurnCount: 3 });
    expect(messy.next_question).toBe('现在最让你着急的，是哪一件具体的事？');
  });

  it('纠正经济推断后，当前及后续工作对话不再继承收入/欠钱事实', () => {
    const messages = [
      { role: 'user' as const, content: '最近工作压力很大。' },
      { role: 'user' as const, content: '完全没有收入。' },
      { role: 'user' as const, content: '我没有提到经济压力吧' },
      { role: 'user' as const, content: '具体写什么？' },
    ];
    const understanding = buildConversationUnderstanding(messages, ['CAREER', 'MONEY']);
    expect(understanding.known_facts.functional_impact).toBeUndefined();
    const analysis = analyzeConversation('具体写什么？', messages.slice(0, -1).map((item) => `用户：${item.content}`).join('\n'), { issueTopicTags: ['CAREER', 'MONEY'], userTurnCount: 4 });
    expect(analysis.tags).not.toContain('MONEY');
    expect(analysis.problem_map.functional_impacts).not.toContain('finance');
    expect(analysis.next_question).toContain('工作压力');
    expect(resolveConversationIntent('具体写什么？', '用户：我没有提到经济压力吧')).toBe('WANTS_CLARITY');
  });
});
