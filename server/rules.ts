import type {
  AssessmentRecommendation,
  Complexity,
  ConversationAnalysis,
  ConversationState,
  ProblemMap,
  RoutingState,
  SafetyStatus,
  TopicCode,
  TriageRouting,
  UserIntent,
} from '../src/shared.js';

const topicRules: Array<[TopicCode, string[]]> = [
  ['EMOTION', ['焦虑', '内耗', '孤独', '压力', '低落', '崩溃', '疲惫', '情绪', '睡不着', '失眠', '委屈', '难受', '哭']],
  ['CAREER', ['工作', '职场', '职业', '求职', '转型', '创业', '事业', '同事', '领导', '辞职', '项目', '面试']],
  ['MONEY', ['收入', '钱', '金钱', '财务', '债务', '房贷', '消费', '赚钱', '经济压力', '借贷']],
  ['INTIMACY', ['恋爱', '伴侣', '对象', '婚姻', '结婚', '分手', '暧昧', '亲密关系', '回消息', '被抛弃']],
  ['FAMILY', ['父母', '爸爸', '妈妈', '家人', '家庭', '原生家庭', '童年', '家暴', '边界']],
  ['PARENTING', ['孩子', '亲子', '教育', '育儿', '女儿', '儿子', '上学', '养育']],
  ['SELF_KNOWLEDGE', ['自我', '成长', '价值感', '意义', '认识自己', '自我怀疑', '人格']],
  ['INTERPERSONAL', ['朋友', '人际', '同事关系', '社交', '沟通']],
  ['BODY_LIFE', ['身体', '健康', '睡眠', '吃饭', '生活状态', '日常']],
];

const immediateDangerPatterns = [
  /(?:现在|此刻|马上|正在).{0,8}(?:准备|计划|打算|要|想).{0,8}(?:自杀|轻生|结束生命|伤害自己|自残|割腕|跳楼)/,
  /(?:正在|已经开始|马上会|准备|计划|打算).{0,8}(?:杀人|伤害别人|弄死他|暴力伤人)/,
  /(?:正在被打|马上会被伤害|有人拿刀|有人要伤害我)/,
];

const possibleDangerPatterns = [
  /不想活|活不下去|轻生|自杀|结束生命|伤害自己|自残|割腕|跳楼/,
  /杀了他|杀人|伤害别人|弄死他|暴力伤人/,
  /家暴|人身安全|被威胁|可能会被伤害/,
];

const professionalPatterns = [/心理咨询/, /心理治疗/, /精神科/, /药物/, /心理诊断/, /心理评估/, /医疗/, /法律/, /律师/, /合同纠纷/, /诉讼/, /借贷纠纷/, /投资建议/, /税务/];
const humanPatterns = [
  /真人/, /人工/, /导师/, /预约/, /深入聊/, /持续支持/, /想.{0,6}找人聊/, /找个人陪我聊/,
  /咨询师/, /心理老师/, /专业的人/, /咨询一下/, /约一下/, /一对一/, /1\s*v\s*1/i,
  /想和人聊/, /能不能找人/, /有没有人/, /想找老师/, /想找咨询师/, /安排个人/,
  /(?:有|有没有).{0,8}咨询服务/, /(?:有|有没有|能不能|可以).{0,8}(?:老师|导师).{0,8}(?:聊|咨询|沟通|安排)/,
  /(?:AI|人工智能).{0,8}(?:没用|不行|聊不下去|不想聊)/i,
];
const declineHumanPatterns = [
  /不需要(?:真人|人工|老师|导师|咨询师)/, /不用预约/, /不想预约/, /先不用找人/,
  /不想找(?:真人|老师|导师|心理咨询师|咨询师)/, /拒绝(?:真人|人工|预约)/,
];
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

function unique(values: string[], max = 5) {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean))).slice(0, max);
}

function limitText(value: string | null | undefined, max = 160) {
  const text = value?.trim() || '';
  return text ? text.slice(0, max) : null;
}

function userTextOnly(latestText: string, contextText: string) {
  const prior = contextText
    .split(/\r?\n/)
    .filter((line) => !line.trim().startsWith('AI：'))
    .map((line) => line.replace(/^\s*用户：/, '').trim())
    .filter(Boolean);
  return [...prior, latestText.trim()].filter(Boolean).join('\n').slice(-18_000);
}

function sentences(text: string) {
  return text.split(/[。！？!?；;\n]+/).map((item) => item.trim()).filter((item) => item.length >= 4);
}

