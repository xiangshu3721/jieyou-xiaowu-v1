import type {
  BookingPreference,
  ConversationAnalysis,
  ConversationState,
  RoutingState,
  SafetyStatus,
  TopicCode,
  UserIntent,
} from '../src/shared.js';

const topicRules: Array<[TopicCode, string[]]> = [
  ['EMOTION', ['焦虑', '内耗', '孤独', '压力', '低落', '崩溃', '疲惫', '情绪', '睡不着', '失眠', '委屈']],
  ['CAREER', ['工作', '职场', '职业', '求职', '转型', '创业', '事业', '同事', '领导', '辞职', '项目']],
  ['MONEY', ['收入', '钱', '金钱', '财务', '债务', '房贷', '消费', '赚钱', '经济压力']],
  ['INTIMACY', ['恋爱', '伴侣', '对象', '婚姻', '结婚', '分手', '暧昧', '亲密关系']],
  ['FAMILY', ['父母', '爸爸', '妈妈', '家人', '家庭', '原生家庭', '童年', '家暴', '边界']],
  ['PARENTING', ['孩子', '亲子', '教育', '育儿', '女儿', '儿子', '上学', '养育']],
  ['SELF_KNOWLEDGE', ['自我', '成长', '价值感', '意义', '认识自己', '自我怀疑']],
  ['INTERPERSONAL', ['朋友', '人际', '同事关系', '社交', '沟通']],
  ['BODY_LIFE', ['身体', '健康', '睡眠', '吃饭', '生活状态']],
];

const immediateDangerPatterns = [
  /现在(?:就)?(?:要|想)?(?:自杀|轻生|结束生命|伤害自己|割腕|跳楼)/,
  /(?:正在|已经开始|马上会|准备|计划|打算).{0,8}(?:自杀|轻生|结束生命|伤害自己|自残|割腕|跳楼)/,
  /(?:正在|马上|已经).{0,8}(?:杀人|伤害别人|弄死他|暴力伤人)/,
  /(?:正在被打|马上会被伤害|有人拿刀|有人要伤害我)/,
];

const possibleDangerPatterns = [
  /不想活|活不下去|轻生|自杀|结束生命|伤害自己|自残|割腕|跳楼/,
  /杀了他|杀人|伤害别人|弄死他|暴力伤人/,
  /家暴|人身安全|被威胁|可能会被伤害/,
];

const professionalPatterns = [/心理咨询/, /心理治疗/, /精神科/, /药物/, /诊断/, /法律/, /律师/, /严重债务/, /医疗/, /持续失眠/, /影响日常功能/];
const humanPatterns = [/真人/, /人工/, /导师/, /预约/, /深入聊/, /持续支持/, /想.{0,6}找人聊/, /找个人陪我聊/];
const declineHumanPatterns = [/不需要真人/, /不用预约/, /不想预约/, /先不用找人/, /不想找真人/];
const endPatterns = [/先这样/, /我先不聊了/, /不用了谢谢/, /再见/, /晚安/, /结束对话/];

export const topicLabels: Record<TopicCode, string> = {
  EMOTION: '情绪与心力',
  CAREER: '职业与事业',
  MONEY: '财富与金钱关系',
  INTIMACY: '亲密关系',
  FAMILY: '原生家庭',
  PARENTING: '亲子关系',
  SELF_KNOWLEDGE: '自我认知',
  INTERPERSONAL: '人际关系',
  BODY_LIFE: '身体与生活状态',
  OTHER: '其他',
};

export function classifyConcern(text: string): TopicCode[] {
  const tags = topicRules.filter(([, words]) => words.some((word) => text.includes(word))).map(([tag]) => tag);
  return tags.length ? tags : ['OTHER'];
}

export function detectSafety(text: string): SafetyStatus {
  if (immediateDangerPatterns.some((pattern) => pattern.test(text))) return 'URGENT';
  if (/(?:没有|不会|不想|并没有).{0,8}(?:自杀|轻生|结束生命|伤害自己|自残|伤害别人)/.test(text)) return 'NO_SIGNAL_DETECTED';
  if (possibleDangerPatterns.some((pattern) => pattern.test(text))) return 'NEEDS_CLARIFICATION';
  return 'NO_SIGNAL_DETECTED';
}

function detectIntent(text: string): UserIntent {
  if (endPatterns.some((pattern) => pattern.test(text))) return 'WANTS_END';
  if (humanPatterns.some((pattern) => pattern.test(text)) && !declineHumanPatterns.some((pattern) => pattern.test(text))) return 'WANTS_HUMAN';
  if (/别给我建议|不想听建议|只想倾诉|先听我说|陪我一会|不用分析/.test(text)) return 'WANTS_COMFORT';
  if (/理清|弄清|分析|为什么|到底|看不明白|梳理|帮我理/.test(text)) return 'WANTS_CLARITY';
  if (/怎么办|怎么做|建议|方案|下一步|行动|该不该|要不要/.test(text)) return 'WANTS_ACTION';
  return 'VENTING';
}

