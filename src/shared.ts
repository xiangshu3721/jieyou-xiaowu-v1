/** Mentioning a human mentor, discussing options, and consenting to book
 * are different acts. Keep one conservative decision shared by UI and server. */
export type HumanHelpDecision = 'DECLINED' | 'CONSIDERING' | 'EXPLICIT' | 'NONE';

export function humanHelpDecision(textInput: string): HumanHelpDecision {
  const text = textInput.trim();
  if (!/(?:真人|人工|导师|老师|咨询师|心理咨询|专业的人|找人聊|找个人聊|和人聊|一对一|1\s*v\s*1|预约|咨询服务)/i.test(text)) return 'NONE';

  // Negation and corrections must win over a quoted positive phrase such as
  // “不是真的要找真人” or “不要我一提到真人就跳转”.
  if (/(?:不想|不愿意|不需要|先不|不用|拒绝|不打算).{0,12}(?:找真人|预约|真人|人工|导师|老师|咨询师)/.test(text)
    || /(?:不是|并不是|并非|不是真的|没有).{0,9}(?:想|要|需要|决定).{0,10}(?:找真人|预约|找导师|找咨询师|找老师)/.test(text)
    || /(?:不要|别).{0,18}(?:提到真人|提起真人|真人.{0,8}(?:跳转|推荐|预约)|跳转|导流|推(?:荐|销)真人)/.test(text)
    || /(?:我只是|只是|仅仅).{0,8}(?:问你|问一下|询问).{0,15}(?:真人|预约|咨询师)/.test(text)) {
    return 'DECLINED';
  }

  // Being curious whether a human would help is not an appointment request.
  if (/要不要|该不该|需不需要|应不应该|是否|是不是|会不会|有没有必要|有必要吗|有用吗|有帮助吗|更方便|更合适|适不适合|合不合适|合适吗|值不值得|拿不准|可以吗|行不行|不确定|只是问|我(?:是)?问你|想知道|想了解|了解一下|能不能|有没有|可不可以|[？?]/.test(text)) {
    return 'CONSIDERING';
  }

  // Only an unambiguous *affirmative request* authorizes booking. AI being
  // unhelpful, a service existing, or the word “找真人” alone do not.
  if (/(?:^|[，,。！!；;\s])(?:(?:我(?:现在|现在就|真的|确实|已经|就)?|请|麻烦)?(?:想|希望|需要|决定|确定|我要|要|准备|打算|现在就|马上|直接|帮我|请帮我|给我)).{0,12}(?:找(?:个|位)?真人|真人聊|真人导师|预约(?:真人|导师|咨询师)?|约(?:个|位)?真人|找(?:个|位)?(?:导师|老师|咨询师)|一对一|1\s*v\s*1)/i.test(text)
    || /(?:^|[，,。！!；;\s])(?:我想|我希望|我需要|我决定|我确定|帮我|请帮我|我要).{0,10}(?:找个人聊|找人聊|和真人聊|和人聊)/.test(text)) {
    return 'EXPLICIT';
  }
  return 'NONE';
}

export function isHumanHandoffDecline(text: string) {
  return humanHelpDecision(text) === 'DECLINED';
}

export function isUndecidedHumanHelpQuestion(text: string) {
  return humanHelpDecision(text) === 'CONSIDERING';
}

/** Only explicit user consent can bypass chat and open the booking page. */
export function wantsHumanBooking(text: string) {
  return humanHelpDecision(text) === 'EXPLICIT';
}

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
export type IssueAction = 'CREATE_NEW' | 'CONTINUE_CURRENT' | 'RESUME_PREVIOUS';

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
  /** Canonical one-turn assistant text used for history, summaries and metrics. */
  reply: string;
  /** Optional presentation-only bubbles. Their joined text is always `reply`. */
  reply_parts?: string[];
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
  issueId?: string;
  bookingCaseId?: string;
  sourceEnvironment?: string;
}

export function hasRequiredAppointmentFields(input: AppointmentInput) {
  return Boolean(input.requestId && input.nickname && input.contact && input.concern && input.consent);
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

/** V1.9「最近的我」只保存经过整理的成长事件，不保存完整聊天记录。 */
export type GrowthPeriod = '30d' | '90d';
export type GrowthEventCategory = 'THEME' | 'CHANGE' | 'PATTERN' | 'STRENGTH' | 'NEXT_STEP';
export type GrowthCardKey = 'MAIN_THEME' | 'CHANGE' | 'PATTERN' | 'STRENGTH' | 'NEXT_FOCUS';

export interface GrowthEvent {
  event_id: string;
  growth_id: string;
  created_at: string;
  observed_at: string;
  issue_id: string | null;
  category: GrowthEventCategory;
  topic: TopicCode | 'OTHER';
  title: string;
  summary: string;
  user_words: string | null;
  evidence: string[];
  change_direction: 'IMPROVING' | 'STABLE' | 'FLUCTUATING' | 'NEEDS_SUPPORT' | 'UNKNOWN';
  strength: string | null;
  next_step: string | null;
  impact: 'LOW' | 'MEDIUM' | 'HIGH';
  stable_key: string;
  seen_count: number;
  last_seen_at: string;
}

export interface GrowthInsightCard {
  key: GrowthCardKey;
  title: string;
  content: string;
  evidence_event_ids: string[];
  confidence: 'LOW' | 'MEDIUM' | 'HIGH';
}

export interface GrowthSnapshot {
  snapshot_id: string;
  growth_id: string;
  period: GrowthPeriod;
  generated_at: string;
  event_ids: string[];
  cards: GrowthInsightCard[];
  watch_recommendation: string | null;
  feedback?: 'ACCURATE' | 'INACCURATE' | null;
}

export interface GrowthWatchItem {
  watch_id: string;
  growth_id: string;
  created_at: string;
  expires_at: string;
  title: string;
  description: string;
  source_snapshot_id: string | null;
  status: 'ACTIVE' | 'COMPLETED' | 'EXPIRED';
}

export interface GrowthFeedback {
  feedback_id: string;
  growth_id: string;
  snapshot_id: string;
  card_key: GrowthCardKey | null;
  feedback: 'ACCURATE' | 'INACCURATE';
  created_at: string;
}