export function classifyConcern(text: string): TopicCode[] {
  const tags = topicRules.filter(([, words]) => words.some((word) => text.includes(word))).map(([tag]) => tag);
  return tags.length ? tags : ['OTHER'];
}

export function detectSafety(text: string): SafetyStatus {
  const clauses = text.split(/[，。！？\n]/).map((clause) => clause.trim()).filter(Boolean);
  const explicitNegative = /(?:没有|不会|不想|并没有|没打算).{0,10}(?:自杀|轻生|结束生命|伤害自己|自残|伤害别人)/;
  if (clauses.some((clause) => immediateDangerPatterns.some((pattern) => pattern.test(clause)) && !explicitNegative.test(clause))) return 'URGENT';
  if (explicitNegative.test(text)) return 'NO_SIGNAL_DETECTED';
  if (possibleDangerPatterns.some((pattern) => pattern.test(text))) return 'NEEDS_CLARIFICATION';
  return 'NO_SIGNAL_DETECTED';
}

function detectIntent(text: string): UserIntent {
  if (endPatterns.some((pattern) => pattern.test(text))) return 'WANTS_END';
  if (declineHumanPatterns.some((pattern) => pattern.test(text))) return 'VENTING';
  if (humanPatterns.some((pattern) => pattern.test(text))) return 'WANTS_HUMAN';
  if (/别给我建议|不想听建议|只想倾诉|先听我说|陪我一会|不用分析/.test(text)) return 'WANTS_COMFORT';
  if (/理清|弄清|分析|为什么|到底|看不明白|梳理|帮我理/.test(text)) return 'WANTS_CLARITY';
  if (/怎么办|怎么做|建议|方案|下一步|行动|该不该|要不要/.test(text)) return 'WANTS_ACTION';
  return 'VENTING';
}

function firstMatch(text: string, pattern: RegExp) {
  return text.match(pattern)?.[0] || null;
}

function extractDuration(text: string) {
  const specific = firstMatch(text, /[0-9一二两三四五六七八九十]+\s*(?:年|个月|周|天)|半年|一年多|几个月|几周|很久|长期|一直以来/);
  return specific || firstMatch(text, /最近一段时间|最近|这段时间/);
}

function extractFrequency(text: string) {
  return firstMatch(text, /几乎每天|每天|经常|反复|每次|偶尔|有时|总是|一直|周期性/);
}

function extractSeverity(text: string) {
  const numeric = text.match(/(?:现在|目前|大概|大约|强度|严重程度|焦虑|痛苦|难受)?[^0-9]{0,8}(10|[0-9])\s*(?:分|\/10)/);
  if (numeric) return Math.max(0, Math.min(10, Number(numeric[1])));
  if (/崩溃|撑不住|极度|非常严重|特别严重/.test(text)) return 8;
  if (/很严重|很大|特别难受|很痛苦/.test(text)) return 7;
  if (/有点|轻微|一点点/.test(text)) return 3;
  return null;
}

function extractFunctionalImpacts(text: string) {
  const impacts: string[] = [];
  if (/睡眠|失眠|睡不着|早醒|噩梦/.test(text)) impacts.push('sleep');
  if (/工作|学习|上班|效率|面试准备/.test(text) && /影响|没法|无法|耽误|做不下去|不稳|压力/.test(text)) impacts.push('work_study');
  if (/关系|伴侣|家里|父母|孩子|吵架/.test(text) && /影响|冲突|吵|疏远|没法|无法/.test(text)) impacts.push('relationship');
  if (/吃饭|起床|出门|生活|日常|照顾自己/.test(text) && /影响|没法|无法|不想|做不到/.test(text)) impacts.push('daily_life');
  if (/身体|心慌|胸闷|头痛|胃口|疼/.test(text)) impacts.push('body');
  if (/收入|房贷|债务|经济/.test(text) && /影响|压力|担心|无法/.test(text)) impacts.push('finance');
  return unique(impacts);
}

function extractTriggers(text: string) {
  const triggers: string[] = [];
  for (const match of text.matchAll(/(?:因为|由于|遇到|当|每当|一到)([^，。！？\n]{2,60})/g)) triggers.push(match[1].trim());
  if (/加班|工作量|工作压力|领导|同事|项目/.test(text)) triggers.push('work_pressure');
  if (/吵架|冲突|不回消息|关系变化|分手/.test(text)) triggers.push('relationship_conflict');
  if (/父母|家人|原生家庭|孩子/.test(text)) triggers.push('family_context');
  return unique(triggers);
}

