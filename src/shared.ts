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

export type TriageRouting = 'AI_SUPPORT' | 'HUMAN_MENTOR' | 'PROFESSIONAL_REFERRAL' | 'SAFETY_SUPPORT';
export type Complexity = 'LIGHT' | 'MODERATE' | 'COMPLEX' | 'HIGH_RISK';
export type DepthLevel = 'D0' | 'D1' | 'D2' | 'D3';
export type ConversationMode = 'LISTEN' | 'CLARIFY' | 'MIRROR' | 'ASSESS' | 'HELP' | 'ASSESSMENT' | 'HANDOFF';
export type ResponseGoal = ConversationMode;
export type ReplyLength = 'SHORT' | 'MEDIUM' | 'LONG';
export type HumanHandoffState = 'NOT_READY' | 'READY' | 'OFFERED' | 'ACCEPTED' | 'DECLINED';
export type SeverityLevel = 'LOW' | 'MODERATE' | 'MODERATE_HIGH' | 'HIGH' | 'UNKNOWN';
export type HandoffMode = 'NONE' | 'DIRECT_HANDOFF' | 'QUICK_HANDOFF';
export type HumanIntentLevel = 'EXPLICIT' | 'NOT_EXPLICIT' | 'DECLINED';
export type ValueLevel = 'HIGH' | 'MEDIUM' | 'LOW';
export type IssueStatus = 'ACTIVE' | 'HANDOFF_OFFERED' | 'BOOKING_SUBMITTED' | 'PAUSED' | 'AWAITING_TOPIC' | 'CLOSED';
export type ConversationControlIntent = 'SWITCH_TOPIC' | 'CONTINUE_CURRENT_TOPIC' | 'DECLINE_HANDOFF' | 'ACCEPT_HANDOFF' | 'NEW_ISSUE' | 'CLOSE_TOPIC' | 'GENERAL_CHAT';
export type IssueAction = 'CREATE_NEW' | 'CONTINUE_CURRENT';

export interface ProblemMap {
  main_issue: string | null;
  issue_types: TopicCode[];
  scene_summary: string | null;
  onset_duration: string | null;
  frequency: string | null;
  severity_score: number | null;
  functional_impacts: string[];
  known_triggers: string[];
  attempts: string[];
  user_goal: string | null;
}

export interface AssessmentRecommendation {
  needed: boolean;
  recommended_tool: string | null;
  reason: string | null;
}

export type BookingPreference = 'NOT_EXPRESSED' | 'INTERESTED' | 'ACCEPTED' | 'DECLINED';
export type SafetyStatus = 'NO_SIGNAL_DETECTED' | 'NEEDS_CLARIFICATION' | 'URGENT';
export type FactField = 'main_issue' | 'scene' | 'severity_score' | 'duration' | 'frequency' | 'functional_impact' | 'trigger' | 'attempts' | 'user_goal';
export type FactSource = 'user_explicit' | 'user_confirmed';
export type FactValue = string | number | boolean | string[];
export type DialogueStrategy =
  | 'LISTEN'
  | 'MIRROR'
  | 'EMPATHIZE'
  | 'CLARIFY_FACT'
  | 'QUANTIFY'
  | 'CLARIFY_GOAL'
  | 'REFRAME'
  | 'PROVIDE_HELP'
  | 'NORMALIZE'
  | 'ASSESSMENT'
  | 'SUMMARIZE'
  | 'HANDOFF'
  | 'CONTINUE';

export interface KnownFact {
  value: FactValue;
  source: FactSource;
  confidence: number;
}

export interface AskedQuestion {
  field: FactField;
  semantic_key: string;
  question: string;
  answered: boolean;
}

export interface ChatMessage {
  role: MessageRole;
  content: string;
  id?: string;
  issueId?: string;
  createdAt?: string;
}

export interface IssueLifecycle {
  issue_id: string;
  status: IssueStatus;
  started_at: string;
  main_issue: string | null;
  topic_tags: TopicCode[];
  user_turn_count: number;
  problem_clarity: number;
  minimum_sufficient_judgment: boolean;
  handoff_ready: boolean;
  handoff_offered: boolean;
  handoff_state: HumanHandoffState;
  booking_case_id: string | null;
  booking_submitted_at: string | null;
}

export interface BookingCaseSnapshot {
  booking_case_id: string;
  issue_id: string;
  booking_summary: string;
  nickname: string;
  contact: string;
  help_wanted: string;
  submitted_at: string;
  feishu_record_id: string | null;
}

export interface ConversationAnalysis {
  /** V1.2 导诊内部状态：由服务端规则基线生成，模型只能补充自然语言。 */
  problem_map: ProblemMap;
  information_gaps: string[];
  assessment: AssessmentRecommendation;
  complexity: Complexity;
  diagnostic_sufficiency: number;
  routing: TriageRouting;
  depth_level: DepthLevel;
  next_question: string | null;

  /** V1.3 自然对话与真人交接控制字段；均由服务端基线裁决。 */
  conversation_mode: ConversationMode;
  response_goal: ResponseGoal;
  problem_clarity: number;
  severity_level: SeverityLevel;
  ai_help_value: number;
  human_help_value: number;
  handoff_state: HumanHandoffState;
  handoff_mode: HandoffMode;
  minimum_sufficient_judgment: boolean;
  human_intent: HumanIntentLevel;
  ai_can_help_now: boolean;
  ai_further_value: ValueLevel;
  human_help_level: ValueLevel;
  reply_length: ReplyLength;
  ask_question: boolean;
  no_more_questions: boolean;
  show_booking_button: boolean;
  booking_button_text: string | null;
  booking_summary_ready: boolean;
  handoff_ready: boolean;

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

  /** V1.6 当前 Issue 生命周期控制；不等同于整段浏览器会话。 */
  current_issue_id: string;
  new_issue_detected: boolean;
  new_issue_confidence: number;
  user_turn_count: number;
  issue_status: IssueStatus;
  handoff_offered: boolean;
  control_intent?: ConversationControlIntent;
  issue_action?: IssueAction;
  previous_issue_id?: string | null;

  /** V1.7 当前 Issue 的事实记忆与提问质量控制字段。 */
  known_facts: Partial<Record<FactField, KnownFact>>;
  asked_fields: FactField[];
  unresolved_fields: FactField[];
  asked_questions: AskedQuestion[];
  primary_response_strategy: DialogueStrategy;
  question_value: number;
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
