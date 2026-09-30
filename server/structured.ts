import type { ConversationAnalysis, ConversationState, RoutingState, SafetyStatus, TopicCode, UserIntent, BookingPreference } from '../src/shared.js';
import { analyzeConversation, emergencyReply, safetyClarificationReply } from './rules.js';

export interface ParsedAssistantOutput {
  analysis: Partial<ConversationAnalysis>;
  reply: string;
}

const humanServiceCopy = '将会有专门的导师好好倾听你的诉求，放心，预约是免费的。';

const conversationStates = new Set<ConversationState>(['LISTENING', 'EMOTIONAL_SUPPORT', 'EXPLORATION', 'PROBLEM_SOLVING', 'HUMAN_SERVICE', 'SAFETY_SUPPORT']);
const routingStates = new Set<RoutingState>(['AI_SELF_HELP', 'HUMAN_SUPPORT', 'PROFESSIONAL_REFERRAL', 'EMERGENCY_SUPPORT']);
const safetyStatuses = new Set<SafetyStatus>(['NO_SIGNAL_DETECTED', 'NEEDS_CLARIFICATION', 'URGENT']);
const topicCodes = new Set<TopicCode>(['EMOTION', 'CAREER', 'MONEY', 'INTIMACY', 'FAMILY', 'PARENTING', 'SELF_KNOWLEDGE', 'INTERPERSONAL', 'BODY_LIFE', 'OTHER']);
const userIntents = new Set<UserIntent>(['VENTING', 'WANTS_COMFORT', 'WANTS_CLARITY', 'WANTS_ACTION', 'WANTS_HUMAN', 'WANTS_END', 'UNKNOWN']);
const bookingPreferences = new Set<BookingPreference>(['NOT_EXPRESSED', 'INTERESTED', 'ACCEPTED', 'DECLINED']);

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
  if (bookingPreferences.has(value.booking_preference as BookingPreference)) analysis.booking_preference = value.booking_preference as BookingPreference;
  if (safetyStatuses.has(value.safety_status as SafetyStatus)) analysis.safety_status = value.safety_status as SafetyStatus;
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
  if (/["'](?:conversation_state|assistant_reply|routing_state|safety_status)["']\s*:/.test(trimmed)) return null;
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

function legacyRoute(routingState: RoutingState): ConversationAnalysis['route'] {
  if (routingState === 'HUMAN_SUPPORT') return 'human';
  if (routingState === 'PROFESSIONAL_REFERRAL') return 'professional';
  if (routingState === 'EMERGENCY_SUPPORT') return 'safety';
  return 'self_help';
}

function legacySafety(safetyStatus: SafetyStatus): ConversationAnalysis['safety'] {
  if (safetyStatus === 'URGENT') return 'urgent';
  if (safetyStatus === 'NEEDS_CLARIFICATION') return 'clarify';
  return 'normal';
}

export function mergeAnalysis(baseline: ConversationAnalysis, parsed: ParsedAssistantOutput | null): ConversationAnalysis {
  const model = parsed?.analysis || {};
  const safetyStatus: SafetyStatus = baseline.safety_status === 'URGENT' || model.safety_status === 'URGENT'
    ? 'URGENT'
    : baseline.safety_status === 'NEEDS_CLARIFICATION' || model.safety_status === 'NEEDS_CLARIFICATION'
      ? 'NEEDS_CLARIFICATION'
      : 'NO_SIGNAL_DETECTED';
  const routingState: RoutingState = safetyStatus !== 'NO_SIGNAL_DETECTED'
    ? 'EMERGENCY_SUPPORT'
    : baseline.routing_state !== 'AI_SELF_HELP'
      ? baseline.routing_state
      : (model.routing_state && routingStates.has(model.routing_state) ? model.routing_state : baseline.routing_state);
  const conversationState: ConversationState = safetyStatus !== 'NO_SIGNAL_DETECTED'
    ? 'SAFETY_SUPPORT'
    : baseline.routing_state === 'HUMAN_SUPPORT'
      ? 'HUMAN_SERVICE'
      : (model.conversation_state && conversationStates.has(model.conversation_state) ? model.conversation_state : baseline.conversation_state);
  const primaryTopic = model.primary_topic && topicCodes.has(model.primary_topic) ? model.primary_topic : baseline.primary_topic;
  const secondaryTopics = Array.from(new Set([...(model.secondary_topics || []), ...baseline.secondary_topics])).filter((topic) => topic !== primaryTopic && topicCodes.has(topic));
  const userIntent = baseline.user_intent !== 'VENTING' ? baseline.user_intent : (model.user_intent && userIntents.has(model.user_intent) ? model.user_intent : baseline.user_intent);
  const bookingPreference = baseline.booking_preference !== 'NOT_EXPRESSED' ? baseline.booking_preference : (model.booking_preference && bookingPreferences.has(model.booking_preference) ? model.booking_preference : baseline.booking_preference);
  const reasons = Array.from(new Set([...(baseline.reasons || []), model.routing_reason].filter((reason): reason is string => Boolean(reason))));
  return {
    ...baseline,
    ...model,
    conversation_state: conversationState,
    primary_topic: primaryTopic,
    secondary_topics: secondaryTopics,
    user_intent: userIntent,
    routing_state: routingState,
    booking_preference: bookingPreference,
    safety_status: safetyStatus,
    routing_reason: reasons.join('；') || baseline.routing_reason,
    route: legacyRoute(routingState),
    safety: legacySafety(safetyStatus),
    reasons,
  };
}

export function fallbackReply(analysis: ConversationAnalysis) {
  if (analysis.safety_status === 'URGENT') return emergencyReply;
  if (analysis.safety_status === 'NEEDS_CLARIFICATION') return safetyClarificationReply;
  if (analysis.routing_state === 'HUMAN_SUPPORT') return `${humanServiceCopy} 你可以点击页面上的“预约真人导师聊聊（免费）→”，填写并确认这次想获得的帮助。`;
  if (analysis.routing_state === 'PROFESSIONAL_REFERRAL') return '这件事可能需要合格的专业人员进一步评估和支持。我可以先帮你把当前困扰整理清楚，但不会替代医疗、心理、法律或金融专业意见。';
  if (analysis.conversation_state === 'EMOTIONAL_SUPPORT') return '我先陪你把这段经历说清楚，不急着给建议。现在最让你难受、最希望被听见的部分是哪一件？';
  if (analysis.conversation_state === 'PROBLEM_SOLVING') return '我们可以先把想解决的事情缩小到一个具体场景，再一起看现实条件下最可行的下一步。';
  return '我在听。你可以先从最近发生的那件事说起，不需要一次把所有内容讲完整。';
}

export function createFallbackAnalysis(latestText: string, contextText = '') {
  return analyzeConversation(latestText, contextText);
}
