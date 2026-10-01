import type { ChatMessage } from '../src/shared.js';
import {
  dashboardFromRecords,
  insightFromMetrics,
  makeLearningEvent,
  makeMentorFeedback,
  parseConversationReview,
  reviewerPrompt,
  anonymousSessionId,
  type LearningDashboard,
  type LearningStore,
} from './learning.js';

export interface LearningServiceResult {
  status: number;
  body: unknown;
}

function messagesFromBody(value: unknown): ChatMessage[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is ChatMessage => Boolean(item && typeof item === 'object' && ((item as ChatMessage).role === 'user' || (item as ChatMessage).role === 'assistant') && typeof (item as ChatMessage).content === 'string'))
    .slice(-40)
    .map((item) => ({ role: item.role, content: item.content.slice(0, 4_000) }));
}

export async function recordLearningEvent(body: Record<string, unknown>, store: LearningStore | null): Promise<LearningServiceResult> {
  if (!store) return { status: 503, body: { error: '学习数据存储尚未配置', code: 'LEARNING_STORE_UNAVAILABLE' } };
  const event = makeLearningEvent({
    eventId: typeof body.eventId === 'string' ? body.eventId : '',
    eventType: body.eventType,
    sessionId: typeof body.sessionId === 'string' ? body.sessionId : '',
    occurredAt: typeof body.occurredAt === 'string' ? body.occurredAt : undefined,
    metrics: body.metrics,
    metadata: body.metadata,
  });
  if (!event) return { status: 400, body: { error: '学习事件格式不正确' } };
  await store.addEvent(event);
  if (event.event_type === 'session_end') await store.saveMetrics(event);
  return { status: 202, body: { ok: true, stored: true, eventId: event.event_id } };
}

export async function reviewConversation(
  body: Record<string, unknown>,
  store: LearningStore | null,
  callModel: (messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>, temperature?: number) => Promise<string>,
  reviewerText: string,
): Promise<LearningServiceResult> {
  if (!store) return { status: 503, body: { error: '学习数据存储尚未配置', code: 'LEARNING_STORE_UNAVAILABLE' } };
  if (body.consent !== true) return { status: 403, body: { error: '未获得本次对话的匿名改进授权' } };
  const sessionId = typeof body.sessionId === 'string' ? body.sessionId.trim() : '';
  const messages = messagesFromBody(body.messages);
  if (!sessionId || !messages.some((message) => message.role === 'user')) return { status: 400, body: { error: '没有可复盘的授权对话' } };
  const sessionHash = makeLearningEvent({ eventId: `review-${Date.now()}`, eventType: 'session_end', sessionId, metrics: {}, metadata: {} })?.session_hash;
  if (!sessionHash) return { status: 400, body: { error: '会话标识不正确' } };
  let raw: string;
  try {
    raw = await callModel([{ role: 'system', content: reviewerPrompt(reviewerText, messages) }], 0.1);
  } catch {
    return { status: 502, body: { error: '复盘服务暂时不可用', code: 'REVIEW_UNAVAILABLE' } };
  }
  const review = parseConversationReview(raw, sessionHash);
  if (!review) return { status: 502, body: { error: '复盘结果格式不正确', code: 'REVIEW_INVALID' } };
  await store.saveReview(review);
  return { status: 200, body: { ok: true, reviewId: review.review_id, review } };
}

export async function runLearningInsights(store: LearningStore | null, promptVersion: string): Promise<LearningServiceResult> {
  if (!store) return { status: 503, body: { error: '学习数据存储尚未配置', code: 'LEARNING_STORE_UNAVAILABLE' } };
  const events = await store.listEvents(1_000);
  const result = insightFromMetrics(events, promptVersion);
  if (!result) return { status: 200, body: { ok: true, created: false, reason: '样本量或证据暂不足，不生成候选规则' } };
  const existing = await store.listInsights(50);
  const sameEvidence = existing.some((insight) => insight.scope === result.insight.scope && insight.sample_size === result.insight.sample_size && insight.evidence.high_question_rate === result.insight.evidence.high_question_rate);
  if (sameEvidence) return { status: 200, body: { ok: true, created: false, reason: '相同证据已生成过候选规则' } };
  await store.saveInsight(result.insight);
  await store.saveCandidateRule(result.candidate);
  return { status: 200, body: { ok: true, created: true, insight: result.insight, candidate: result.candidate } };
}

export async function learningDashboard(store: LearningStore | null, promptVersion: string): Promise<LearningServiceResult> {
  if (!store) return { status: 503, body: { error: '学习数据存储尚未配置', code: 'LEARNING_STORE_UNAVAILABLE' } };
  const [events, reviews, feedback, insights, candidates] = await Promise.all([
    store.listEvents(1_000),
    store.listReviews(100),
    store.listMentorFeedback(100),
    store.listInsights(50),
    store.listCandidateRules(50),
  ]);
  const dashboard: LearningDashboard = dashboardFromRecords({ mode: store.mode, events, reviews, feedback, insights, candidates, promptVersion });
  return { status: 200, body: dashboard };
}

export async function recordMentorFeedback(body: Record<string, unknown>, store: LearningStore | null): Promise<LearningServiceResult> {
  if (!store) return { status: 503, body: { error: '学习数据存储尚未配置', code: 'LEARNING_STORE_UNAVAILABLE' } };
  const feedback = makeMentorFeedback(body);
  if (!feedback?.request_id) return { status: 400, body: { error: '导师反馈缺少预约编号或字段不完整' } };
  const saved = { ...feedback, created_at: new Date().toISOString() };
  await store.saveMentorFeedback(saved);
  return { status: 201, body: { ok: true, feedback: saved } };
}

export async function deleteLearningSession(body: Record<string, unknown>, store: LearningStore | null): Promise<LearningServiceResult> {
  if (!store) return { status: 503, body: { error: '学习数据存储尚未配置', code: 'LEARNING_STORE_UNAVAILABLE' } };
  const sessionId = typeof body.sessionId === 'string' ? body.sessionId.trim() : '';
  if (sessionId.length < 16 || sessionId.length > 200) return { status: 400, body: { error: '会话标识不正确' } };
  const deleted = await store.deleteBySession(anonymousSessionId(sessionId));
  return { status: 200, body: { ok: true, deleted } };
}
