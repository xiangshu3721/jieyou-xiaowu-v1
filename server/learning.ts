import type { ChatMessage, ConversationAnalysis } from '../src/shared.js';

export type LearningEventType =
  | 'chat_turn'
  | 'booking_cta_shown'
  | 'booking_clicked'
  | 'summary_generated'
  | 'summary_edited'
  | 'session_end'
  | 'learning_consent_updated';

export interface ConversationMetricsSnapshot {
  turn_count: number;
  question_count: number;
  consecutive_question_max: number;
  problem_clarity_reached: boolean;
  assessment_recommended: boolean;
  assessment_completed: boolean;
  handoff: boolean;
  handoff_turn: number | null;
  booking_button_shown: boolean;
  booking_clicked: boolean;
  user_abandoned: boolean;
  user_correction_count: number;
  summary_modified_ratio: number | null;
  average_response_length: number;
  response_length_variance: number;
  repeated_question_rate: number;
  clarification_efficiency: number | null;
}

export interface LearningEventRecord {
  event_id: string;
  event_type: LearningEventType;
  session_hash: string;
  occurred_at: string;
  metrics: ConversationMetricsSnapshot;
  metadata: Record<string, string | number | boolean | null>;
}

export interface ConversationReview {
  review_id: string;
  session_hash: string;
  created_at: string;
  consented: true;
  scrubbed: true;
  problem_clarity: number;
  empathy_quality: number;
  naturalness: number;
  question_efficiency: number;
  redundant_questions: number;
  user_correction_count: number;
  response_length_balance: number;
  premature_handoff: boolean;
  late_handoff: boolean;
  assessment_value: 'HIGH' | 'MEDIUM' | 'LOW' | null;
  summary_accuracy: number | null;
  main_problem: string;
  improvement_suggestion: string;
}

export interface MentorFeedbackInput {
  request_id: string;
  judgment_accuracy: 'ACCURATE' | 'PARTIAL' | 'INACCURATE';
  summary_helpfulness: 'HELPFUL' | 'NEUTRAL' | 'NOT_HELPFUL';
  handoff_timing: 'TOO_EARLY' | 'APPROPRIATE' | 'TOO_LATE';
  missed_core_problem: boolean;
  ai_could_continue: 'YES' | 'NO' | 'UNCERTAIN';
  tags: string[];
  note: string | null;
}

export interface LearningInsight {
  insight_id: string;
  created_at: string;
  scope: string;
  sample_size: number;
  observation: string;
  evidence: Record<string, number | string>;
  candidate_action: string;
  source: 'RULE' | 'REVIEWER' | 'MENTOR_FEEDBACK';
}

export interface CandidateRule {
  candidate_id: string;
  created_at: string;
  target: 'learnable_experience' | 'controlled_policy' | 'assessment_policy' | 'handoff_policy';
  current_rule: string;
  observed_problem: string;
  evidence: string;
  proposed_change: string;
  expected_effect: string;
  possible_risk: string;
  required_tests: string[];
  status: 'PENDING_HUMAN_REVIEW' | 'REJECTED' | 'APPROVED_FOR_GRAY' | 'RELEASED';
}

export interface LearningDashboard {
  generated_at: string;
  data_mode: 'CLOUDBASE' | 'LOCAL_FILE' | 'UNAVAILABLE';
  totals: {
    sessions: number;
    average_turn_count: number;
    average_question_count: number;
    repeated_question_rate: number;
    user_abandon_rate: number;
    handoff_rate: number;
    booking_click_rate: number;
    summary_edit_rate: number;
    assessment_completion_rate: number;
    reviewer_count: number;
    mentor_feedback_count: number;
  };
  recent_insights: LearningInsight[];
  candidate_rules: CandidateRule[];
  prompt_version: string;
}

export interface LearningStore {
  mode: 'CLOUDBASE' | 'LOCAL_FILE' | 'UNAVAILABLE';
  addEvent(event: LearningEventRecord): Promise<void>;
  saveMetrics(metrics: LearningEventRecord): Promise<void>;
  saveReview(review: ConversationReview): Promise<void>;
  saveMentorFeedback(feedback: MentorFeedbackInput & { created_at: string }): Promise<void>;
  listEvents(limit?: number): Promise<LearningEventRecord[]>;
  listReviews(limit?: number): Promise<ConversationReview[]>;
  listMentorFeedback(limit?: number): Promise<Array<MentorFeedbackInput & { created_at: string }>>;
  listInsights(limit?: number): Promise<LearningInsight[]>;
  saveInsight(insight: LearningInsight): Promise<void>;
  listCandidateRules(limit?: number): Promise<CandidateRule[]>;
  saveCandidateRule(rule: CandidateRule): Promise<void>;
  deleteBySession(sessionHash: string): Promise<number>;
}

