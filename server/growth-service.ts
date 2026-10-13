import type { ChatMessage, ConversationAnalysis, GrowthCardKey, GrowthEvent, GrowthEventCategory, GrowthFeedback, GrowthInsightCard, GrowthPeriod, GrowthSnapshot, GrowthWatchItem, TopicCode } from '../src/shared.js';
import type { GrowthStore } from './growth-store.js';
import { scrubText } from './learning.js';

export interface GrowthServiceResult { status: number; body: unknown; }
type ModelMessage = { role: 'system' | 'user' | 'assistant'; content: string };
type CallGrowthModel = (messages: ModelMessage[], temperature?: number) => Promise<string>;
type GrowthCandidate = Pick<GrowthEvent, 'category' | 'topic' | 'title' | 'summary' | 'user_words' | 'evidence' | 'change_direction' | 'strength' | 'next_step' | 'impact'>;

function text(value: unknown, max = 400) { return typeof value === 'string' ? scrubText(value.trim().slice(0, max), max) : ''; }
function growthId(value: unknown) { const id = text(value, 120); return /^[a-zA-Z0-9_:.\-]{12,120}$/.test(id) ? id : ''; }
function hash(value: string) { let result = 2_166_136_261; for (const character of value) { result ^= character.codePointAt(0) || 0; result = Math.imul(result, 16_777_619); } return (result >>> 0).toString(16); }
function parseObject(raw: string): Record<string, unknown> | null {
  const normalized = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  const start = normalized.indexOf('{');
  const end = normalized.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try { return JSON.parse(normalized.slice(start, end + 1)) as Record<string, unknown>; } catch { return null; }
}
function arrayOfText(value: unknown, max = 4) { return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string').map((item) => item.trim().slice(0, 180)).filter(Boolean).slice(0, max) : []; }
function topic(value: unknown): TopicCode | 'OTHER' { return ['EMOTION', 'CAREER', 'MONEY', 'INTIMACY', 'FAMILY', 'PARENTING', 'SELF_KNOWLEDGE', 'INTERPERSONAL', 'BODY_LIFE', 'OTHER'].includes(value as string) ? value as TopicCode : 'OTHER'; }
function now() { return new Date().toISOString(); }

function messagesFromBody(value: unknown): ChatMessage[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is ChatMessage => Boolean(item && typeof item === 'object' && ((item as ChatMessage).role === 'user' || (item as ChatMessage).role === 'assistant') && typeof (item as ChatMessage).content === 'string'))
    .slice(-18).map((item) => ({ role: item.role, content: item.content.slice(0, 1_200) }));
}

function analysisFromBody(value: unknown) { return value && typeof value === 'object' ? value as Partial<ConversationAnalysis> : {}; }

function eventCandidateFromModel(raw: string): GrowthCandidate | null {
  const value = parseObject(raw);
  if (!value || !text(value.title) || !text(value.summary)) return null;
  return {
    category: (['THEME', 'CHANGE', 'PATTERN', 'STRENGTH', 'NEXT_STEP'].includes(value.category as string) ? value.category : 'THEME') as GrowthEventCategory,
    topic: topic(value.topic),
    title: text(value.title, 60),
    summary: text(value.summary, 260),
    user_words: text(value.user_words, 80) || null,
    evidence: arrayOfText(value.evidence),
    change_direction: (['IMPROVING', 'STABLE', 'FLUCTUATING', 'NEEDS_SUPPORT', 'UNKNOWN'].includes(value.change_direction as string) ? value.change_direction : 'UNKNOWN') as GrowthEvent['change_direction'],
    strength: text(value.strength, 160) || null,
    next_step: text(value.next_step, 160) || null,
    impact: (['LOW', 'MEDIUM', 'HIGH'].includes(value.impact as string) ? value.impact : 'MEDIUM') as GrowthEvent['impact'],
  };
}

function fallbackEvent(analysis: Partial<ConversationAnalysis>): GrowthCandidate {
  const problem = analysis.problem_map && typeof analysis.problem_map === 'object' ? analysis.problem_map as unknown as Record<string, unknown> : {};
  const mainIssue = text(problem.main_issue, 80) || text(analysis.confirmed_goal, 80) || '当前的困扰';
  const tags = Array.isArray(analysis.tags) ? analysis.tags : [];
  return {
    category: 'THEME' as const,
    topic: topic(tags[0]),
    title: mainIssue,
    summary: text(analysis.confirmed_goal, 220) || `你开始更具体地看见“${mainIssue}”对自己的影响。`,
    user_words: null,
    evidence: [text(problem.scene_summary, 160), text(problem.user_goal, 160)].filter(Boolean),
    change_direction: analysis.support_feedback ? 'FLUCTUATING' as const : 'UNKNOWN' as const,
    strength: '愿意把真实处境说出来，并继续看一看。',
    next_step: '先留意这件事在接下来几天什么时候最容易出现。',
    impact: 'MEDIUM' as const,
  };
}

