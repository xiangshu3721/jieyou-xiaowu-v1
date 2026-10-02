import type {
  AssessmentRecommendation,
  BookingPreference,
  Complexity,
  ConversationMode,
  ConversationAnalysis,
  ConversationState,
  DepthLevel,
  HandoffMode,
  HumanIntentLevel,
  HumanHandoffState,
  ReplyLength,
  RoutingState,
  ResponseGoal,
  SeverityLevel,
  SafetyStatus,
  TopicCode,
  TriageRouting,
  UserIntent,
  ValueLevel,
} from '../src/shared.js';
import { analyzeConversation, emergencyReply, safetyClarificationReply } from './rules.js';

export interface ParsedAssistantOutput {
  analysis: Partial<ConversationAnalysis>;
  reply: string;
}

const legacyHumanServiceCopy = '将会有专门的导师好好倾听你的诉求，放心，预约是免费的。';
const humanServiceCopies = [
  '基于你刚才说的这些情况，事情可能有点复杂了。我想邀请你找一位合适的导师聊聊：预约是免费的，会有真人联系你，陪你把头绪慢慢理清，也一起看看怎样减轻眼下的压力。',
  '你已经为这件事撑了很久，不必再一个人扛着。你可以预约一次免费的真人沟通，之后会有导师联系你，认真听你说，陪你把困扰好好梳理一下。',
  '从你描述的情况看，继续自己消化可能会有些累。如果你愿意，可以预约免费的真人导师聊聊，ta 会陪你慢慢理清重点，找到更有力量的下一步。',
  '这件事牵动的地方不少，找一个真正的人一起梳理，可能会更轻松一些。你可以先预约，服务是免费的，之后会有真人导师联系你，希望能陪你分担一点压力。',
];

const conversationStates = new Set<ConversationState>(['LISTENING', 'EMOTIONAL_SUPPORT', 'EXPLORATION', 'PROBLEM_SOLVING', 'HUMAN_SERVICE', 'SAFETY_SUPPORT']);
const routingStates = new Set<RoutingState>(['AI_SELF_HELP', 'HUMAN_SUPPORT', 'PROFESSIONAL_REFERRAL', 'EMERGENCY_SUPPORT']);
const triageRoutings = new Set<TriageRouting>(['AI_SUPPORT', 'HUMAN_MENTOR', 'PROFESSIONAL_REFERRAL', 'SAFETY_SUPPORT']);
const safetyStatuses = new Set<SafetyStatus>(['NO_SIGNAL_DETECTED', 'NEEDS_CLARIFICATION', 'URGENT']);
const topicCodes = new Set<TopicCode>(['EMOTION', 'CAREER', 'MONEY', 'INTIMACY', 'FAMILY', 'PARENTING', 'SELF_KNOWLEDGE', 'INTERPERSONAL', 'BODY_LIFE', 'OTHER']);
const userIntents = new Set<UserIntent>(['VENTING', 'WANTS_COMFORT', 'WANTS_CLARITY', 'WANTS_ACTION', 'WANTS_HUMAN', 'WANTS_END', 'UNKNOWN']);
const bookingPreferences = new Set<BookingPreference>(['NOT_EXPRESSED', 'INTERESTED', 'ACCEPTED', 'DECLINED']);
const complexities = new Set<Complexity>(['LIGHT', 'MODERATE', 'COMPLEX', 'HIGH_RISK']);
const depthLevels = new Set<DepthLevel>(['D0', 'D1', 'D2', 'D3']);
const conversationModes = new Set<ConversationMode>(['LISTEN', 'CLARIFY', 'MIRROR', 'ASSESS', 'HELP', 'ASSESSMENT', 'HANDOFF']);
const responseGoals = new Set<ResponseGoal>(['LISTEN', 'CLARIFY', 'MIRROR', 'ASSESS', 'HELP', 'ASSESSMENT', 'HANDOFF']);
const replyLengths = new Set<ReplyLength>(['SHORT', 'MEDIUM', 'LONG']);
const handoffStates = new Set<HumanHandoffState>(['NOT_READY', 'READY', 'OFFERED', 'ACCEPTED', 'DECLINED']);
const severityLevels = new Set<SeverityLevel>(['LOW', 'MODERATE', 'MODERATE_HIGH', 'HIGH', 'UNKNOWN']);
const handoffModes = new Set<HandoffMode>(['NONE', 'DIRECT_HANDOFF', 'QUICK_HANDOFF']);
const humanIntentLevels = new Set<HumanIntentLevel>(['EXPLICIT', 'NOT_EXPLICIT', 'DECLINED']);
const valueLevels = new Set<ValueLevel>(['HIGH', 'MEDIUM', 'LOW']);