function extractAttempts(text: string) {
  return unique(sentences(text).filter((sentence) => /试过|尝试|做过|努力|休假|请假|沟通|运动|咨询|吃药|记录|练习/.test(sentence)).map((sentence) => sentence.slice(0, 90)));
}

function extractGoal(text: string, intent: UserIntent) {
  const explicit = text.match(/(?:希望|想要|想先|最想|需要|想把|想知道|想)([^。！？\n]{2,60})/);
  if (explicit) return limitText(explicit[0], 100);
  if (intent === 'WANTS_HUMAN') return '希望获得真人导师的进一步支持';
  if (intent === 'WANTS_ACTION') return '希望得到一个现实可行的下一步';
  if (intent === 'WANTS_CLARITY') return '希望把当前问题理清楚';
  if (intent === 'WANTS_COMFORT') return '希望先被倾听和陪伴';
  return null;
}

function chooseMainIssue(topics: TopicCode[], text: string) {
  if (topics.length === 0 || topics[0] === 'OTHER') return null;
  const goalText = text.match(/(?:最想|希望|想先|需要|主要|先处理)([^。！？\n]{0,30})/)?.[1] || '';
  const goalTopics = classifyConcern(goalText).filter((topic) => topic !== 'OTHER');
  return (goalTopics[0] || topics[0]).toLowerCase();
}

function buildProblemMap(text: string, topics: TopicCode[], intent: UserIntent): ProblemMap {
  const userSentences = sentences(text);
  return {
    main_issue: chooseMainIssue(topics, text),
    issue_types: topics,
    scene_summary: limitText(userSentences.find((sentence) => /最近|当|每次|工作|回家|和|在/.test(sentence)) || userSentences[0]),
    onset_duration: extractDuration(text),
    frequency: extractFrequency(text),
    severity_score: extractSeverity(text),
    functional_impacts: extractFunctionalImpacts(text),
    known_triggers: extractTriggers(text),
    attempts: extractAttempts(text),
    user_goal: extractGoal(text, intent),
  };
}

function buildInformationGaps(problemMap: ProblemMap) {
  const gaps: string[] = [];
  if (problemMap.issue_types.includes('OTHER')) gaps.push('主要问题/主诉');
  if (!problemMap.scene_summary) gaps.push('最近一次最典型的场景');
  if (problemMap.severity_score === null) gaps.push(problemMap.functional_impacts.length ? '主观严重程度' : '严重程度与日常功能影响');
  if (!problemMap.functional_impacts.length) gaps.push('日常功能影响');
  if (!problemMap.onset_duration && !problemMap.frequency) gaps.push('持续时间或出现频率');
  else if (!problemMap.onset_duration) gaps.push('持续时间');
  else if (!problemMap.frequency) gaps.push('出现频率');
  if (!problemMap.user_goal) gaps.push('用户希望先获得的帮助');
  return unique(gaps, 6);
}

function chooseNextQuestion(gaps: string[]) {
  const gap = gaps[0];
  if (!gap) return null;
  if (gap.includes('功能')) return '它现在有没有影响睡眠、工作、关系或日常生活？';
  if (gap.includes('严重')) return '如果用 0-10 分估计，现在的难受程度大概是多少？';
  if (gap.includes('持续') || gap.includes('频率')) return '这种状态大概持续多久了，是偶尔发生还是最近经常出现？';
  if (gap.includes('场景')) return '最近一次最典型的情况是什么？';
  if (gap.includes('主诉')) return '如果今天只先看一件事，你最想先解决什么？';
  if (gap.includes('帮助')) return '你希望这次先得到哪一种帮助：缓解当下、理清问题，还是找下一步？';
  return '你自己试过哪些办法？有哪一点稍微有用吗？';
}