const eventTypes = new Set<LearningEventType>([
  'chat_turn', 'booking_cta_shown', 'booking_clicked', 'summary_generated',
  'summary_edited', 'session_end', 'learning_consent_updated',
]);

const emptyMetrics = (): ConversationMetricsSnapshot => ({
  turn_count: 0,
  question_count: 0,
  consecutive_question_max: 0,
  problem_clarity_reached: false,
  assessment_recommended: false,
  assessment_completed: false,
  handoff: false,
  handoff_turn: null,
  booking_button_shown: false,
  booking_clicked: false,
  user_abandoned: false,
  user_correction_count: 0,
  summary_modified_ratio: null,
  average_response_length: 0,
  response_length_variance: 0,
  repeated_question_rate: 0,
  clarification_efficiency: null,
});

function boundedNumber(value: unknown, min = 0, max = 1_000) {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : min;
}

function boundedRatio(value: unknown) {
  return boundedNumber(value, 0, 1);
}

export function sanitizeMetrics(value: unknown): ConversationMetricsSnapshot {
  const input = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const metrics = emptyMetrics();
  metrics.turn_count = Math.round(boundedNumber(input.turn_count, 0, 200));
  metrics.question_count = Math.round(boundedNumber(input.question_count, 0, 200));
  metrics.consecutive_question_max = Math.round(boundedNumber(input.consecutive_question_max, 0, 20));
  metrics.problem_clarity_reached = input.problem_clarity_reached === true;
  metrics.assessment_recommended = input.assessment_recommended === true;
  metrics.assessment_completed = input.assessment_completed === true;
  metrics.handoff = input.handoff === true;
  metrics.handoff_turn = input.handoff_turn === null ? null : Math.round(boundedNumber(input.handoff_turn, 0, 200));
  metrics.booking_button_shown = input.booking_button_shown === true;
  metrics.booking_clicked = input.booking_clicked === true;
  metrics.user_abandoned = input.user_abandoned === true;
  metrics.user_correction_count = Math.round(boundedNumber(input.user_correction_count, 0, 100));
  metrics.summary_modified_ratio = input.summary_modified_ratio === null || input.summary_modified_ratio === undefined ? null : boundedRatio(input.summary_modified_ratio);
  metrics.average_response_length = Math.round(boundedNumber(input.average_response_length, 0, 4_000));
  metrics.response_length_variance = boundedNumber(input.response_length_variance, 0, 4_000_000);
  metrics.repeated_question_rate = boundedRatio(input.repeated_question_rate);
  metrics.clarification_efficiency = input.clarification_efficiency === null || input.clarification_efficiency === undefined ? null : boundedRatio(input.clarification_efficiency);
  return metrics;
}

function hashText(value: string) {
  let hash = 2_166_136_261;
  for (const character of value) {
    hash ^= character.codePointAt(0) || 0;
    hash = Math.imul(hash, 16_777_619);
  }
  return `anon_${(hash >>> 0).toString(16)}`;
}

export function anonymousSessionId(sessionId: string) {
  return hashText(sessionId.trim().slice(0, 160));
}

export function scrubText(value: string, maxLength = 2_000) {
  return value
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[邮箱]')
    .replace(/1[3-9]\d{9}/g, '[手机号]')
    .replace(/\b\d{17}[\dXx]\b/g, '[身份证号]')
    .replace(/(?:微信|wx|wechat)(?:号|号是|联系方式)?\s*[:：]?\s*[A-Za-z][-_A-Za-z0-9]{4,30}/gi, '[微信号]')
    .replace(/(?:地址|住在|住址)\s*[:：]?\s*[^，。！？\n]{2,80}/g, '[地址]')
    .slice(0, maxLength);
}

export function scrubMessages(messages: ChatMessage[]) {
  return messages.slice(-40).map((message) => ({
    role: message.role,
    content: scrubText(message.content, 1_000),
  })).filter((message) => message.content);
}

export function conversationForReview(messages: ChatMessage[]) {
  return scrubMessages(messages).map((message) => `${message.role === 'user' ? '用户' : 'AI'}：${message.content}`).join('\n').slice(-8_000);
}

