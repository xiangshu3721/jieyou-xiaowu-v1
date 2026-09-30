export type MessageRole = 'user' | 'assistant';

export type ConversationState =
  | 'LISTENING'
  | 'EMOTIONAL_SUPPORT'
  | 'EXPLORATION'
  | 'PROBLEM_SOLVING'
  | 'HUMAN_SERVICE'
  | 'SAFETY_SUPPORT';

export type TopicCode =
  | 'EMOTION'
  | 'CAREER'
  | 'MONEY'
  | 'INTIMACY'
  | 'FAMILY'
  | 'PARENTING'
  | 'SELF_KNOWLEDGE'
  | 'INTERPERSONAL'
  | 'BODY_LIFE'
  | 'OTHER';

export type UserIntent =
  | 'VENTING'
  | 'WANTS_COMFORT'
  | 'WANTS_CLARITY'
  | 'WANTS_ACTION'
  | 'WANTS_HUMAN'
  | 'WANTS_END'
  | 'UNKNOWN';

export type RoutingState =
  | 'AI_SELF_HELP'
  | 'HUMAN_SUPPORT'
  | 'PROFESSIONAL_REFERRAL'
  | 'EMERGENCY_SUPPORT';

export type BookingPreference = 'NOT_EXPRESSED' | 'INTERESTED' | 'ACCEPTED' | 'DECLINED';
export type SafetyStatus = 'NO_SIGNAL_DETECTED' | 'NEEDS_CLARIFICATION' | 'URGENT';

export interface ChatMessage {
  role: MessageRole;
  content: string;
}

export interface ConversationAnalysis {
  conversation_state: ConversationState;
  primary_topic: TopicCode;
  secondary_topics: TopicCode[];
  user_intent: UserIntent;
  confirmed_facts: string[];
  confirmed_goal: string | null;
  tentative_hypotheses: string[];
  support_provided: string[];
  support_feedback: string | null;
  routing_state: RoutingState;
  booking_preference: BookingPreference;
  safety_status: SafetyStatus;
  routing_reason: string;
  reply_strategy: string;

  /** 兼容旧调试页和已有测试的简化字段。新逻辑以结构化字段为准。 */
  tags: TopicCode[];
  route: 'self_help' | 'human' | 'professional' | 'safety';
  safety: 'normal' | 'clarify' | 'urgent';
  reasons: string[];
}

export interface ChatResponse {
  reply: string;
  analysis: ConversationAnalysis;
  promptVersion: string;
  model: string;
}

export interface AppointmentInput {
  requestId: string;
  nickname: string;
  contact: string;
  concern: string;
  desiredHelp: string;
  consent: boolean;
}

export interface AppointmentStatus {
  requestId: string;
  status: 'processing' | 'submitted' | 'failed' | 'assigned' | 'contacted' | 'received' | 'cancelled' | 'unreachable' | 'professional_referral';
  recordId?: string;
  assignedMentor?: string;
  result?: string;
  note?: string;
  updatedAt: string;
}