function chooseAssessment(text: string, topics: TopicCode[], complexity: Complexity, userGoal: string | null): AssessmentRecommendation {
  if (/不想测评|不想做测评|不想做测试|不要测评|不想答题/.test(text)) return { needed: false, recommended_tool: null, reason: '用户明确拒绝测评，不强制进入测评。' };
  if (/测评|量表|测试/.test(text) && /想|希望|可以|做/.test(text)) return { needed: true, recommended_tool: '情绪健康测试', reason: '用户主动希望用结构化工具辅助了解当前状态。' };
  if (topics.includes('INTIMACY') && /每次|总是|几段关系|被抛弃|被抛下|不回消息|靠近|疏离|重复|关系模式|总担心/.test(text)) return { needed: true, recommended_tool: '成人依恋关系测评', reason: '亲密关系中的重复靠近/担心模式，测评可作为自我理解和真人导诊参考。' };
  if (topics.includes('CAREER') && /方向|偏好|动力|转行|职业选择|不知道做什么/.test(text)) return { needed: true, recommended_tool: '职业六芒星', reason: '职业方向或动力冲突较模糊，结构化工具可能比继续追问更容易帮助用户表达。' };
  if (topics.includes('FAMILY') && /原生家庭|童年|父母影响/.test(text) && /想|希望|了解|探索/.test(text)) return { needed: true, recommended_tool: '寻根之旅·原生家庭考古', reason: '用户主动希望探索家庭影响；这是探索工具，不是临床筛查。' };
  const broadEmotionSignals = ['焦虑', '睡不着', '没精神', '容易哭', '低落', '情绪', '失眠'].filter((word) => text.includes(word)).length;
  if ((topics.includes('EMOTION') || topics.includes('BODY_LIFE')) && broadEmotionSignals >= 3 && complexity !== 'LIGHT') return { needed: true, recommended_tool: 'SCL-90 症状自评量表', reason: '多个情绪/身心方面同时受到影响，结构化量表可帮助降低严重程度判断的不确定性；不是诊断。' };
  if (topics.includes('EMOTION') && /愤怒|恐惧|内疚|悲痛|悲伤|委屈/.test(text) && userGoal) return { needed: true, recommended_tool: '情绪健康测试', reason: '用户想看清混杂情绪的构成，可用作自我觉察辅助。' };
  return { needed: false, recommended_tool: null, reason: null };
}

function determineComplexity(text: string, topics: TopicCode[], problemMap: ProblemMap, safety: SafetyStatus): Complexity {
  if (safety === 'URGENT') return 'HIGH_RISK';
  const meaningfulTopics = topics.filter((topic) => topic !== 'OTHER');
  const repeated = /反复|每次|总是|经常|几乎每天|长期|一直|很久/.test(text) || Boolean(problemMap.frequency);
  const longTerm = /半年|一年|几个月|几年来|长期|很久|一直/.test(text) || Boolean(problemMap.onset_duration && !/最近/.test(problemMap.onset_duration));
  const deep = /童年|创伤|长期人格|人格模式|深层关系|原生家庭/.test(text);
  const multiFactor = meaningfulTopics.length >= 2 || /同时|一边.*一边|又.*又/.test(text);
  const manyImpacts = problemMap.functional_impacts.length >= 2;
  if (deep || meaningfulTopics.length >= 3 || (longTerm && manyImpacts) || (multiFactor && repeated && manyImpacts)) return 'COMPLEX';
  if (repeated || longTerm || manyImpacts || multiFactor) return 'MODERATE';
  return 'LIGHT';
}

function diagnosticSufficiency(problemMap: ProblemMap, safety: SafetyStatus) {
  if (safety === 'URGENT') return 1;
  const dimensions = [
    problemMap.issue_types.some((topic) => topic !== 'OTHER'),
    Boolean(problemMap.scene_summary),
    problemMap.severity_score !== null || problemMap.functional_impacts.length > 0,
    Boolean(problemMap.onset_duration || problemMap.frequency),
    Boolean(problemMap.user_goal),
  ];
  return Number((dimensions.filter(Boolean).length / dimensions.length).toFixed(2));
}

function severityLevel(problemMap: ProblemMap, safety: SafetyStatus) {
  if (safety === 'URGENT') return 'HIGH' as const;
  if (problemMap.severity_score !== null && problemMap.severity_score >= 8) return 'HIGH' as const;
  if (problemMap.severity_score !== null && problemMap.severity_score >= 6 || problemMap.functional_impacts.length >= 2) return 'MODERATE_HIGH' as const;
  if (problemMap.severity_score !== null && problemMap.severity_score >= 4 || problemMap.functional_impacts.length > 0) return 'MODERATE' as const;
  if (problemMap.severity_score !== null) return 'LOW' as const;
  return 'UNKNOWN' as const;
}

function isMeaningfulDuration(problemMap: ProblemMap) {
  return Boolean(problemMap.onset_duration && !/最近|这段时间/.test(problemMap.onset_duration));
}

function isRepeated(text: string, problemMap: ProblemMap) {
  return /反复|每次|总是|经常|几乎每天|长期|一直|很久/.test(text) || Boolean(problemMap.frequency);
}