export function makeLearningEvent(input: {
  eventId: string;
  eventType: unknown;
  sessionId: string;
  occurredAt?: string;
  metrics?: unknown;
  metadata?: unknown;
}): LearningEventRecord | null {
  if (!eventTypes.has(input.eventType as LearningEventType) || !input.sessionId.trim()) return null;
  const metadataInput = input.metadata && typeof input.metadata === 'object' ? input.metadata as Record<string, unknown> : {};
  const metadata: Record<string, string | number | boolean | null> = {};
  for (const [key, value] of Object.entries(metadataInput).slice(0, 20)) {
    if (typeof value === 'string') metadata[key.slice(0, 50)] = scrubText(value, 160);
    else if (typeof value === 'number' && Number.isFinite(value)) metadata[key.slice(0, 50)] = boundedNumber(value, -1_000_000, 1_000_000);
    else if (typeof value === 'boolean' || value === null) metadata[key.slice(0, 50)] = value;
  }
  return {
    event_id: scrubText(input.eventId, 120) || `event_${Date.now()}`,
    event_type: input.eventType as LearningEventType,
    session_hash: anonymousSessionId(input.sessionId),
    occurred_at: input.occurredAt && !Number.isNaN(Date.parse(input.occurredAt)) ? input.occurredAt : new Date().toISOString(),
    metrics: sanitizeMetrics(input.metrics),
    metadata,
  };
}

function clampScore(value: unknown) {
  return Number(boundedRatio(value).toFixed(2));
}

function cleanReviewText(value: unknown, fallback: string) {
  return scrubText(typeof value === 'string' ? value.trim() : fallback, 500) || fallback;
}

export function parseConversationReview(raw: string, sessionHash: string, reviewId = `review_${Date.now()}`): ConversationReview | null {
  const candidate = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  if (!candidate.startsWith('{')) return null;
  let value: Record<string, unknown>;
  try { value = JSON.parse(candidate) as Record<string, unknown>; } catch { return null; }
  return {
    review_id: reviewId,
    session_hash: sessionHash,
    created_at: new Date().toISOString(),
    consented: true,
    scrubbed: true,
    problem_clarity: clampScore(value.problem_clarity),
    empathy_quality: clampScore(value.empathy_quality),
    naturalness: clampScore(value.naturalness),
    question_efficiency: clampScore(value.question_efficiency),
    redundant_questions: Math.round(boundedNumber(value.redundant_questions, 0, 50)),
    user_correction_count: Math.round(boundedNumber(value.user_correction_count, 0, 50)),
    response_length_balance: clampScore(value.response_length_balance),
    premature_handoff: value.premature_handoff === true,
    late_handoff: value.late_handoff === true,
    assessment_value: value.assessment_value === 'HIGH' || value.assessment_value === 'MEDIUM' || value.assessment_value === 'LOW' ? value.assessment_value : null,
    summary_accuracy: value.summary_accuracy === null || value.summary_accuracy === undefined ? null : clampScore(value.summary_accuracy),
    main_problem: cleanReviewText(value.main_problem, '未识别到明确问题'),
    improvement_suggestion: cleanReviewText(value.improvement_suggestion, '继续观察用户反馈和提问效率'),
  };
}

export function reviewerPrompt(prompt: string, messages: ChatMessage[]) {
  return `${prompt}\n\n以下是已取得用户明确授权、并已完成基础脱敏的本次对话。只做复盘，不给用户回复，不提出诊断，不生成新的用户画像：\n${conversationForReview(messages)}`;
}

export function insightFromMetrics(events: LearningEventRecord[], promptVersion: string): { insight: LearningInsight; candidate: CandidateRule } | null {
  const sessionEnds = events.filter((event) => event.event_type === 'session_end');
  if (sessionEnds.length < 3) return null;
  const highQuestionSessions = sessionEnds.filter((event) => event.metrics.question_count >= 3 || event.metrics.consecutive_question_max >= 3);
  if (highQuestionSessions.length / sessionEnds.length < 0.5) return null;
  const createdAt = new Date().toISOString();
  const insight: LearningInsight = {
    insight_id: `insight_${Date.now()}`,
    created_at: createdAt,
    scope: 'conversation_efficiency',
    sample_size: sessionEnds.length,
    observation: '近期会话中，连续提问或提问数量偏高的比例较高，可能增加对话负担。',
    evidence: {
      sessions: sessionEnds.length,
      high_question_sessions: highQuestionSessions.length,
      high_question_rate: Number((highQuestionSessions.length / sessionEnds.length).toFixed(2)),
    },
    candidate_action: '优先镜像用户已说内容，达到最低充分判断后停止追问；先运行固定案例回归，不直接修改生产规则。',
    source: 'RULE',
  };
  const candidate: CandidateRule = {
    candidate_id: `candidate_${Date.now()}`,
    created_at: createdAt,
    target: 'learnable_experience',
    current_rule: `当前 Prompt 版本 ${promptVersion}：每轮最多推进一个主要问题。`,
    observed_problem: insight.observation,
    evidence: JSON.stringify(insight.evidence),
    proposed_change: insight.candidate_action,
    expected_effect: '降低连续追问和用户负担，提高问题效率。',
    possible_risk: '过早停止可能遗漏影响判断的关键信息，必须经过安全案例和黄金案例回归。',
    required_tests: ['T01 只想倾诉', 'T03 明确求建议', 'T07 直接预约', 'T12 即时危险', 'V1.4 最低充分判断'],
    status: 'PENDING_HUMAN_REVIEW',
  };
  return { insight, candidate };
}