function eventStableKey(candidate: GrowthCandidate, analysis: Partial<ConversationAnalysis>) {
  const problem = analysis.problem_map && typeof analysis.problem_map === 'object' ? analysis.problem_map as unknown as Record<string, unknown> : {};
  const issue = text(problem.main_issue, 80) || candidate.title;
  return `${candidate.topic}:${issue}`.toLowerCase().replace(/\s+/g, '').slice(0, 160);
}

export async function recordGrowthEvent(body: Record<string, unknown>, store: GrowthStore | null, callModel: CallGrowthModel, prompt: string): Promise<GrowthServiceResult> {
  if (!store) return { status: 503, body: { error: '成长记忆存储尚未配置', code: 'GROWTH_STORE_UNAVAILABLE' } };
  if (body.consent !== true) return { status: 403, body: { error: '未开启长期成长记录' } };
  const id = growthId(body.growthId);
  const messages = messagesFromBody(body.messages);
  if (!id || !messages.some((item) => item.role === 'user')) return { status: 400, body: { error: '成长事件缺少有效的匿名标识或对话内容' } };
  const analysis = analysisFromBody(body.analysis);
  const sufficient = analysis.minimum_sufficient_judgment === true || Boolean(text(analysis.confirmed_goal)) || Number(analysis.problem_clarity || 0) >= 0.55 || messages.filter((item) => item.role === 'user').length >= 3;
  if (!sufficient) return { status: 200, body: { ok: true, created: false, reason: '当前对话还不足以形成有价值的成长事件' } };

  let candidate: ReturnType<typeof fallbackEvent> | null = null;
  try {
    const raw = await callModel([{ role: 'system', content: prompt }, { role: 'user', content: JSON.stringify({ analysis, messages }) }], 0.15);
    candidate = eventCandidateFromModel(raw);
  } catch { /* Growth memory is non-blocking; structured fallback keeps chat available. */ }
  candidate ||= fallbackEvent(analysis);
  if (candidate.topic === 'OTHER' && Array.isArray(analysis.tags)) {
    const confirmedTopic = analysis.tags.find((tag) => topic(tag) !== 'OTHER');
    if (confirmedTopic) candidate.topic = topic(confirmedTopic);
  }
  const stableKey = eventStableKey(candidate, analysis);
  const existing = (await store.listEvents(id, 200)).find((item) => item.stable_key === stableKey);
  const timestamp = now();
  const event: GrowthEvent = {
    event_id: existing?.event_id || `growth-event-${hash(`${id}:${stableKey}`)}`,
    growth_id: id,
    created_at: existing?.created_at || timestamp,
    observed_at: timestamp,
    issue_id: text(body.issueId, 120) || null,
    ...candidate,
    stable_key: stableKey,
    seen_count: (existing?.seen_count || 0) + 1,
    last_seen_at: timestamp,
    evidence: [...new Set([...(existing?.evidence || []), ...candidate.evidence])].slice(0, 6),
  };
  await store.saveEvent(event);
  return { status: 202, body: { ok: true, created: !existing, merged: Boolean(existing), event } };
}

function periodStart(period: GrowthPeriod) { return Date.now() - (period === '90d' ? 90 : 30) * 86_400_000; }
function cardsFromModel(value: Record<string, unknown>, eventIds: string[]) {
  const raw = Array.isArray(value.cards) ? value.cards : [];
  const allowed: GrowthCardKey[] = ['MAIN_THEME', 'CHANGE', 'PATTERN', 'STRENGTH', 'NEXT_FOCUS'];
  const cards = allowed.map((key) => {
    const item = raw.find((entry) => entry && typeof entry === 'object' && (entry as Record<string, unknown>).key === key) as Record<string, unknown> | undefined;
    return item && text(item.content) ? { key, title: text(item.title, 30) || ({ MAIN_THEME: '这段时间的主线', CHANGE: '你正在经历的变化', PATTERN: '反复出现的模式', STRENGTH: '你身上的力量', NEXT_FOCUS: '接下来可以留意' } as Record<GrowthCardKey, string>)[key], content: text(item.content, 260), evidence_event_ids: Array.isArray(item.evidence_event_ids) ? item.evidence_event_ids.filter((id): id is string => typeof id === 'string' && eventIds.includes(id)).slice(0, 4) : [], confidence: (['LOW', 'MEDIUM', 'HIGH'].includes(item.confidence as string) ? item.confidence : 'MEDIUM') as GrowthInsightCard['confidence'] } : null;
  }).filter((item): item is GrowthInsightCard => Boolean(item));
  return cards.length === 5 ? cards : null;
}

