import { describe, expect, it } from 'vitest';
import { analyzeConversation, recentSafetyStatus } from './rules.js';
import { detectConversationControl } from './issue.js';
import scenariosData from '../tests/jtbd-05-scenarios.json';

describe('JTBD-05 离线评测', () => {
  const scenarios = scenariosData.scenarios;

  const assertExpected = (analysis: Record<string, unknown>, expected: Record<string, unknown>) => {
    for (const [key, value] of Object.entries(expected)) {
      if (key.endsWith('_not')) expect(analysis[key.slice(0, -4)]).not.toBe(value);
      else expect(analysis[key]).toBe(value);
    }
  };

  it('场景数据加载成功：20 个单场景和 10 条多轮序列', () => {
    expect(scenarios.length).toBe(20);
    expect(scenariosData.multi_turn_sequences.length).toBe(10);
  });

  // 单场景测试（20 个）
  describe('单场景测试（20 个）', () => {
    for (const scenario of scenarios.filter(s => !s.id.startsWith('MT'))) {
      it(`${scenario.id} - ${scenario.category}`, () => {
        const turns = scenario.turns;
        const lastUserTurn = turns.filter(t => t.role === 'user').pop();
        if (!lastUserTurn) {
          throw new Error(`Scenario ${scenario.id} has no user turn`);
        }

        const contextText = turns
          .slice(0, -1)
          .filter(t => t.role === 'user')
          .map(t => `用户：${t.content}`)
          .join('\n');

        // 检测对话控制意图
        const controlIntent = detectConversationControl(lastUserTurn.content);

        const analysis = analyzeConversation(lastUserTurn.content, contextText, { controlIntent });

        // 验证 expected 字段
        if (scenario.expected.user_intent) {
          expect(scenario.expected.user_intent).toContain(analysis.user_intent);
        }

        if (scenario.expected.response_goal) {
          expect(scenario.expected.response_goal).toContain(analysis.response_goal);
        }

        if (scenario.expected.help_progress) {
          expect(analysis.help_progress).toBe(scenario.expected.help_progress);
        }

        if (scenario.expected.issue_status) {
          expect(analysis.issue_status).toBe(scenario.expected.issue_status);
        }

        if (scenario.expected.control_intent) {
          expect(analysis.control_intent).toBe(scenario.expected.control_intent);
        }

        if (scenario.expected.no_more_questions !== undefined) {
          expect(analysis.no_more_questions).toBe(scenario.expected.no_more_questions);
        }

        // 验证 must_not 字段
        if (scenario.expected.must_not) {
          for (const notAllowed of scenario.expected.must_not) {
            expect(analysis.response_goal).not.toBe(notAllowed);
            expect(analysis.user_intent).not.toBe(notAllowed);
          }
        }

        // 验证 must_not_announce（进展识别场景）
        // must_not_announce 是真实话术要求，离线规则测试不把它计为通过。
      });
    }
  });

  describe('多轮序列（10 条逐轮规则执行）', () => {
    for (const sequence of scenariosData.multi_turn_sequences) {
      it(`${sequence.id} - ${sequence.description}`, () => {
        const messages: Array<{ role: 'user' | 'assistant'; content: string }> = [];
        let issueStatus: import('../src/shared.js').IssueStatus = 'ACTIVE';
        let userIndex = 0;
        let latest: Record<string, unknown> = {};
        const turnExpectations = (sequence as any).turn_expectations || [];

        for (const turn of sequence.turns) {
          if (turn.role === 'assistant') {
            messages.push(turn as { role: 'user' | 'assistant'; content: string });
            continue;
          }
          const priorUserContext = messages.filter((message) => message.role === 'user').map((message) => `用户：${message.content}`).join('\n');
          const userTurn = turn as { role: 'user'; content: string };
          const safetyStatus = recentSafetyStatus([...messages, userTurn]);
          latest = analyzeConversation(turn.content, priorUserContext, {
            issueStatus,
            handoffOffered: (issueStatus as string) === 'HANDOFF_OFFERED',
            controlIntent: detectConversationControl(turn.content),
            safetyStatus,
          }) as unknown as Record<string, unknown>;
          expect(latest.issue_status).toBeDefined();
          expect(latest.safety_status).toBeDefined();
          const expected = turnExpectations[userIndex];
          if (expected) assertExpected(latest, expected);
          issueStatus = latest.issue_status as import('../src/shared.js').IssueStatus;
          messages.push(userTurn);
          userIndex += 1;
        }
        assertExpected(latest, sequence.final_expected as Record<string, unknown>);
      });
    }
  });

  // 暂停恢复场景特殊处理
  describe('S04 暂停恢复', () => {
    it('暂停后恢复应保持在同一 Issue', () => {
      const scenario = scenarios.find(s => s.id === 'S04-pause-resume');
      if (!scenario) throw new Error('S04 scenario not found');

      // 第一轮：暂停
      const pauseTurn = scenario.turns[scenario.turns.length - 1];
      const pauseControlIntent = detectConversationControl(pauseTurn.content);
      const pauseAnalysis = analyzeConversation(
        pauseTurn.content,
        scenario.turns.slice(0, -1).filter(t => t.role === 'user').map(t => `用户：${t.content}`).join('\n'),
        { controlIntent: pauseControlIntent }
      );

      expect(pauseAnalysis.issue_status).toBe('PAUSED');
      expect(pauseAnalysis.control_intent).toBe('PAUSE_TOPIC');
      expect(pauseAnalysis.no_more_questions).toBe(true);

      // 第二轮：恢复
      if (scenario.resume_turn) {
        const resumeControlIntent = detectConversationControl(scenario.resume_turn.content);
        const resumeAnalysis = analyzeConversation(
          scenario.resume_turn.content,
          scenario.turns.filter(t => t.role === 'user').map(t => `用户：${t.content}`).join('\n'),
          { controlIntent: resumeControlIntent }
        );

        expect(resumeAnalysis.issue_status).toBe('ACTIVE');
        expect(resumeAnalysis.control_intent).not.toBe('PAUSE_TOPIC');
      }
    });
  });

  // S18 CLOSED 恢复特殊处理
  describe('S18 CLOSED 恢复', () => {
    it('CLOSED 恢复场景的控制意图识别', () => {
      const scenario = scenarios.find(s => s.id === 'S18-closed-recovery');
      if (!scenario) throw new Error('S18 scenario not found');

      // 第一轮：解决 → RESOLVE_TOPIC
      const resolveTurn = scenario.turns[0];
      const resolveControlIntent = detectConversationControl(resolveTurn.content);
      expect(resolveControlIntent).toBe('RESOLVE_TOPIC');

      // 第二轮：恢复 → 应该是 CONTINUE_CURRENT_TOPIC 或 GENERAL_CHAT，不是 RESOLVE_TOPIC
      const recoveryTurn = scenario.turns[2]; // 跳过 assistant 回复
      const recoveryControlIntent = detectConversationControl(recoveryTurn.content);
      expect(recoveryControlIntent).not.toBe('RESOLVE_TOPIC');
      // 实际应该是 CONTINUE_CURRENT_TOPIC（"我想接着聊"）
      expect(recoveryControlIntent).toBe('CONTINUE_CURRENT_TOPIC');
    });
  });
});