export function dashboardFromRecords(input: {
  mode: LearningDashboard['data_mode'];
  events: LearningEventRecord[];
  reviews: ConversationReview[];
  feedback: Array<MentorFeedbackInput & { created_at: string }>;
  insights: LearningInsight[];
  candidates: CandidateRule[];
  promptVersion: string;
}): LearningDashboard {
  const sessions = input.events.filter((event) => event.event_type === 'session_end');
  const average = (values: number[]) => values.length ? Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(2)) : 0;
  const ratio = (values: boolean[]) => values.length ? Number((values.filter(Boolean).length / values.length).toFixed(2)) : 0;
  return {
    generated_at: new Date().toISOString(),
    data_mode: input.mode,
    totals: {
      sessions: sessions.length,
      average_turn_count: average(sessions.map((event) => event.metrics.turn_count)),
      average_question_count: average(sessions.map((event) => event.metrics.question_count)),
      repeated_question_rate: average(sessions.map((event) => event.metrics.repeated_question_rate)),
      user_abandon_rate: ratio(sessions.map((event) => event.metrics.user_abandoned)),
      handoff_rate: ratio(sessions.map((event) => event.metrics.handoff)),
      booking_click_rate: ratio(sessions.filter((event) => event.metrics.booking_button_shown).map((event) => event.metrics.booking_clicked)),
      summary_edit_rate: average(sessions.map((event) => event.metrics.summary_modified_ratio || 0)),
      assessment_completion_rate: ratio(sessions.filter((event) => event.metrics.assessment_recommended).map((event) => event.metrics.assessment_completed)),
      reviewer_count: input.reviews.length,
      mentor_feedback_count: input.feedback.length,
    },
    recent_insights: input.insights.slice(0, 10),
    candidate_rules: input.candidates.slice(0, 10),
    prompt_version: input.promptVersion,
  };
}

export function makeMentorFeedback(value: unknown): MentorFeedbackInput | null {
  if (!value || typeof value !== 'object') return null;
  const input = value as Record<string, unknown>;
  const accuracy = input.judgment_accuracy;
  const helpfulness = input.summary_helpfulness;
  const timing = input.handoff_timing;
  const couldContinue = input.ai_could_continue;
  if (!['ACCURATE', 'PARTIAL', 'INACCURATE'].includes(String(accuracy))) return null;
  if (!['HELPFUL', 'NEUTRAL', 'NOT_HELPFUL'].includes(String(helpfulness))) return null;
  if (!['TOO_EARLY', 'APPROPRIATE', 'TOO_LATE'].includes(String(timing))) return null;
  if (!['YES', 'NO', 'UNCERTAIN'].includes(String(couldContinue))) return null;
  const tags = Array.isArray(input.tags) ? input.tags.filter((tag): tag is string => typeof tag === 'string').map((tag) => scrubText(tag, 40)).slice(0, 8) : [];
  return {
    request_id: scrubText(typeof input.request_id === 'string' ? input.request_id : '', 100),
    judgment_accuracy: accuracy as MentorFeedbackInput['judgment_accuracy'],
    summary_helpfulness: helpfulness as MentorFeedbackInput['summary_helpfulness'],
    handoff_timing: timing as MentorFeedbackInput['handoff_timing'],
    missed_core_problem: input.missed_core_problem === true,
    ai_could_continue: couldContinue as MentorFeedbackInput['ai_could_continue'],
    tags,
    note: typeof input.note === 'string' && input.note.trim() ? scrubText(input.note, 500) : null,
  };
}