function routeFor(safety: SafetyStatus, text: string, intent: UserIntent): RoutingState {
  if (safety !== 'NO_SIGNAL_DETECTED') return 'EMERGENCY_SUPPORT';
  if (professionalPatterns.some((pattern) => pattern.test(text))) return 'PROFESSIONAL_REFERRAL';
  if (intent === 'WANTS_HUMAN') return 'HUMAN_SUPPORT';
  return 'AI_SELF_HELP';
}

export function routeConcern(text: string, safety: SafetyStatus): RoutingState {
  return routeFor(safety, text, detectIntent(text));
}

function stateFor(safety: SafetyStatus, route: RoutingState, intent: UserIntent): ConversationState {
  if (safety !== 'NO_SIGNAL_DETECTED') return 'SAFETY_SUPPORT';
  if (route === 'HUMAN_SUPPORT') return 'HUMAN_SERVICE';
  if (intent === 'WANTS_COMFORT') return 'EMOTIONAL_SUPPORT';
  if (intent === 'WANTS_CLARITY') return 'EXPLORATION';
  if (intent === 'WANTS_ACTION') return 'PROBLEM_SOLVING';
  return 'LISTENING';
}

function legacyRoute(route: RoutingState): ConversationAnalysis['route'] {
  if (route === 'HUMAN_SUPPORT') return 'human';
  if (route === 'PROFESSIONAL_REFERRAL') return 'professional';
  if (route === 'EMERGENCY_SUPPORT') return 'safety';
  return 'self_help';
}

function strategyFor(route: RoutingState, intent: UserIntent): string {
  if (route === 'EMERGENCY_SUPPORT') return '先确认现实安全并提供当地紧急求助方向，暂停普通建议与商业推荐';
  if (route === 'PROFESSIONAL_REFERRAL') return '说明能力边界，给出合适的专业求助方向，不把 AI 结论当作诊断';
  if (route === 'HUMAN_SUPPORT') return '直接说明免费真人服务和预约入口，不要求用户先完成完整探索';
  if (intent === 'WANTS_COMFORT') return '具体回应用户已表达的处境，先陪伴和倾听，不急着给建议';
  if (intent === 'WANTS_ACTION') return '围绕用户想解决的事情，给出一个现实可行的下一步';
  if (intent === 'WANTS_CLARITY') return '验证对用户目标和现实约束的理解，一次只推进一个关键问题';
  return '具体回应用户说出的经历和感受，再自然邀请继续表达';
}

export function analyzeConversation(latestText: string, contextText = ''): ConversationAnalysis {
  const text = latestText.trim();
  const context = `${contextText}\n${text}`.trim();
  const safety = detectSafety(text);
  let intent = detectIntent(text);
  if (intent === 'VENTING' && humanPatterns.some((pattern) => pattern.test(context)) && !declineHumanPatterns.some((pattern) => pattern.test(text))) intent = 'WANTS_HUMAN';
  const route = routeFor(safety, text, intent);
  const topics = classifyConcern(context);
  const bookingPreference: BookingPreference = declineHumanPatterns.some((pattern) => pattern.test(text))
    ? 'DECLINED'
    : intent === 'WANTS_HUMAN' ? 'ACCEPTED' : 'NOT_EXPRESSED';
  const reasons = [
    safety === 'URGENT' ? '检测到可信的即时危险表达' : '',
    safety === 'NEEDS_CLARIFICATION' ? '出现需要简短确认现实安全的表达' : '',
    route === 'PROFESSIONAL_REFERRAL' ? '当前需求可能超出普通成长支持范围' : '',
    route === 'HUMAN_SUPPORT' ? '用户明确表达了真人支持意愿' : '',
  ].filter(Boolean);
  const conversationState = stateFor(safety, route, intent);
  return {
    conversation_state: conversationState,
    primary_topic: topics[0],
    secondary_topics: topics.slice(1),
    user_intent: intent,
    confirmed_facts: [],
    confirmed_goal: null,
    tentative_hypotheses: [],
    support_provided: [],
    support_feedback: /没用|没什么用|没帮助|更焦虑|不太有用|不适合/.test(text) ? '用户反馈当前帮助效果不足' : null,
    routing_state: route,
    booking_preference: bookingPreference,
    safety_status: safety,
    routing_reason: reasons.join('；') || '当前信息未触发特殊分流规则',
    reply_strategy: strategyFor(route, intent),
    tags: topics,
    route: legacyRoute(route),
    safety: safety === 'URGENT' ? 'urgent' : safety === 'NEEDS_CLARIFICATION' ? 'clarify' : 'normal',
    reasons,
  };
}

export const emergencyReply = '我先不继续做普通建议了。你现在的安全更重要：请立刻联系身边可信任的人陪着你，尽快前往就近的医院急诊；如果存在迫在眉睫的人身危险，请联系当地紧急服务。你也可以只回复我一句：你现在是否已经安全、身边是否有人？';

export const safetyClarificationReply = '我想先确认一件重要的事：你现在有没有马上伤害自己或他人的打算，或者正处在会被伤害的环境里？你只需要回复“安全”或“有危险”即可；如果已经有迫在眉睫的危险，请先联系身边可信任的人和当地紧急服务。';
