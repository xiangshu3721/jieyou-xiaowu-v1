import type { ChatMessage, ConversationAnalysis, ConversationControlIntent, HumanHandoffState, IssueAction, IssueLifecycle, IssueStatus, TopicCode } from '../src/shared.js';
import { classifyConcern, detectIssueSwitch } from './rules.js';

export interface IssueRequestContext {
  issue_id: string;
  status: IssueStatus;
  topic_tags: TopicCode[];
  handoff_offered: boolean;
  handoff_state: HumanHandoffState;
  booking_case_id: string | null;
}

export interface IssueResolution {
  control_intent: ConversationControlIntent;
  issue_action: IssueAction;
  current_issue_id: string;
  previous_issue_id: string | null;
  new_issue_detected: boolean;
  new_issue_confidence: number;
  awaiting_topic: boolean;
}

const issueStatuses = new Set<IssueStatus>(['ACTIVE', 'HANDOFF_OFFERED', 'BOOKING_SUBMITTED', 'PAUSED', 'AWAITING_TOPIC', 'CLOSED']);
const topicCodes = new Set<TopicCode>(['EMOTION', 'CAREER', 'MONEY', 'INTIMACY', 'FAMILY', 'PARENTING', 'SELF_KNOWLEDGE', 'INTERPERSONAL', 'BODY_LIFE', 'OTHER']);

const topicSwitchPatterns = [
  /换个话题/, /聊点别的/, /这个先不聊/, /先不聊这个/, /这个先不说/, /先说别的/, /换一个问题/, /以后再说/, /还有另一个烦恼/, /还有个别的问题/, /我还有另外一个/, /我想说另外一件事/,
];
const continueTopicPatterns = [/继续聊这个/, /接着刚才/, /回到刚才/, /再聊回/, /刚才那个问题/];
const acceptHandoffPatterns = [/(?:想|希望|需要|我要|帮我).{0,8}(?:找真人|真人聊|预约真人|找导师|导师聊)/, /(?:预约|找).{0,8}(?:真人|导师|老师)/];
const closeTopicPatterns = [/先这样/, /我先不聊了/, /不用了谢谢/, /再见/, /晚安/, /结束对话/];
const declineHandoffPatterns = [/不找真人了/, /不需要真人/, /不用预约/, /还是跟你聊/, /先不预约/, /不用了[，,。！! ]*(?:还是|继续)/, /^算了[。！! ]*$/, /^不用了[。！! ]*$/];

