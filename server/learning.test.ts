import { describe, expect, it } from 'vitest';
import { anonymousSessionId, dashboardFromRecords, insightFromMetrics, makeLearningEvent, makeMentorFeedback, parseConversationReview, scrubText, type LearningEventRecord } from './learning.js';

function sessionEnd(sessionId: string, questionCount = 0): LearningEventRecord {
  return makeLearningEvent({ eventId: `e-${sessionId}`, eventType: 'session_end', sessionId, metrics: { turn_count: 2, question_count: questionCount, consecutive_question_max: questionCount }, metadata: {} })!;
}

describe('V1.5A 学习数据边界', () => {
  it('脱敏个人联系方式并生成匿名会话标识', () => {
    expect(scrubText('我的手机号是13800138000，邮箱 a@example.com')).toContain('[手机号]');
    expect(scrubText('我的手机号是13800138000，邮箱 a@example.com')).toContain('[邮箱]');
    expect(anonymousSessionId('browser-random-session')).not.toContain('browser-random-session');
  });

  it('只接受配置内事件类型并限制指标范围', () => {
    expect(makeLearningEvent({ eventId: 'x', eventType: 'unknown', sessionId: 'browser-random-session' })).toBeNull();
    const event = makeLearningEvent({ eventId: 'x', eventType: 'chat_turn', sessionId: 'browser-random-session', metrics: { turn_count: 9999, repeated_question_rate: 2 }, metadata: { text: '手机号13800138000' } });
    expect(event?.metrics.turn_count).toBe(200);
    expect(event?.metrics.repeated_question_rate).toBe(1);
    expect(event?.metadata.text).toBe('手机号[手机号]');
  });

  it('只在证据足够时生成候选规则，且默认待人工审核', () => {
    expect(insightFromMetrics([sessionEnd('a', 3), sessionEnd('b', 3)], 'v1.5.0')).toBeNull();
    const result = insightFromMetrics([sessionEnd('a', 3), sessionEnd('b', 3), sessionEnd('c', 0)], 'v1.5.0');
    expect(result?.candidate.status).toBe('PENDING_HUMAN_REVIEW');
    expect(result?.candidate.required_tests.length).toBeGreaterThan(0);
  });

  it('复盘只保留受控字段，不把原始 JSON 直接作为结果', () => {
    const review = parseConversationReview(JSON.stringify({ problem_clarity: 2, main_problem: '手机号13800138000', improvement_suggestion: '先确认目标' }), 'anon_123');
    expect(review?.problem_clarity).toBe(1);
    expect(review?.main_problem).toBe('手机号[手机号]');
    expect(review?.scrubbed).toBe(true);
  });

  it('导师反馈必须使用受控枚举', () => {
    expect(makeMentorFeedback({ request_id: 'r', judgment_accuracy: 'BAD', summary_helpfulness: 'HELPFUL', handoff_timing: 'APPROPRIATE', ai_could_continue: 'NO' })).toBeNull();
    expect(makeMentorFeedback({ request_id: 'r', judgment_accuracy: 'ACCURATE', summary_helpfulness: 'HELPFUL', handoff_timing: 'APPROPRIATE', ai_could_continue: 'NO' })?.request_id).toBe('r');
  });

  it('看板只使用 session_end 汇总会话指标', () => {
    const dashboard = dashboardFromRecords({ mode: 'LOCAL_FILE', events: [sessionEnd('a', 2), sessionEnd('b', 0)], reviews: [], feedback: [], insights: [], candidates: [], promptVersion: 'v1.5.0' });
    expect(dashboard.totals.sessions).toBe(2);
    expect(dashboard.totals.average_question_count).toBe(1);
  });
});