function minimumSufficientJudgment(text: string, complexity: Complexity, problemMap: ProblemMap, sufficiency: number) {
  const issueKnown = problemMap.issue_types.some((topic) => topic !== 'OTHER');
  const hasContext = Boolean(problemMap.scene_summary) || isMeaningfulDuration(problemMap) || Boolean(problemMap.frequency) || problemMap.functional_impacts.length > 0;
  const hasReasonToContinueWithHuman = Boolean(problemMap.functional_impacts.length) || isMeaningfulDuration(problemMap) || problemMap.attempts.length > 0 || complexity === 'COMPLEX' || isRepeated(text, problemMap);
  const hasEnoughWeightForHuman = Boolean(problemMap.functional_impacts.length) || isMeaningfulDuration(problemMap) || problemMap.attempts.length > 0 || complexity === 'COMPLEX';
  return issueKnown && hasContext && hasReasonToContinueWithHuman && hasEnoughWeightForHuman && sufficiency >= 0.6;
}

function aiHelpValue(text: string, intent: UserIntent, complexity: Complexity, problemMap: ProblemMap, supportFeedback: string | null) {
  if (supportFeedback) return 0.25;
  if (complexity === 'COMPLEX') return 0.3;
  if (complexity === 'MODERATE') {
    if (problemMap.attempts.length || problemMap.functional_impacts.length || /长期|几个月|很久|反复|总是/.test(text)) return 0.45;
    return 0.6;
  }
  if (intent === 'WANTS_ACTION') return 0.85;
  return 0.75;
}

function humanHelpValue(text: string, intent: UserIntent, complexity: Complexity, problemMap: ProblemMap, supportFeedback: string | null) {
  if (intent === 'WANTS_HUMAN') return 1;
  if (supportFeedback) return 0.9;
  if (complexity === 'COMPLEX') return 0.85;
  const longTerm = /半年|一年|几个月|几年来|长期|很久|一直/.test(text) || Boolean(problemMap.onset_duration && !/最近/.test(problemMap.onset_duration));
  if (longTerm && problemMap.functional_impacts.length > 0) return 0.85;
  if (problemMap.attempts.length > 0 && problemMap.functional_impacts.length > 0) return 0.82;
  if (complexity === 'MODERATE') return 0.55;
  return 0.25;
}

function aiFurtherValue(text: string, complexity: Complexity, problemMap: ProblemMap, supportFeedback: string | null) {
  if (supportFeedback || complexity === 'COMPLEX' || problemMap.functional_impacts.length > 0 || problemMap.attempts.length > 0 || isMeaningfulDuration(problemMap) && isRepeated(text, problemMap)) return 'LOW' as const;
  if (complexity === 'MODERATE') return 'MEDIUM' as const;
  return 'HIGH' as const;
}

function humanHelpLevel(text: string, intent: UserIntent, complexity: Complexity, problemMap: ProblemMap, supportFeedback: string | null) {
  if (intent === 'WANTS_HUMAN' || supportFeedback || complexity === 'COMPLEX') return 'HIGH' as const;
  if ((isMeaningfulDuration(problemMap) || isRepeated(text, problemMap)) && problemMap.functional_impacts.length > 0) return 'HIGH' as const;
  if (complexity === 'MODERATE') return 'MEDIUM' as const;
  return 'LOW' as const;
}

function shouldOfferHuman(text: string, intent: UserIntent, complexity: Complexity, problemMap: ProblemMap, sufficiency: number, supportFeedback: string | null) {
  if (intent === 'WANTS_HUMAN') return true;
  if (intent === 'WANTS_COMFORT' || intent === 'WANTS_END') return false;
  return minimumSufficientJudgment(text, complexity, problemMap, sufficiency)
    && aiFurtherValue(text, complexity, problemMap, supportFeedback) === 'LOW'
    && humanHelpLevel(text, intent, complexity, problemMap, supportFeedback) === 'HIGH';
}

function routeFor(safety: SafetyStatus, text: string, intent: UserIntent, complexity: Complexity, sufficiency: number, assessment: AssessmentRecommendation, supportFeedback: string | null, handoffReady = false): TriageRouting {
  if (safety !== 'NO_SIGNAL_DETECTED') return 'SAFETY_SUPPORT';
  if (intent === 'WANTS_HUMAN') return 'HUMAN_MENTOR';
  if (handoffReady) return 'HUMAN_MENTOR';
  if (declineHumanPatterns.some((pattern) => pattern.test(text))) return 'AI_SUPPORT';
  if (professionalPatterns.some((pattern) => pattern.test(text))) return 'PROFESSIONAL_REFERRAL';
  if (intent === 'WANTS_COMFORT' || intent === 'WANTS_END') return 'AI_SUPPORT';
  if (assessment.needed) return 'AI_SUPPORT';
  return 'AI_SUPPORT';
}