function textList(value: unknown, maxItems = 5, maxLength = 220) {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string').map((item) => item.trim().slice(0, maxLength)).filter(Boolean).slice(0, maxItems);
}

function optionalText(value: unknown, maxLength = 500) {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, maxLength) : null;
}

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function handoffCopyFor(analysis?: ConversationAnalysis) {
  if (!analysis) return humanServiceCopies[0];
  const seed = [
    analysis.current_issue_id,
    analysis.user_turn_count,
    analysis.primary_topic,
    analysis.problem_map.main_issue,
    analysis.problem_map.scene_summary,
  ].filter(Boolean).join('|');
  const score = Array.from(seed).reduce((sum, character) => sum + character.charCodeAt(0), 0);
  return humanServiceCopies[score % humanServiceCopies.length];
}

function replaceHandoffCopies(reply: string, analysis?: ConversationAnalysis) {
  const selectedCopy = handoffCopyFor(analysis);
  const knownCopies = [legacyHumanServiceCopy, ...humanServiceCopies]
    .map(escapeRegex)
    .join('|');
  let keptCopy = false;
  return reply.replace(new RegExp(knownCopies, 'g'), () => {
    if (keptCopy) return '';
    keptCopy = true;
    return selectedCopy;
  });
}

function jsonCandidate(raw: string) {
  const trimmed = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  if (!trimmed.startsWith('{')) return null;
  try { return JSON.parse(trimmed) as Record<string, unknown>; } catch { return null; }
}

function legacyRouting(routing: TriageRouting): RoutingState {
  if (routing === 'HUMAN_MENTOR') return 'HUMAN_SUPPORT';
  if (routing === 'PROFESSIONAL_REFERRAL') return 'PROFESSIONAL_REFERRAL';
  if (routing === 'SAFETY_SUPPORT') return 'EMERGENCY_SUPPORT';
  return 'AI_SELF_HELP';
}

function triageRouting(routing: RoutingState): TriageRouting {
  if (routing === 'HUMAN_SUPPORT') return 'HUMAN_MENTOR';
  if (routing === 'PROFESSIONAL_REFERRAL') return 'PROFESSIONAL_REFERRAL';
  if (routing === 'EMERGENCY_SUPPORT') return 'SAFETY_SUPPORT';
  return 'AI_SUPPORT';
}

function parseAssessment(value: unknown): AssessmentRecommendation | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const item = value as Record<string, unknown>;
  if (typeof item.needed !== 'boolean') return undefined;
  return {
    needed: item.needed,
    recommended_tool: optionalText(item.recommended_tool, 120),
    reason: optionalText(item.reason, 300),
  };
}