function fallbackSnapshot(events: GrowthEvent[]): { cards: GrowthInsightCard[]; watch_recommendation: string | null } {
  const latest = events[0];
  const themes = [...new Set(events.map((event) => event.topic))];
  return {
    cards: [
      { key: 'MAIN_THEME', title: '这段时间的主线', content: latest?.summary || '你开始愿意持续看见自己的处境。', evidence_event_ids: latest ? [latest.event_id] : [], confidence: 'MEDIUM' },
      { key: 'CHANGE', title: '你正在经历的变化', content: events.length > 1 ? `你已经连续留下 ${events.length} 个值得回看的片段，说明你不只是在应付当下，也在慢慢理解自己。` : '变化还在形成中，先不用急着给它下结论。', evidence_event_ids: events.slice(0, 3).map((event) => event.event_id), confidence: events.length >= 4 ? 'HIGH' : 'MEDIUM' },
      { key: 'PATTERN', title: '反复出现的模式', content: themes.length > 1 ? `最近的困扰不只在一个方面出现，${themes.slice(0, 2).join('和')}之间可能会互相牵动。` : (events.find((event) => event.category === 'PATTERN')?.summary || '我们还在一起辨认哪些时刻会让这件事变得更明显。'), evidence_event_ids: events.slice(0, 4).map((event) => event.event_id), confidence: 'LOW' },
      { key: 'STRENGTH', title: '你身上的力量', content: events.find((event) => event.strength)?.strength || '你愿意停下来感受自己，也愿意把难处说出来。', evidence_event_ids: events.filter((event) => event.strength).slice(0, 3).map((event) => event.event_id), confidence: 'MEDIUM' },
      { key: 'NEXT_FOCUS', title: '接下来可以留意', content: latest?.next_step || '接下来一周，可以留意这份感受最容易在哪些时刻出现。', evidence_event_ids: latest ? [latest.event_id] : [], confidence: 'MEDIUM' },
    ],
    watch_recommendation: latest?.next_step || null,
  };
}

export async function generateGrowthSnapshot(body: Record<string, unknown>, store: GrowthStore | null, callModel: CallGrowthModel, prompt: string): Promise<GrowthServiceResult> {
  if (!store) return { status: 503, body: { error: '成长记忆存储尚未配置', code: 'GROWTH_STORE_UNAVAILABLE' } };
  if (body.consent !== true) return { status: 403, body: { error: '未开启长期成长记录' } };
  const id = growthId(body.growthId);
  const period: GrowthPeriod = body.period === '90d' ? '90d' : '30d';
  if (!id) return { status: 400, body: { error: '成长标识不正确' } };
  const events = (await store.listEvents(id, 200)).filter((event) => Date.parse(event.last_seen_at) >= periodStart(period)).sort((a, b) => b.last_seen_at.localeCompare(a.last_seen_at));
  if (events.length < 3) return { status: 200, body: { ok: true, ready: false, reason: '我们还没聊够久，暂时看不出真正有价值的变化。', events, snapshot: null, watch: await store.getActiveWatch(id) } };
  const eventIds = events.map((event) => event.event_id).sort();
  const existing = (await store.listSnapshots(id, 30)).find((snapshot) => snapshot.period === period && [...snapshot.event_ids].sort().join('|') === eventIds.join('|'));
  if (existing) return { status: 200, body: { ok: true, ready: true, stable: true, events, snapshot: existing, watch: await store.getActiveWatch(id) } };

  let generated: { cards: GrowthInsightCard[]; watch_recommendation: string | null } | null = null;
  try {
    const raw = await callModel([{ role: 'system', content: prompt }, { role: 'user', content: JSON.stringify({ period, events }) }], 0.2);
    const parsed = parseObject(raw);
    const cards = parsed ? cardsFromModel(parsed, eventIds) : null;
    if (cards) generated = { cards, watch_recommendation: text(parsed?.watch_recommendation, 180) || null };
  } catch { /* fall through to the evidence-bound local summary. */ }
  generated ||= fallbackSnapshot(events);
  const snapshot: GrowthSnapshot = { snapshot_id: `growth-snapshot-${hash(`${id}:${period}:${eventIds.join('|')}`)}`, growth_id: id, period, generated_at: now(), event_ids: eventIds, cards: generated.cards, watch_recommendation: generated.watch_recommendation, feedback: null };
  await store.saveSnapshot(snapshot);
  return { status: 200, body: { ok: true, ready: true, stable: false, events, snapshot, watch: await store.getActiveWatch(id) } };
}