function legacyRouting(routing: TriageRouting): RoutingState {
  if (routing === 'HUMAN_MENTOR') return 'HUMAN_SUPPORT';
  if (routing === 'PROFESSIONAL_REFERRAL') return 'PROFESSIONAL_REFERRAL';
  if (routing === 'SAFETY_SUPPORT') return 'EMERGENCY_SUPPORT';
  return 'AI_SELF_HELP';
}

function legacyState(routing: TriageRouting, safety: SafetyStatus, intent: UserIntent): ConversationState {
  if (safety !== 'NO_SIGNAL_DETECTED') return 'SAFETY_SUPPORT';
  if (routing === 'HUMAN_MENTOR') return 'HUMAN_SERVICE';
  if (intent === 'WANTS_COMFORT') return 'EMOTIONAL_SUPPORT';
  if (intent === 'WANTS_CLARITY') return 'EXPLORATION';
  if (intent === 'WANTS_ACTION') return 'PROBLEM_SOLVING';
  return 'LISTENING';
}

function strategyFor(routing: TriageRouting, intent: UserIntent, gaps: string[], assessment: AssessmentRecommendation, complexity: Complexity) {
  if (routing === 'SAFETY_SUPPORT') return '先确认现实安全并提供当地紧急求助方向，暂停普通建议、测评与商业推荐';
  if (routing === 'PROFESSIONAL_REFERRAL') return '说明普通成长支持边界，提供合适的专业求助方向，不把 AI 结论当作诊断';
  if (routing === 'HUMAN_MENTOR') return '先做阶段性镜像和前端导诊摘要，说明为什么真人更适合，不再进入 D3 深度探索';
  if (assessment.needed) return `短镜像后说明测评用途，推荐${assessment.recommended_tool}，明确它只是辅助参考，不是诊断`;
  if (intent === 'WANTS_COMFORT') return '具体回应用户已表达的处境，先陪伴和倾听，不急着给建议';
  if (gaps.length) return `短镜像后只推进一个最高价值缺口：${gaps[0]}`;
  if (complexity === 'LIGHT') return '总结当前问题，给 1-3 个有针对性的轻量支持，并询问是否有帮助';
  return '阶段性总结当前判断，给出下一步支持选项，让用户自主选择';
}

function depthFor(text: string, complexity: Complexity, routing: TriageRouting, gaps: string[]): 'D0' | 'D1' | 'D2' | 'D3' {
  if (routing === 'SAFETY_SUPPORT') return 'D0';
  if (routing === 'HUMAN_MENTOR') return 'D0';
  if (complexity === 'COMPLEX' && /童年|创伤|人格|深层|原生家庭/.test(text)) return 'D3';
  if (gaps.length) return 'D1';
  if (/尝试|反复|模式|选择|矛盾/.test(text)) return 'D2';
  return 'D0';
}

function routingReason(routing: TriageRouting, complexity: Complexity, problemMap: ProblemMap, intent: UserIntent, assessment: AssessmentRecommendation) {
  if (routing === 'SAFETY_SUPPORT') return '出现需要优先处理的安全信号，暂停普通导诊和商业推荐';
  if (routing === 'HUMAN_MENTOR' && intent === 'WANTS_HUMAN') return '用户明确表达真人帮助意愿，直接进入预约交接';
  if (routing === 'PROFESSIONAL_REFERRAL') return '用户需求涉及医疗、心理治疗或其他需要合格专业资质的事项';
  if (intent === 'WANTS_COMFORT') return '用户明确希望先倾诉，除安全需要外不强制量化、测评或真人导流';
  if (intent === 'WANTS_END') return '用户表达了结束或暂缓意愿，尊重其选择，不继续推进导诊';
  if (routing === 'HUMAN_MENTOR') return `${complexity === 'COMPLEX' ? '多因素/深层内容' : '持续、反复或已有功能影响'}，已经达到最低充分判断，继续在 AI 中追问的收益有限，适合真人继续梳理`;
  if (assessment.needed) return `当前信息可以先由 AI 支持，${assessment.recommended_tool}可能比继续追问更有效地降低不确定性`;
  if (problemMap.issue_types.includes('OTHER')) return '当前主诉还不够清楚，先帮助用户聚焦问题';
  return '问题暂处于 AI 能适当支持的范围，继续收集会改变判断的最少信息';
}

