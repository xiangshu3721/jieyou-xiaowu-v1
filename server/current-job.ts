import { classifyConcern } from './rules.js';
import type {
  BookingPreference,
  ConversationControlIntent,
  CurrentJob,
  CurrentJobConfidence,
  CurrentJobEvidence,
  CurrentJobShadow,
  HumanIntentLevel,
  IssueStatus,
  SafetyStatus,
  TopicCode,
  TriageRouting,
  UserIntent,
} from '../src/shared.js';

/**
 * JTBD-01「当前用户任务识别」影子分类器（影子模式，绝不改变对话行为）。
 *
 * 设计约束（见 Issue #64）：
 * - 只读取已有结构化信号，不新增 DeepSeek 调用、模型或数据库。
 * - 复用 `analyzeConversation` 已产出的 user_intent / routing / safety_status /
 *   human_intent / booking_preference / control_intent，以及 Issue 上下文，不重新
 *   堆叠关键词去硬化用户意图。
 * - 真人交接、专业/安全分流不归入五类，保持 `UNDETERMINED`，只记录证据与原因。
 * - 证据不足、表达矛盾或用户任务本身不明确时，一律 `UNDETERMINED`，允许保持不确定。
 * - 最新轮意愿优先：传入的 `userIntent` 已由 `resolveConversationIntent` 做过
 *   “最新覆盖旧判断”，因此这里直接以它为主信号，避免串线到旧 Issue。
 */

export interface CurrentJobInput {
  /** 由 resolveConversationIntent 产出的最新轮用户意愿（已做最新覆盖旧判断）。 */
  userIntent: UserIntent;
  controlIntent?: ConversationControlIntent;
  routing: TriageRouting;
  safetyStatus: SafetyStatus;
  humanIntent: HumanIntentLevel;
  bookingPreference: BookingPreference;
  issueStatus: IssueStatus;
  /** 最新轮用户消息原文，用于引用与“实质性表达”判断。 */
  latestUserMessage: string;
  /** 最近若干轮用户消息，仅用于解释与保守兜底，不参与硬化意图。 */
  recentUserMessages?: string[];
  primaryTopic?: TopicCode;
}

const QUOTE_LIMIT = 36;

function quote(text: string): string | undefined {
  const trimmed = text.trim().replace(/\s+/g, ' ');
  if (!trimmed) return undefined;
  return trimmed.length > QUOTE_LIMIT ? `${trimmed.slice(0, QUOTE_LIMIT)}…` : trimmed;
}

function evidence(signal: string, value: string, latestUserMessage: string): CurrentJobEvidence {
  const item: CurrentJobEvidence = { signal, value };
  const q = quote(latestUserMessage);
  if (q) item.quote = q;
  return item;
}

/**
 * 一条消息是否有“实质性表达”：能归类出真实主题，或包含一段像样的句子。
 * 当前仅用于记录 `disclosure` 证据，**不再**据此把被动情绪表达判定为 EXPRESS；
 * 只有用户明确选择倾诉（WANTS_COMFORT）才记为 EXPRESS。
 */
function hasSubstantiveDisclosure(latestUserMessage: string): boolean {
  if (classifyConcern(latestUserMessage).some((topic) => topic !== 'OTHER')) return true;
  return latestUserMessage.trim().length >= 12;
}

function shadow(
  current_job: CurrentJob,
  confidence: CurrentJobConfidence,
  evidence: CurrentJobEvidence[],
  notes?: string[],
): CurrentJobShadow {
  const result: CurrentJobShadow = { current_job, confidence, evidence };
  if (notes?.length) result.notes = notes;
  return result;
}

/**
 * 计算 `current_job` 影子分类。纯函数、确定性：相同输入永远得到相同输出，
 * 不依赖时间、随机或外部状态，便于固定案例回归。
 */
