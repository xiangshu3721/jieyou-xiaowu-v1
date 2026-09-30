import type {
  AssessmentRecommendation,
  BookingPreference,
  Complexity,
  ConversationAnalysis,
  ConversationState,
  DepthLevel,
  RoutingState,
  SafetyStatus,
  TopicCode,
  TriageRouting,
  UserIntent,
} from '../src/shared.js';
import { analyzeConversation, emergencyReply, safetyClarificationReply } from './rules.js';

export interface ParsedAssistantOutput {
  analysis: Partial<ConversationAnalysis>;
  reply: string;
}

const humanServiceCopy = '将会有专门的导师好好倾听你的诉求，放心，预约是免费的。';

const conversationStates = new Set<ConversationState>(['LISTENING', 'EMOTIONAL_SUPPORT', 'EXPLORATION', 'PROBLEM_SOLVING', 'HUMAN_SERVICE', 'SAFETY_SUPPORT']);
const routingStates = new Set<RoutingState>(['AI_SELF_HELP', 'HUMAN_SUPPORT', 'PROFESSIONAL_REFERRAL', 'EMERGENCY_SUPPORT']);
const triageRoutings = new Set<TriageRouting>(['AI_SUPPORT', 'HUMAN_MENTOR', 'PROFESSIONAL_REFERRAL', 'SAFETY_SUPPORT']);
const safetyStatuses = new Set<SafetyStatus>(['NO_SIGNAL_DETECTED', 'NEEDS_CLARIFICATION', 'URGENT']);
const topicCodes = new Set<TopicCode>(['EMOTION', 'CAREER', 'MONEY', 'INTIMACY', 'FAMILY', 'PARENTING', 'SELF_KNOWLEDGE', 'INTERPERSONAL', 'BODY_LIFE', 'OTHER']);
const userIntents = new Set<UserIntent>(['VENTING', 'WANTS_COMFORT', 'WANTS_CLARITY', 'WANTS_ACTION', 'WANTS_HUMAN', 'WANTS_END', 'UNKNOWN']);
const bookingPreferences = new Set<BookingPreference>(['NOT_EXPRESSED', 'INTERESTED', 'ACCEPTED', 'DECLINED']);
const complexities = new Set<Complexity>(['LIGHT', 'MODERATE', 'COMPLEX', 'HIGH_RISK']);
const depthLevels = new Set<DepthLevel>(['D0', 'D1', 'D2', 'D3']);

function textList(value: unknown, maxItems = 5, maxLength = 220) {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string').map((item) => item.trim().slice(0, maxLength)).filter(Boolean).slice(0, maxItems);
}

function optionalText(value: unknown, maxLength = 500) {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, maxLength) : null;
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

export function normalizeUserReply(reply: string) {
  const replaced = reply.replace(/提交后由运营人员在飞书(?:里|中)人工分配导师(?:并)?联系你[。！？!?]?/g, humanServiceCopy);
  let keptCopy = false;
  return replaced
    .replace(new RegExp(humanServiceCopy.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), () => {
      if (keptCopy) return '';
      keptCopy = true;
      return humanServiceCopy;
    })
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
  const userIntent = baseline.user_intent !== 'VENTING' ? baseline.user_intent : (model.user_intent && userIntents.has(model.user_intent) ? model.user_intent : baseline.user_intent);
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
  if (analysis.routing === 'HUMAN_MENTOR') return `${humanServiceCopy} 你可以点击页面上的“预约真人导师聊聊（免费）→”，填写并确认这次想获得的帮助。`;
  if (analysis.routing === 'PROFESSIONAL_REFERRAL') return '这件事可能需要合格的专业人员进一步评估和支持。我可以先帮你把当前困扰整理清楚，但不会替代医疗、心理、法律或金融专业意见。';
  if (analysis.assessment.needed && analysis.assessment.recommended_tool) return `你描述的情况涉及几个方面，继续逐个追问可能会比较累。如果你愿意，可以先做${analysis.assessment.recommended_tool}，它只作为辅助了解，不是诊断。`;
  if (analysis.conversation_state === 'EMOTIONAL_SUPPORT') return '我先陪你把这段经历说清楚，不急着给建议。现在最让你难受、最希望被听见的部分是哪一件？';
  if (analysis.information_gaps.length && analysis.next_question) return `我先把你刚才说的接住。为了判断下一步更适合怎么帮你，我只想确认一件事：${analysis.next_question}`;
  if (analysis.complexity === 'LIGHT') return '你现在描述的问题比较具体，我们可以先从一个最小、现实可行的动作开始，再看看它对你有没有帮助。';
  return '我先把目前的情况做个阶段性整理，再和你一起看下一步更适合继续自己梳理，还是找真人支持。';
}

export function createFallbackAnalysis(latestText: string, contextText = '') {
  return analyzeConversation(latestText, contextText);
}