function routeForLegacy(routing: TriageRouting): ConversationAnalysis['route'] {
  return routing === 'HUMAN_MENTOR' ? 'human' : routing === 'PROFESSIONAL_REFERRAL' ? 'professional' : routing === 'SAFETY_SUPPORT' ? 'safety' : 'self_help';
}

export function routeConcern(text: string, safety: SafetyStatus): RoutingState {
  const intent = detectIntent(text);
  const topics = classifyConcern(text);
  const problemMap = buildProblemMap(text, topics, intent);
  const complexity = determineComplexity(text, topics, problemMap, safety);
  const sufficiency = diagnosticSufficiency(problemMap, safety);
  const supportFeedback = /没用|没什么用|没帮助|更焦虑|不太有用|不适合/.test(text) ? '用户反馈当前帮助效果不足' : null;
  const handoffReady = shouldOfferHuman(text, intent, complexity, problemMap, sufficiency, supportFeedback);
  return legacyRouting(routeFor(safety, text, intent, complexity, sufficiency, { needed: false, recommended_tool: null, reason: null }, supportFeedback, handoffReady));
}

function responseGoalFor(routing: TriageRouting, intent: UserIntent, gaps: string[], assessment: AssessmentRecommendation, supportFeedback: string | null): 'LISTEN' | 'CLARIFY' | 'MIRROR' | 'ASSESS' | 'HELP' | 'ASSESSMENT' | 'HANDOFF' {
  if (routing === 'HUMAN_MENTOR') return 'HANDOFF';
  if (assessment.needed) return 'ASSESSMENT';
  if (intent === 'WANTS_ACTION') return gaps.length ? 'CLARIFY' : 'HELP';
  if (intent === 'WANTS_COMFORT' || intent === 'VENTING') return supportFeedback ? 'MIRROR' : 'LISTEN';
  if (intent === 'WANTS_CLARITY') return gaps.length ? 'CLARIFY' : 'MIRROR';
  if (gaps.length) return 'CLARIFY';
  return 'HELP';
}

function replyLengthFor(text: string, intent: UserIntent, goal: ReturnType<typeof responseGoalFor>, complexity: Complexity): 'SHORT' | 'MEDIUM' | 'LONG' {
  if (goal === 'HANDOFF' || goal === 'LISTEN' || intent === 'WANTS_END') return 'SHORT';
  if (goal === 'ASSESSMENT' || goal === 'MIRROR' || complexity === 'COMPLEX') return 'MEDIUM';
  if (intent === 'WANTS_ACTION' && /具体|方案|步骤|怎么做|下一步/.test(text)) return 'LONG';
  return text.length > 90 ? 'MEDIUM' : 'SHORT';
}