export function parseAssistantOutput(raw: string): ParsedAssistantOutput | null {
  const value = jsonCandidate(raw);
  if (!value || typeof value.assistant_reply !== 'string' || !value.assistant_reply.trim()) return null;
  const analysis: Partial<ConversationAnalysis> = {};
  if (conversationStates.has(value.conversation_state as ConversationState)) analysis.conversation_state = value.conversation_state as ConversationState;
  if (topicCodes.has(value.primary_topic as TopicCode)) analysis.primary_topic = value.primary_topic as TopicCode;
  const secondaryTopics = textList(value.secondary_topics).filter((item): item is TopicCode => topicCodes.has(item as TopicCode));
  if (secondaryTopics.length) analysis.secondary_topics = secondaryTopics;
  if (userIntents.has(value.user_intent as UserIntent)) analysis.user_intent = value.user_intent as UserIntent;
  if (routingStates.has(value.routing_state as RoutingState)) analysis.routing_state = value.routing_state as RoutingState;
  if (triageRoutings.has(value.routing as TriageRouting)) {
    analysis.routing = value.routing as TriageRouting;
    analysis.routing_state = legacyRouting(value.routing as TriageRouting);
  } else if (analysis.routing_state) {
    analysis.routing = triageRouting(analysis.routing_state);
  }
  if (bookingPreferences.has(value.booking_preference as BookingPreference)) analysis.booking_preference = value.booking_preference as BookingPreference;
  if (safetyStatuses.has(value.safety_status as SafetyStatus)) analysis.safety_status = value.safety_status as SafetyStatus;
  if (complexities.has(value.complexity as Complexity)) analysis.complexity = value.complexity as Complexity;
  if (depthLevels.has(value.depth_level as DepthLevel)) analysis.depth_level = value.depth_level as DepthLevel;
  if (typeof value.diagnostic_sufficiency === 'number' && Number.isFinite(value.diagnostic_sufficiency)) analysis.diagnostic_sufficiency = Math.max(0, Math.min(1, value.diagnostic_sufficiency));
  if (conversationModes.has(value.conversation_mode as ConversationMode)) analysis.conversation_mode = value.conversation_mode as ConversationMode;
  if (responseGoals.has(value.response_goal as ResponseGoal)) analysis.response_goal = value.response_goal as ResponseGoal;
  if (typeof value.problem_clarity === 'number' && Number.isFinite(value.problem_clarity)) analysis.problem_clarity = Math.max(0, Math.min(1, value.problem_clarity));
  if (severityLevels.has(value.severity_level as SeverityLevel)) analysis.severity_level = value.severity_level as SeverityLevel;
  if (typeof value.ai_help_value === 'number' && Number.isFinite(value.ai_help_value)) analysis.ai_help_value = Math.max(0, Math.min(1, value.ai_help_value));
  if (typeof value.human_help_value === 'number' && Number.isFinite(value.human_help_value)) analysis.human_help_value = Math.max(0, Math.min(1, value.human_help_value));
  if (handoffStates.has(value.handoff_state as HumanHandoffState)) analysis.handoff_state = value.handoff_state as HumanHandoffState;
  if (handoffModes.has(value.handoff_mode as HandoffMode)) analysis.handoff_mode = value.handoff_mode as HandoffMode;
  if (typeof value.minimum_sufficient_judgment === 'boolean') analysis.minimum_sufficient_judgment = value.minimum_sufficient_judgment;
  if (humanIntentLevels.has(value.human_intent as HumanIntentLevel)) analysis.human_intent = value.human_intent as HumanIntentLevel;
  if (typeof value.ai_can_help_now === 'boolean') analysis.ai_can_help_now = value.ai_can_help_now;
  if (valueLevels.has(value.ai_further_value as ValueLevel)) analysis.ai_further_value = value.ai_further_value as ValueLevel;
  if (valueLevels.has(value.human_help_level as ValueLevel)) analysis.human_help_level = value.human_help_level as ValueLevel;
  if (replyLengths.has(value.reply_length as ReplyLength)) analysis.reply_length = value.reply_length as ReplyLength;
  if (typeof value.ask_question === 'boolean') analysis.ask_question = value.ask_question;
  if (typeof value.no_more_questions === 'boolean') analysis.no_more_questions = value.no_more_questions;
  if (typeof value.show_booking_button === 'boolean') analysis.show_booking_button = value.show_booking_button;
  if (typeof value.booking_button_text === 'string') analysis.booking_button_text = value.booking_button_text.trim().slice(0, 80) || null;
  if (typeof value.booking_summary_ready === 'boolean') analysis.booking_summary_ready = value.booking_summary_ready;
  if (typeof value.handoff_ready === 'boolean') analysis.handoff_ready = value.handoff_ready;
  analysis.information_gaps = textList(value.information_gaps, 6, 160);
  analysis.next_question = optionalText(value.next_question, 240);
  const assessment = parseAssessment(value.assessment);
  if (assessment) analysis.assessment = assessment;
  analysis.confirmed_facts = textList(value.confirmed_facts);
  analysis.tentative_hypotheses = textList(value.tentative_hypotheses);
  analysis.support_provided = textList(value.support_provided);
  analysis.confirmed_goal = optionalText(value.confirmed_goal);
  analysis.support_feedback = optionalText(value.support_feedback);
  analysis.routing_reason = optionalText(value.routing_reason, 300) || undefined;
  analysis.reply_strategy = optionalText(value.reply_strategy, 300) || undefined;
  return { analysis, reply: value.assistant_reply.trim().slice(0, 4_000) };
}