export function createIssueId() {
  return globalThis.crypto?.randomUUID?.() || `issue-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
}

export function parseIssueContext(value: unknown, fallbackId = 'issue-current'): IssueRequestContext {
  const item = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const issueId = typeof item.issue_id === 'string' && item.issue_id.trim() ? item.issue_id.trim().slice(0, 120) : fallbackId;
  const status = issueStatuses.has(item.status as IssueStatus) ? item.status as IssueStatus : 'ACTIVE';
  const topics = Array.isArray(item.topic_tags)
    ? item.topic_tags.filter((topic): topic is TopicCode => typeof topic === 'string' && topicCodes.has(topic as TopicCode)).slice(0, 10)
    : [];
  return {
    issue_id: issueId,
    status,
    topic_tags: topics,
    handoff_offered: item.handoff_offered === true || status === 'HANDOFF_OFFERED' || status === 'BOOKING_SUBMITTED',
    handoff_state: item.handoff_state === 'DECLINED' || item.handoff_state === 'ACCEPTED' || item.handoff_state === 'OFFERED' || item.handoff_state === 'READY' ? item.handoff_state : status === 'BOOKING_SUBMITTED' ? 'ACCEPTED' : status === 'HANDOFF_OFFERED' || item.handoff_offered === true ? 'OFFERED' : 'NOT_READY',
    booking_case_id: typeof item.booking_case_id === 'string' && item.booking_case_id.trim() ? item.booking_case_id.trim().slice(0, 120) : null,
  };
}

export function detectConversationControl(text: string, handoffOffered = false): ConversationControlIntent {
  const latest = text.trim();
  if (topicSwitchPatterns.some((pattern) => pattern.test(latest))) return 'SWITCH_TOPIC';
  if (handoffOffered && declineHandoffPatterns.some((pattern) => pattern.test(latest))) return 'DECLINE_HANDOFF';
  if (acceptHandoffPatterns.some((pattern) => pattern.test(latest))) return 'ACCEPT_HANDOFF';
  if (continueTopicPatterns.some((pattern) => pattern.test(latest))) return 'CONTINUE_CURRENT_TOPIC';
  if (closeTopicPatterns.some((pattern) => pattern.test(latest))) return 'CLOSE_TOPIC';
  return 'GENERAL_CHAT';
}

function containsNewConcern(text: string) {
  const topics = classifyConcern(text);
  return topics.some((topic) => topic !== 'OTHER') || /新的?困扰|新的?问题|烦恼|压力|焦虑|失眠|工作|关系|感情|父母|孩子|伴侣|对象/.test(text);
}

export function resolveCurrentIssue(input: {
  message: string;
  currentIssueId: string;
  currentIssue: IssueRequestContext;
  previousMessages?: ChatMessage[];
  previousTopics?: TopicCode[];
  safetyDetected?: boolean;
}): IssueResolution {
  const control = input.safetyDetected ? 'GENERAL_CHAT' as const : detectConversationControl(input.message, input.currentIssue.handoff_offered);
  const previousText = userContextText(input.previousMessages || []);
  if (input.safetyDetected) {
    return {
      control_intent: 'GENERAL_CHAT',
      issue_action: 'CONTINUE_CURRENT',
      current_issue_id: input.currentIssueId,
      previous_issue_id: null,
      new_issue_detected: false,
      new_issue_confidence: 0,
      awaiting_topic: false,
    };
  }
  if (control === 'SWITCH_TOPIC') {
    const newIssue = containsNewConcern(input.message);
    return {
      control_intent: newIssue ? 'NEW_ISSUE' : 'SWITCH_TOPIC',
      issue_action: 'CREATE_NEW',
      current_issue_id: createIssueId(),
      previous_issue_id: input.currentIssueId,
      new_issue_detected: true,
      new_issue_confidence: 0.99,
      awaiting_topic: !newIssue,
    };
  }
  if (control === 'CONTINUE_CURRENT_TOPIC' || control === 'DECLINE_HANDOFF' || control === 'ACCEPT_HANDOFF' || control === 'CLOSE_TOPIC') {
    return {
      control_intent: control,
      issue_action: 'CONTINUE_CURRENT',
      current_issue_id: input.currentIssueId,
      previous_issue_id: null,
      new_issue_detected: false,
      new_issue_confidence: 0,
      awaiting_topic: false,
    };
  }
  const switchResult = detectIssueSwitch(input.message, previousText, input.previousTopics || input.currentIssue.topic_tags);
  if (switchResult.detected) {
    return {
      control_intent: 'NEW_ISSUE',
      issue_action: 'CREATE_NEW',
      current_issue_id: createIssueId(),
      previous_issue_id: input.currentIssueId,
      new_issue_detected: true,
      new_issue_confidence: switchResult.confidence,
      awaiting_topic: false,
    };
  }
  return {
    control_intent: control,
    issue_action: 'CONTINUE_CURRENT',
    current_issue_id: input.currentIssueId,
    previous_issue_id: null,
    new_issue_detected: false,
    new_issue_confidence: switchResult.confidence,
    awaiting_topic: false,
  };
}

export function annotateAnalysis(analysis: ConversationAnalysis, resolution: IssueResolution): ConversationAnalysis {
  return {
    ...analysis,
    control_intent: resolution.control_intent,
    issue_action: resolution.issue_action,
    previous_issue_id: resolution.previous_issue_id,
  };
}

export function applyDeclinedHandoff(analysis: ConversationAnalysis): ConversationAnalysis {
  return {
    ...analysis,
    routing: 'AI_SUPPORT',
    routing_state: 'AI_SELF_HELP',
    route: 'self_help',
    conversation_state: 'LISTENING',
    user_intent: 'UNKNOWN',
    human_intent: 'DECLINED',
    handoff_state: 'DECLINED',
    handoff_mode: 'NONE',
    handoff_ready: false,
    show_booking_button: false,
    booking_button_text: null,
    booking_summary_ready: false,
    issue_status: 'ACTIVE',
    booking_preference: 'DECLINED',
    handoff_offered: true,
    ai_can_help_now: true,
  };
}

export function messagesForIssue(messages: ChatMessage[], issueId: string) {
  const tagged = messages.filter((message) => message.issueId);
  if (!tagged.length) return messages;
  return messages.filter((message) => message.issueId === issueId);
}

export function userMessagesForIssue(messages: ChatMessage[], issueId: string) {
  return messagesForIssue(messages, issueId).filter((message) => message.role === 'user');
}

export function userContextText(messages: ChatMessage[]) {
  return messages.filter((message) => message.role === 'user').map((message) => `用户：${message.content}`).join('\n').slice(-18_000);
}

export function issueLifecycleFromAnalysis(analysis: { current_issue_id: string; issue_status: IssueStatus; problem_map: { main_issue: string | null }; tags: TopicCode[]; user_turn_count: number; problem_clarity: number; minimum_sufficient_judgment: boolean; handoff_ready: boolean; handoff_offered: boolean; handoff_state: HumanHandoffState }, previous?: IssueLifecycle): IssueLifecycle {
  return {
    issue_id: analysis.current_issue_id,
    status: analysis.issue_status,
    started_at: previous?.started_at || new Date().toISOString(),
    main_issue: analysis.problem_map.main_issue,
    topic_tags: analysis.tags,
    user_turn_count: analysis.user_turn_count,
    problem_clarity: analysis.problem_clarity,
    minimum_sufficient_judgment: analysis.minimum_sufficient_judgment,
    handoff_ready: analysis.handoff_ready,
    handoff_offered: analysis.handoff_offered,
    handoff_state: analysis.handoff_state,
    booking_case_id: previous?.booking_case_id || null,
    booking_submitted_at: previous?.booking_submitted_at || null,
  };
}