export function analyzeConversation(latestText: string, contextText = ''): ConversationAnalysis {
  const text = latestText.trim();
  const allUserText = userTextOnly(text, contextText);
  const safety = detectSafety(text);
  const intent = detectIntent(text);
  const topics = classifyConcern(allUserText);
  const problemMap = buildProblemMap(allUserText, topics, intent);
  const complexity = determineComplexity(allUserText, topics, problemMap, safety);
  const gaps = buildInformationGaps(problemMap);
  const assessment = chooseAssessment(allUserText, topics, complexity, problemMap.user_goal);
  const sufficiency = diagnosticSufficiency(problemMap, safety);
  const supportFeedback = /没用|没什么用|没帮助|更焦虑|不太有用|不适合/.test(text) ? '用户反馈当前帮助效果不足' : null;
  const preliminaryHandoffReady = safety === 'NO_SIGNAL_DETECTED'
    && shouldOfferHuman(allUserText, intent, complexity, problemMap, sufficiency, supportFeedback);
  const routing = routeFor(safety, text, intent, complexity, sufficiency, assessment, supportFeedback, preliminaryHandoffReady);
  const handoffReady = routing === 'HUMAN_MENTOR';
  const minimumJudgment = minimumSufficientJudgment(allUserText, complexity, problemMap, sufficiency);
  const directHumanIntent = intent === 'WANTS_HUMAN';
  const humanIntent = declineHumanPatterns.some((pattern) => pattern.test(text)) ? 'DECLINED' as const : directHumanIntent ? 'EXPLICIT' as const : 'NOT_EXPLICIT' as const;
  const handoffMode = directHumanIntent ? 'DIRECT_HANDOFF' as const : handoffReady ? 'QUICK_HANDOFF' as const : 'NONE' as const;
  const furtherValue = aiFurtherValue(allUserText, complexity, problemMap, supportFeedback);
  const humanLevel = humanHelpLevel(allUserText, intent, complexity, problemMap, supportFeedback);
  const responseGoal = responseGoalFor(routing, intent, gaps, assessment, supportFeedback);
  const handoffState = declineHumanPatterns.some((pattern) => pattern.test(text)) ? 'DECLINED' as const : handoffReady ? 'OFFERED' as const : 'NOT_READY' as const;
  const askQuestion = !handoffReady && responseGoal !== 'HANDOFF' && responseGoal !== 'HELP' && responseGoal !== 'ASSESSMENT' && intent !== 'WANTS_END' && gaps.length > 0;
  const legacyRoute = legacyRouting(routing);
  const reasons = [
    safety === 'URGENT' ? '检测到可信的即时危险表达' : '',
    safety === 'NEEDS_CLARIFICATION' ? '出现需要简短确认现实安全的表达' : '',
    routing === 'PROFESSIONAL_REFERRAL' ? '当前需求可能超出普通成长支持范围' : '',
    routing === 'HUMAN_MENTOR' && directHumanIntent ? '用户明确表达真人帮助意愿' : '',
    routing === 'HUMAN_MENTOR' && !directHumanIntent ? '已达到最低充分判断，继续 AI 的边际价值较低' : '',
    assessment.needed ? `建议辅助测评：${assessment.recommended_tool}` : '',
  ].filter(Boolean);
  const conversationState = legacyState(routing, safety, intent);
  const confirmedFacts = unique(sentences(allUserText).map((sentence) => sentence.slice(0, 160)), 5);
  return {
    problem_map: problemMap,
    information_gaps: gaps,
    assessment,
    complexity,
    diagnostic_sufficiency: sufficiency,
    routing,
    depth_level: depthFor(allUserText, complexity, routing, gaps),
    next_question: handoffReady ? null : chooseNextQuestion(gaps),
    conversation_mode: responseGoal,
    response_goal: responseGoal,
    problem_clarity: sufficiency,
    severity_level: severityLevel(problemMap, safety),
    ai_help_value: Number(aiHelpValue(allUserText, intent, complexity, problemMap, supportFeedback).toFixed(2)),
    human_help_value: Number(humanHelpValue(allUserText, intent, complexity, problemMap, supportFeedback).toFixed(2)),
    handoff_state: handoffState,
    handoff_mode: handoffMode,
    minimum_sufficient_judgment: minimumJudgment,
    human_intent: humanIntent,
    ai_can_help_now: !handoffReady && routing === 'AI_SUPPORT',
    ai_further_value: furtherValue,
    human_help_level: humanLevel,
    reply_length: replyLengthFor(text, intent, responseGoal, complexity),
    ask_question: askQuestion,
    no_more_questions: !askQuestion,
    show_booking_button: handoffReady,
    booking_button_text: handoffReady ? '免费预约真人聊聊' : null,
    booking_summary_ready: handoffReady,
    handoff_ready: handoffReady,
    conversation_state: conversationState,
    primary_topic: topics[0],
    secondary_topics: topics.slice(1),
    user_intent: intent,
    confirmed_facts: confirmedFacts,
    confirmed_goal: problemMap.user_goal,
    tentative_hypotheses: [],
    support_provided: [],
    support_feedback: supportFeedback,
    routing_state: legacyRoute,
    booking_preference: declineHumanPatterns.some((pattern) => pattern.test(text)) ? 'DECLINED' : intent === 'WANTS_HUMAN' ? 'ACCEPTED' : 'NOT_EXPRESSED',
    safety_status: safety,
    routing_reason: routingReason(routing, complexity, problemMap, intent, assessment),
    reply_strategy: strategyFor(routing, intent, gaps, assessment, complexity),
    tags: topics,
    route: routeForLegacy(routing),
    safety: safety === 'URGENT' ? 'urgent' : safety === 'NEEDS_CLARIFICATION' ? 'clarify' : 'normal',
    reasons,
  };
}

export const emergencyReply = '我先不继续做普通建议了。你现在的安全更重要：请立刻联系身边可信任的人陪着你，尽快前往就近的医院急诊；如果存在迫在眉睫的人身危险，请联系当地紧急服务。你也可以只回复我一句：你现在是否已经安全、身边是否有人？';

export const safetyClarificationReply = '我想先确认一件重要的事：你现在有没有马上伤害自己或他人的打算，或者正处在会被伤害的环境里？你只需要回复“安全”或“有危险”即可；如果已经有迫在眉睫的危险，请先联系身边可信任的人和当地紧急服务。';