export async function recentGrowth(body: Record<string, unknown>, store: GrowthStore | null): Promise<GrowthServiceResult> {
  if (!store) return { status: 503, body: { error: '成长记忆存储尚未配置', code: 'GROWTH_STORE_UNAVAILABLE' } };
  if (body.consent !== true) return { status: 403, body: { error: '未开启长期成长记录' } };
  const id = growthId(body.growthId);
  if (!id) return { status: 400, body: { error: '成长标识不正确' } };
  const events = await store.listEvents(id, 200);
  const snapshots = await store.listSnapshots(id, 20);
  return { status: 200, body: { ok: true, events, snapshot: snapshots[0] || null, watch: await store.getActiveWatch(id) } };
}

export async function recordGrowthFeedback(body: Record<string, unknown>, store: GrowthStore | null): Promise<GrowthServiceResult> {
  if (!store) return { status: 503, body: { error: '成长记忆存储尚未配置', code: 'GROWTH_STORE_UNAVAILABLE' } };
  if (body.consent !== true) return { status: 403, body: { error: '未开启长期成长记录' } };
  const id = growthId(body.growthId);
  const snapshotId = text(body.snapshotId, 120);
  const value = body.feedback === 'INACCURATE' ? 'INACCURATE' : body.feedback === 'ACCURATE' ? 'ACCURATE' : '';
  if (!id || !snapshotId || !value) return { status: 400, body: { error: '反馈信息不完整' } };
  const feedback: GrowthFeedback = { feedback_id: `growth-feedback-${hash(`${id}:${snapshotId}:${body.cardKey || ''}:${Date.now()}`)}`, growth_id: id, snapshot_id: snapshotId, card_key: ['MAIN_THEME', 'CHANGE', 'PATTERN', 'STRENGTH', 'NEXT_FOCUS'].includes(body.cardKey as string) ? body.cardKey as GrowthCardKey : null, feedback: value, created_at: now() };
  await store.saveFeedback(feedback);
  return { status: 201, body: { ok: true, feedback } };
}

export async function saveGrowthWatch(body: Record<string, unknown>, store: GrowthStore | null): Promise<GrowthServiceResult> {
  if (!store) return { status: 503, body: { error: '成长记忆存储尚未配置', code: 'GROWTH_STORE_UNAVAILABLE' } };
  if (body.consent !== true) return { status: 403, body: { error: '未开启长期成长记录' } };
  const id = growthId(body.growthId);
  const title = text(body.title, 80);
  const description = text(body.description, 240);
  if (!id || !title || !description) return { status: 400, body: { error: '观察项信息不完整' } };
  const createdAt = now();
  const watch: GrowthWatchItem = { watch_id: `growth-watch-${hash(`${id}:${createdAt}`)}`, growth_id: id, created_at: createdAt, expires_at: new Date(Date.now() + 7 * 86_400_000).toISOString(), title, description, source_snapshot_id: text(body.snapshotId, 120) || null, status: 'ACTIVE' };
  await store.saveWatch(watch);
  return { status: 201, body: { ok: true, watch } };
}

export async function clearGrowthWatch(body: Record<string, unknown>, store: GrowthStore | null): Promise<GrowthServiceResult> {
  if (!store) return { status: 503, body: { error: '成长记忆存储尚未配置', code: 'GROWTH_STORE_UNAVAILABLE' } };
  const id = growthId(body.growthId);
  if (!id) return { status: 400, body: { error: '成长标识不正确' } };
  return { status: 200, body: { ok: true, cleared: await store.clearWatch(id) } };
}

export async function deleteGrowthMemory(body: Record<string, unknown>, store: GrowthStore | null): Promise<GrowthServiceResult> {
  if (!store) return { status: 503, body: { error: '成长记忆存储尚未配置', code: 'GROWTH_STORE_UNAVAILABLE' } };
  const id = growthId(body.growthId);
  if (!id) return { status: 400, body: { error: '成长标识不正确' } };
  return { status: 200, body: { ok: true, deleted: await store.deleteMemory(id) } };
}

export function watchIsRelevant(watch: GrowthWatchItem, latestText: string) {
  const source = `${watch.title}${watch.description}`.toLowerCase();
  const words = source.split(/[，。；、：\s,.;:!?！？]+/).map((word) => word.trim()).filter((word) => word.length >= 2);
  const topicMatches = [
    ['工作', /工作|上班|下班|职场/],
    ['焦虑', /焦虑|紧张|担心|不安/],
    ['睡', /睡|失眠|熬夜|休息/],
    ['关系', /关系|伴侣|恋爱|家人|父母/],
  ];
  return words.some((word) => latestText.toLowerCase().includes(word)) || topicMatches.some(([keyword, pattern]) => source.includes(keyword as string) && (pattern as RegExp).test(latestText));
}
