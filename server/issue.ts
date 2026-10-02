import type { ChatMessage, IssueLifecycle, IssueStatus, TopicCode } from '../src/shared.js';

export interface IssueRequestContext {
  issue_id: string;
  status: IssueStatus;
  topic_tags: TopicCode[];
  handoff_offered: boolean;
  booking_case_id: string | null;
}

const issueStatuses = new Set<IssueStatus>(['ACTIVE', 'HANDOFF_OFFERED', 'BOOKING_SUBMITTED', 'CLOSED']);
const topicCodes = new Set<TopicCode>(['EMOTION', 'CAREER', 'MONEY', 'INTIMACY', 'FAMILY', 'PARENTING', 'SELF_KNOWLEDGE', 'INTERPERSONAL', 'BODY_LIFE', 'OTHER']);

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
    booking_case_id: typeof item.booking_case_id === 'string' && item.booking_case_id.trim() ? item.booking_case_id.trim().slice(0, 120) : null,
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

export function issueLifecycleFromAnalysis(analysis: { current_issue_id: string; issue_status: IssueStatus; problem_map: { main_issue: string | null }; tags: TopicCode[]; user_turn_count: number; problem_clarity: number; minimum_sufficient_judgment: boolean; handoff_ready: boolean; handoff_offered: boolean }, previous?: IssueLifecycle): IssueLifecycle {
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
    booking_case_id: previous?.booking_case_id || null,
    booking_submitted_at: previous?.booking_submitted_at || null,
  };
}