export function naturalReply(raw: string) {
  const trimmed = raw.trim();
  if (!trimmed || trimmed.startsWith('{') || trimmed.startsWith('[') || /^```/i.test(trimmed)) return null;
  if (/["'](?:conversation_state|assistant_reply|routing_state|routing|safety_status)["']\s*:/.test(trimmed)) return null;
  return trimmed.slice(0, 4_000);
}

export function normalizeUserReply(reply: string, analysis?: ConversationAnalysis) {
  if (analysis && !analysis.show_booking_button && analysis.user_intent !== 'WANTS_HUMAN' && /真人|导师|预约|人工|分配/.test(reply)) {
    return fallbackReply(analysis);
  }
  if (analysis?.show_booking_button && !analysis.ask_question && /[？?]/.test(reply)) {
    return fallbackReply(analysis);
  }
  let normalized = reply.replace(/提交后由运营人员在飞书(?:里|中)人工分配导师(?:并)?联系你[。！？!?]?/g, handoffCopyFor(analysis));
  normalized = replaceHandoffCopies(normalized, analysis);
  if (analysis?.show_booking_button && !analysis.ask_question && !/预约.{0,12}免费|真人导师.{0,12}联系|免费预约真人聊聊/.test(normalized)) {
    const trimmed = normalized.trim().replace(/[。！？!?]+$/g, '');
    normalized = `${trimmed}${trimmed ? '。' : ''}${handoffCopyFor(analysis)}`;
  }
  return normalized
    .replace(/([。！？!?])\s*[。！？!?]+/g, '$1')
    .replace(/([。！？!?])\s*[，、；：,;:]/g, '$1');
}

export function mergeAnalysis(baseline: ConversationAnalysis, parsed: ParsedAssistantOutput | null): ConversationAnalysis {
  const model = parsed?.analysis || {};
  const safetyStatus: SafetyStatus = baseline.safety_status === 'URGENT' || model.safety_status === 'URGENT'
    ? 'URGENT'
    : baseline.safety_status === 'NEEDS_CLARIFICATION' || model.safety_status === 'NEEDS_CLARIFICATION'
      ? 'NEEDS_CLARIFICATION'
      : 'NO_SIGNAL_DETECTED';
  const routing: TriageRouting = safetyStatus !== 'NO_SIGNAL_DETECTED' ? 'SAFETY_SUPPORT' : baseline.routing;
  const routingState = legacyRouting(routing);
  const conversationState: ConversationState = safetyStatus !== 'NO_SIGNAL_DETECTED'
    ? 'SAFETY_SUPPORT'
    : routing === 'HUMAN_MENTOR'
      ? 'HUMAN_SERVICE'
      : model.conversation_state && conversationStates.has(model.conversation_state) ? model.conversation_state : baseline.conversation_state;
  const primaryTopic = model.primary_topic && topicCodes.has(model.primary_topic) ? model.primary_topic : baseline.primary_topic;
  const secondaryTopics = Array.from(new Set([...(model.secondary_topics || []), ...baseline.secondary_topics])).filter((topic) => topic !== primaryTopic && topicCodes.has(topic));
  // 用户意愿是业务控制字段，只接受服务端规则判断；模型不能把普通表达升级成真人意愿。
  const userIntent = baseline.user_intent;
  const reasons = Array.from(new Set([...(baseline.reasons || []), model.routing_reason].filter((reason): reason is string => Boolean(reason))));
  return {
    ...baseline,
    conversation_state: conversationState,
    primary_topic: primaryTopic,
    secondary_topics: secondaryTopics,
    user_intent: userIntent,
    routing,
    routing_state: routingState,
    safety_status: safetyStatus,
    safety: safetyStatus === 'URGENT' ? 'urgent' : safetyStatus === 'NEEDS_CLARIFICATION' ? 'clarify' : 'normal',
    route: routingState === 'HUMAN_SUPPORT' ? 'human' : routingState === 'PROFESSIONAL_REFERRAL' ? 'professional' : routingState === 'EMERGENCY_SUPPORT' ? 'safety' : 'self_help',
    confirmed_facts: baseline.confirmed_facts,
    confirmed_goal: baseline.confirmed_goal,
    tentative_hypotheses: textList(model.tentative_hypotheses).length ? textList(model.tentative_hypotheses) : baseline.tentative_hypotheses,
    support_provided: textList(model.support_provided).length ? textList(model.support_provided) : baseline.support_provided,
    support_feedback: baseline.support_feedback || model.support_feedback || null,
    routing_reason: reasons.join('；') || baseline.routing_reason,
    reply_strategy: optionalText(model.reply_strategy, 300) || baseline.reply_strategy,
  };
}

export function fallbackReply(analysis: ConversationAnalysis) {
  if (analysis.safety_status === 'URGENT') return emergencyReply;
  if (analysis.safety_status === 'NEEDS_CLARIFICATION') return safetyClarificationReply;
  if (analysis.routing === 'HUMAN_MENTOR' && analysis.show_booking_button) {
    return handoffCopyFor(analysis);
  }
  if (analysis.routing === 'PROFESSIONAL_REFERRAL') return '这件事可能需要合格的专业人员进一步评估和支持。我可以先帮你把当前困扰整理清楚，但不会替代医疗、心理、法律或金融专业意见。';
  if (analysis.assessment.needed && analysis.assessment.recommended_tool) return `你描述的情况涉及几个方面，继续逐个追问可能会比较累。如果你愿意，可以先做${analysis.assessment.recommended_tool}，它只作为辅助了解，不是诊断。`;
  if (analysis.conversation_state === 'EMOTIONAL_SUPPORT') return '我先陪你把这段经历说清楚，不急着给建议。现在最让你难受、最希望被听见的部分是哪一件？';
  if (!analysis.ask_question && analysis.reply_length === 'SHORT') return '我先接住你刚才说的这部分，不急着把它解释清楚。我们可以先从眼前最影响你的地方慢慢看。';
  if (analysis.information_gaps.length && analysis.next_question) return `我先听你把刚才说的接住。为了判断下一步更适合怎么帮你，我只想确认一件事：${analysis.next_question}`;
  if (analysis.complexity === 'LIGHT') return '你现在描述的问题比较具体，我们可以先从一个最小、现实可行的动作开始，再看看它对你有没有帮助。';
  return '我先把目前的情况做个阶段性整理，再和你一起看一个更适合眼下的下一步。';
}

export function createFallbackAnalysis(latestText: string, contextText = '') {
  return analyzeConversation(latestText, contextText);
}