export function classifyCurrentJob(input: CurrentJobInput): CurrentJobShadow {
  const latest = input.latestUserMessage || '';
  const {
    userIntent, controlIntent, routing, safetyStatus, humanIntent,
    bookingPreference, issueStatus,
  } = input;

  // 1) 安全优先：安全分流不属于 JTBD 五类，保持 UNDETERMINED。
  if (safetyStatus !== 'NO_SIGNAL_DETECTED' || routing === 'SAFETY_SUPPORT') {
    return shadow('UNDETERMINED', 'HIGH', [
      evidence('safety_status', safetyStatus, latest),
      evidence('routing', routing, latest),
    ], ['安全分流不属于 JTBD 五类，保持 UNDETERMINED。']);
  }

  // 2) 真人预约/交接（含系统建议的 QUICK_HANDOFF）：不归入五类，保持 UNDETERMINED。
  //    仅“考虑真人”的疑问（human_intent 非 EXPLICIT、booking 非 ACCEPTED、
  //    control 非 ACCEPT_HANDOFF 且 routing 非 HUMAN_MENTOR）才会落到下面的意图分支。
  if (humanIntent === 'EXPLICIT' || bookingPreference === 'ACCEPTED' || controlIntent === 'ACCEPT_HANDOFF' || routing === 'HUMAN_MENTOR') {
    return shadow('UNDETERMINED', 'HIGH', [
      evidence('human_intent', humanIntent, latest),
      evidence('booking_preference', bookingPreference, latest),
      evidence('control_intent', controlIntent || 'GENERAL_CHAT', latest),
      evidence('routing', routing, latest),
    ], ['真人预约/交接（含系统建议的 QUICK_HANDOFF）在 JTBD 五类之外，保持 UNDETERMINED。']);
  }

  // 3) 专业边界（医疗/法律/用药等）：需要合格专业人士，不归入五类。
  if (routing === 'PROFESSIONAL_REFERRAL') {
    return shadow('UNDETERMINED', 'HIGH', [
      evidence('routing', routing, latest),
      evidence('user_intent', userIntent, latest),
    ], ['专业边界需求不属于 JTBD 五类，保持 UNDETERMINED。']);
  }

  // 4) 切换/新建话题但用户尚未说明新任务：保持不确定，绝不沿用旧 Issue 的任务。
  if (issueStatus === 'AWAITING_TOPIC' || controlIntent === 'SWITCH_TOPIC') {
    return shadow('UNDETERMINED', 'MEDIUM', [
      evidence('issue_status', issueStatus, latest),
      evidence('control_intent', controlIntent || 'GENERAL_CHAT', latest),
    ], ['用户正在切换或新建话题，新任务尚未明确，保持 UNDETERMINED。']);
  }

  // 5) 安定/结束：WANTS_END 已要求明确结束语，不能把一般疲惫当作结束命令。
  if (userIntent === 'WANTS_END' || controlIntent === 'CLOSE_TOPIC') {
    return shadow('SETTLE', 'HIGH', [
      evidence('user_intent', userIntent, latest),
      evidence('control_intent', controlIntent || 'GENERAL_CHAT', latest),
    ]);
  }

  // 6) 理清/探索/理解。
  if (userIntent === 'WANTS_CLARITY') {
    return shadow('UNDERSTAND', 'HIGH', [
      evidence('user_intent', userIntent, latest),
    ]);
  }

  // 7) 具体建议、下一步或行动。
  if (userIntent === 'WANTS_ACTION') {
    return shadow('ACT', 'HIGH', [
      evidence('user_intent', userIntent, latest),
    ]);
  }

  // 8) 明确希望表达/倾诉、被倾听。
  if (userIntent === 'WANTS_COMFORT') {
    return shadow('EXPRESS', 'HIGH', [
      evidence('user_intent', userIntent, latest),
    ]);
  }

  // 9) 被动情绪流露不等于用户雇用 AI 来倾诉。任务不明确时保持 UNDETERMINED，
  //    仅记录 disclosure 证据；只有明确的 WANTS_COMFORT（如“我想说说”“先听我说”
  //    “不用给建议”）才在前面步骤记为 EXPRESS。“消息很长”不能成为确定任务的理由。
  if (userIntent === 'VENTING') {
    return shadow('UNDETERMINED', 'LOW', [
      evidence('user_intent', userIntent, latest),
      evidence('disclosure', hasSubstantiveDisclosure(latest) ? 'substantive' : 'insufficient', latest),
    ], ['被动情绪表达不等于用户雇用 AI 来倾诉；任务不明确时保持 UNDETERMINED。']);
  }

  // 10) 未知或矛盾：保持不确定。
  return shadow('UNDETERMINED', 'LOW', [
    evidence('user_intent', userIntent, latest),
  ]);
}

/**
 * 便捷封装：从完整的 `ConversationAnalysis` 影子化 `current_job`。
 * 仅做字段读取，绝不修改传入对象，也不回写任何控制字段。
 */
export function currentJobShadowFromAnalysis(analysis: {
  user_intent: UserIntent;
  control_intent?: ConversationControlIntent;
  routing: TriageRouting;
  safety_status: SafetyStatus;
  human_intent: HumanIntentLevel;
  booking_preference: BookingPreference;
  issue_status: IssueStatus;
  primary_topic?: TopicCode;
}, latestUserMessage: string, recentUserMessages?: string[]): CurrentJobShadow {
  return classifyCurrentJob({
    userIntent: analysis.user_intent,
    controlIntent: analysis.control_intent,
    routing: analysis.routing,
    safetyStatus: analysis.safety_status,
    humanIntent: analysis.human_intent,
    bookingPreference: analysis.booking_preference,
    issueStatus: analysis.issue_status,
    latestUserMessage,
    recentUserMessages,
    primaryTopic: analysis.primary_topic,
  });
}
