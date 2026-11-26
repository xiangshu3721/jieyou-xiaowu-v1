import { isHumanHandoffDecline, isUndecidedHumanHelpQuestion, wantsHumanBooking } from '../src/shared.js';
import type {
  AssessmentRecommendation,
  AskedQuestion,
  ChatMessage,
  Complexity,
  ConversationAnalysis,
  ConversationControlIntent,
  ConversationState,
  DialogueStrategy,
  FactField,
  KnownFact,
  IssueStatus,
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
  ['INTIMACY', ['恋爱', '感情', '情感关系', '伴侣', '对象', '婚姻', '结婚', '分手', '暧昧', '亲密关系', '回消息', '被抛弃']],
  ['FAMILY', ['父母', '爸爸', '妈妈', '家人', '家庭', '原生家庭', '童年', '家暴', '边界']],
  ['PARENTING', ['孩子', '亲子', '教育', '育儿', '女儿', '儿子', '上学', '养育']],
  ['SELF_KNOWLEDGE', ['自我', '成长', '价值感', '意义', '认识自己', '自我怀疑', '人格']],
  ['INTERPERSONAL', ['朋友', '人际', '同事关系', '社交', '沟通']],
  ['BODY_LIFE', ['身体', '健康', '睡眠', '吃饭', '生活状态', '日常']],
];

const immediateDangerPatterns = [
  /(?:现在|此刻|马上|正在).{0,8}(?:准备|计划|打算|要|想).{0,8}(?:自杀|轻生|结束生命|伤害自己|自残|割腕|跳楼|跳下去)/,
  /(?:正在|已经开始|马上会|准备|计划|打算).{0,8}(?:杀人|伤害别人|弄死他|暴力伤人)/,
  /(?:正在被打|马上会被伤害|有人拿刀|有人要伤害我)/,
  // SAFE-02：明确近期自伤计划。时间词或普通动作本身不构成紧急风险。
  /(?:我|自己).{0,4}(?:计划|打算|准备).{0,4}(?:明天|今晚|这周末|今天|后天|明早|明晚|今夜|这周|下周).{0,12}(?:自杀|轻生|结束生命|离开这个世界|不活了|伤害自己|自残|割腕|跳楼|跳下去)/,
  // SAFE-02：药物准备仅在同一段已有明确自伤/过量语义时升级，避免把按医嘱服药当成危机。
  /(?:我|自己)(?=[^。！？\n]{0,50}(?:买好|准备好).{0,8}(?:药|药片|药瓶|安眠药|农药))(?=[^。！？\n]{0,50}(?:明天|今晚|这周末|今天|后天|明早|明晚|今夜|这周|下周))(?=[^。！？\n]{0,50}(?:自杀|轻生|结束生命|伤害自己|自残|过量(?:吃|服|喝|用|服药)))[^。！？\n]{0,80}/,
  // SAFE-02：遗书准备（写遗书本身就是高度危险信号）
  /(?:我|自己).{0,4}(?:已经)?(?:写好|写完|留下|放好).{0,4}(?:遗书|遗言|告别信|绝笔)/,
  // SAFE-02：持有工具和具体自伤意图必须在同一段出现；做饭、剪纸等日常动作不升级。
  /(?:我|自己).{0,6}(?:手里|手上|拿着|握着|抓着).{0,6}(?:刀|刀片|剪刀|绳子|药瓶|药片).{0,16}(?:想|要|准备|打算).{0,8}(?:割腕|自残|伤害自己|跳楼|跳下去|结束生命|不活了)/,
  /(?:我|自己).{0,8}(?:想|要|准备|打算).{0,8}(?:割腕|自残|伤害自己|跳楼|跳下去|结束生命|不活了)/,
];

const possibleDangerPatterns = [
  /不想活|活不下去|轻生|自杀|结束生命|伤害自己|自残|割腕|跳楼/,
  /杀了他|杀人|伤害别人|弄死他|暴力伤人/,
  /家暴|人身安全|被威胁|可能会被伤害/,
];

// SAFE-01：间接轻生意念（第一人称、条件/愿望/假设框架、无即时计划）。
// 仅用于 NEEDS_CLARIFICATION，不升级 URGENT。
// 不含宽泛的"不在/消失/离开"，避免误伤普通外出、日常离开或第三人称叙述。
const indirectSuicidalPatterns = [
  // "如果/要是+我+不在了就好了/该多好" — 显式第一人称主语
  /(?:如果|要是|若能).{0,4}(?:我|自己).{0,6}(?:不在|没有|不存在).{0,8}(?:了|的话)?.{0,4}(?:就好|该多好|就好了|就行了|也可以|也无所谓)/,
  // "有时候想/我想/我觉得+如果不在了就好了" — 第一人称前导+省略主语
  /(?:我|自己|有时候).{0,6}(?:想|觉得|感觉).{0,6}(?:如果|要是|若能).{0,6}(?:不在|没有|不存在).{0,8}(?:了|的话)?.{0,4}(?:就好|该多好|就好了|就行了|也可以|也无所谓)/,
  // "要是没有我/看不到我+就好了" — 显式第一人称
  /(?:要是|如果|若能).{0,6}(?:没有|看不到).{0,4}(?:我|自己).{0,10}(?:了|的话)?.{0,4}(?:就好|该多好|就好了|就行了|也可以|也无所谓)/,
  // "我/真希望不用再醒过来" — 显式第一人称或"真"强调
  /(?:我|自己|真)(?:希望|想|但愿|真希望).{0,8}(?:不用|不必|再也不用).{0,8}(?:醒|起来|睁开).{0,4}(?:来|眼)/,
  // "我/有时候感觉+如果+消失了+也没人在意" — 第一人称前导+消失
  /(?:我|自己|有时候)?(?:感觉|觉得).{0,6}(?:如果|要是|若能).{0,6}(?:消失|不见|离开).{0,6}(?:了|的).{0,10}(?:也没|也不).{0,8}(?:有人|没人|不会|会有).{0,8}(?:在意|关心|知道|发现|注意|记得|察觉|关心我|记得我|发现|注意到)/,
  // "我不在了就好/也好/也无所谓" — 显式第一人称
  /(?:我|自己).{0,4}(?:不在|不见|消失).{0,4}(?:了|的).{0,6}(?:就好|也好|也无所谓|也行|也无妨|该多好|也可以)/,
  // "我消失了也没人在意/也不会有人发现" — 显式第一人称
  /(?:我|自己).{0,4}(?:消失|不见|离开).{0,4}(?:了|的).{0,10}(?:也没|也不).{0,8}(?:有人|没人|不会|会有).{0,8}(?:在意|关心|知道|发现|注意|记得|察觉|关心我|记得我|发现|注意到)/,
  // "如果/要是+我+消失了/不见了/离开了+也不会有人在意" — 显式第一人称
  /(?:如果|要是|若能|万一).{0,4}(?:我|自己).{0,4}(?:消失|不见|离开).{0,4}(?:了|的).{0,10}(?:也没|也不).{0,8}(?:有人|没人|不会|会有).{0,8}(?:在意|关心|知道|发现|注意|记得|察觉|关心我|记得我|发现|注意到)/,
];

// SAFE-01：非第一人称主体标记，用于排除间接模式的误归因。
// 当句段中出现这些标记作为间接表达的主语时，不应归因于用户本人。
const nonFirstPersonSubjectPatterns = [
  // 第三人称代词作主语："他/她/它+如果/要是/觉得/希望"
  /(?:他|她|它|他们|她们|其)\s*(?:如果|要是|若能|觉得|感觉|希望|想|但愿)/,
  // 条件句+第三人称："如果/要是+他/她/它"
  /(?:如果|要是|若能).{0,4}(?:他|她|它|他们|她们)/,
  // 非人名词作主语："项目/工作/任务/麻烦/事情+如果/要是/消失"
  /(?:项目|工作|任务|麻烦|事情)\s*(?:如果|要是|若能|消失|不存在)/,
  // 条件句+非人名词："如果/要是+项目/工作/任务/麻烦/事情"
  /(?:如果|要是|若能).{0,6}(?:项目|工作|任务|麻烦|事情)/,
  // 虚构角色作主语："小说主人公/角色/人物+如果/要是/不在"
  /(?:小说|书|电影|故事)?(?:主人公|角色|人物)\s*(?:如果|要是|若能|不在|没有|消失)/,
  // 第三人称+希望/想："她/他+真希望/希望/想+不用+醒"
  /(?:她|他|它|他们|她们)\s*(?:真)?(?:希望|想|但愿)/,
];

// SAFE-01：第三人称转述（无引号的间接引述）与文学/讨论语境标记。
// 用于逐段判断某个句段是否属于他者叙述或作品讨论。
const thirdPartyAttributionPatterns = [
  // 第三人称报告："朋友/他/她说...不想活/轻生/..."
  /(?:朋友|他|她|某人|有人|同事|同学|伴侣|家人|对方|客户|患者|来访者).{0,12}(?:说|表示|提到|告诉|聊到|谈到|讲)/,
  // 文学/讨论语境："书/电影里提到轻生/自杀..."
  /(?:书|电影|电视剧|小说|文章|故事|讨论|案例|课程|讲座|节目).{0,12}(?:里|中|提到|讲到|描述)/,
];

const professionalPatterns = [/心理咨询/, /心理治疗/, /精神科/, /心理诊断/, /心理评估/, /医疗/, /法律/, /律师/, /合同纠纷/, /诉讼/, /借贷纠纷/, /投资建议/, /税务/];
const medicationDecisionPatterns = [
  /(?:吃|服用|服|用|正在吃|正在服用|抗抑郁|抗焦虑|处方).{0,16}(?:药|药物).{0,18}(?:停药|减药|减量|加量|调整剂量|换药|剂量|副作用|不良反应)/,
  /(?:想|要不要|能不能|是否|是不是|怎么|该不该|准备|打算|可以).{0,8}(?:自己|自行)?(?:停药|减药|换药)/,
  /(?:减量|加量|调整剂量|自己停|自行停|自己减|自行减).{0,16}(?:药|药物|处方|抗抑郁|抗焦虑)/,
  /(?:药|药物|剂量).{0,16}(?:想|要不要|能不能|可以不可以|是否|是不是|怎么|可以).{0,16}(?:停|减|加|少吃|减一点|减量|调成一半|减半|补服|补吃|补两片|换|调整|剂量)/,
  /(?:漏吃|漏服|忘了吃|忘记吃|忘服).{0,16}(?:补|两片|加倍|多吃)/,
  /(?:想|要不要|能不能|是否|是不是|可以).{0,12}(?:把)?(?:剂量|用量).{0,12}(?:调成一半|减半|调整|减量|加量)/,
  /(?:药|药物).{0,16}(?:副作用|不良反应)/,
];
const medicationContextPatterns = [/(?:服用|吃药|服药|正在用|使用).{0,12}(?:药|药物)/, /抗抑郁药|抗焦虑药|处方药/, /药物/];
const contextualMedicationDecisionPatterns = [
  /(?:能不能|可以不可以|可不可以|是否|是不是|能否|想|要不要|可以).{0,10}(?:减一点|少吃一点|减量|调成一半|减半|停药|加量|补服|补吃|补两片)/,
  /(?:漏吃|漏服|忘了吃|忘记吃|忘服).{0,12}(?:补|两片|加倍|多吃)/,
];
const endPatterns = [/先这样/, /我先不聊了/, /不用了谢谢/, /再见/, /晚安/, /结束对话/];

// JTBD-03：用户明确表达的进展信号（帮助进展识别）
// PROGRESS：用户明确说理解了、有下一步、做了决定
const progressPatterns = [
  /我好像(?:看清|想明白|弄明白|知道|理解|懂了)/,
  /原来(?:我|自己).{0,12}(?:是|在)/,
  /我(?:现在|终于)(?:知道|明白|清楚)(?:了|一点)/,
  /我(?:决定|打算|准备|想好)(?:先|要)?(?:试|做|从|跟|找|去|跟.{0,6}谈谈)/,
  /我知道(?:明天|接下来|第一步|该).{0,12}(?:做|先|怎么)/,
  /听你(?:这么)?一说.{0,8}(?:明白|清楚|懂了|明白了)/,
  /好像(?:有点|有些)?(?:头绪|方向|思路|答案)/,
  /(?:这个|这个角度|这样)(?:对|有)我(?:有)?(?:帮助|用|启发)/,
];
// NO_HELP：用户明确说当前帮助没用或不是在帮自己
const noHelpPatterns = [
  /(?:这|你|这些|这样)(?:对|给|帮).{0,4}(?:我|自己).{0,4}(?:没什么|没有|没啥|完全没有)(?:帮助|用|效果|意义)/,
  /你(?:一直|总在|总是)(?:问|重复|追问).{0,8}(?:相同|一样的|同样的)/,
  /不是(?:我)?想解决(?:的)?(?:事|问题|事)/,
  /你(?:说|给|建议)的(?:都)?(?:不|没)(?:适合|对口|相关|是.{0,6}问题)/,
  /感觉(?:越聊|越说|越.{0,4}(?:焦虑|烦|乱|迷茫))/,
  /(?:说了|聊了).{0,8}(?:半天|这么久).{0,8}(?:还是|好像|似乎).{0,8}(?:没|不|回到)/,
  /不太是(?:我)?想(?:要|聊|解决)(?:的)?/,
];

/**
 * JTBD-03：检测用户最新表达中的帮助进展信号。
 * 只基于用户明确表达的证据；"嗯""好吧""谢谢"等中性回应返回 UNDETERMINED。
 */
export function detectHelpProgress(text: string): import('../src/shared.js').HelpProgressSignal {
  if (progressPatterns.some((pattern) => pattern.test(text))) return 'PROGRESS';
  if (noHelpPatterns.some((pattern) => pattern.test(text))) return 'NO_HELP';
  return 'UNDETERMINED';
}

const correctionPatterns = [
  /你(?:理解|弄)错了/,
  /不是这个意思/,
  /你说得不对/,
  /(?:我)?(?:没有|没|并没有|并非).{0,8}(?:提到|说过|说).{0,12}(?:经济|收入|钱|欠钱|财务|房租)/,
  /不要(?:再)?往[^，。！？\n]{0,20}分析/,
  /别(?:再)?往[^，。！？\n]{0,20}分析/,
  /(?:我)?不是(?:不)?自信/,
  /不是(?:要|让).{0,4}你.{0,4}分析/,
];
const moneyMentionPattern = /收入|钱|金钱|财务|债务|房贷|消费|赚钱|经济压力|欠钱|房租/;
const careerMentionPattern = /工作|职场|职业|求职|转型|创业|事业|同事|领导|辞职|项目|面试/;

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
  const lines = [...prior, latestText.trim()].filter(Boolean);
  return effectiveUserLines(lines, lines.join('\n')).join('\n').slice(-18_000);
}

export interface ConversationUnderstanding {
  known_facts: Partial<Record<FactField, KnownFact>>;
  asked_fields: FactField[];
  unresolved_fields: FactField[];
  asked_questions: AskedQuestion[];
}

export interface IssueAnalysisOptions {
  issueId?: string;
  issueStatus?: IssueStatus;
  userTurnCount?: number;
  handoffOffered?: boolean;
  previousTopics?: TopicCode[];
  newIssueDetected?: boolean;
  newIssueConfidence?: number;
  controlIntent?: ConversationControlIntent;
  understanding?: ConversationUnderstanding;
  issueTopicTags?: TopicCode[];
  safetyStatus?: SafetyStatus;
}

function userTurnCountFromContext(contextText: string) {
  return contextText.split(/\r?\n/).map((line) => line.trim()).filter((line) => line && !line.startsWith('AI：')).length + 1;
}

/**
 * V1.6 只在有足够语义证据时切换 Issue。关键词不同本身不够，
 * “工作压力导致失眠”这类影响关系仍留在同一个 Issue。
 */
export function detectIssueSwitch(latestText: string, previousText = '', previousTopics: TopicCode[] = []) {
  const latest = latestText.trim();
  const previous = previousText.trim();
  if (!latest || !previous) return { detected: false, confidence: 0 };
  const explicitSwitch = /(?:另外|还有个事情|还有一件事|换个话题|我还想问一个|我还想说一个|其实我最近还|再说一个|另一个问题)/.test(latest);
  if (!explicitSwitch && correctionPatterns.some((pattern) => pattern.test(latest))) return { detected: false, confidence: 0.05 };
  const previousTopicSet = new Set(previousTopics.length ? previousTopics : classifyConcern(previous));
  const latestTopics = classifyConcern(latest);
  const novelTopics = latestTopics.filter((topic) => topic !== 'OTHER' && !previousTopicSet.has(topic));
  const continuationSignals = /(?:所以|因此|也|还|同时|影响|导致|因为|晚上|睡眠|失眠|白天|这件事)/.test(latest);
  // A practical decision can be part of an active care concern even when it
  // introduces work or money words. For example, after discussing a parent's
  // surgery, “一想到辞职回去就害怕以后找不到现在这样的工作” is weighing a
  // care option, not opening an unrelated career Issue. Keep this narrow: it
  // also needs a positive care reference in the current expression (including
  // returning home in an active care context), so an unrelated job change is
  // still allowed to become its own Issue.
  const careContext = /(?:手术|住院|看病|医院|生病|病情|照顾|陪护|康复|治疗|身体不好|身体状况)/.test(previous);
  const workOrMoneyDecision = /(?:辞职|换工作|求职|请假|回去|收入|工作安排|工作)/.test(latest);
  const decisionOrSolutionLanguage = /(?:一想到|要不要|该不该|是不是|考虑|打算|准备|决定|害怕|担心|怎么安排|怎么办|如何|以后|如果|辞职后|请假后)/.test(latest);
  const currentCareReference = /(?:照顾|陪护|陪(?:她|他|妈妈|爸爸|父母|家人)|妈妈|爸爸|父母|家人|手术|住院|看病|医院|生病|病情|康复|治疗|回家|回去)/.test(latest);
  const explicitlySeparateConcern = /(?:和|跟).{0,20}(?:无关|不是一回事)|(?:不是|并非).{0,12}(?:因为|为了).{0,12}(?:照顾|手术|住院|看病|医院|生病|病情)/.test(latest);
  const careDecisionContinuation = careContext && currentCareReference && workOrMoneyDecision && decisionOrSolutionLanguage && !explicitlySeparateConcern;
  const strongNewTopic = /(?:离.{0,2}婚|刚分手|分手后|婚姻|伴侣|孩子|亲子|父母|原生家庭|辞职|换工作|求职|债务|房贷|法律|诉讼)/.test(latest);
  const strongTopicAlreadyInIssue = (/(?:离.{0,2}婚|刚分手|分手后|婚姻|伴侣)/.test(latest) && previousTopicSet.has('INTIMACY'))
    || (/(?:孩子|亲子)/.test(latest) && previousTopicSet.has('PARENTING'))
    || (/(?:父母|原生家庭)/.test(latest) && previousTopicSet.has('FAMILY'))
    || (/(?:辞职|换工作|求职)/.test(latest) && previousTopicSet.has('CAREER'))
    || (/(?:债务|房贷)/.test(latest) && previousTopicSet.has('MONEY'));
  const strongNewDomain = strongNewTopic && !strongTopicAlreadyInIssue;
  if (explicitSwitch) return { detected: true, confidence: 0.98 };
  // A cause-effect link to the original domain is a continuation, not a new Issue:
  // e.g. "工作压力影响了和伴侣的关系".
  const causalLink = /因为|导致|影响|引起|牵连|连带|所以|因此/.test(latest)
    && latestTopics.some((topic) => topic !== 'EMOTION' && previousTopicSet.has(topic));
  if (causalLink) return { detected: false, confidence: 0.12 };
  if (careDecisionContinuation) return { detected: false, confidence: 0.12 };
  const novelDomains = novelTopics.filter((topic) => topic !== 'EMOTION');
  if ((novelDomains.length > 0 || strongNewDomain) && (strongNewDomain || !continuationSignals)) return { detected: true, confidence: 0.82 };
  return { detected: false, confidence: explicitSwitch ? 0.35 : 0.12 };
}

function sentences(text: string) {
  return text.split(/[。！？!?；;\n]+/).map((item) => item.trim()).filter((item) => item.length >= 4);
}

export function classifyConcern(text: string): TopicCode[] {
  const tags = topicRules.filter(([, words]) => words.some((word) => text.includes(word))).map(([tag]) => tag);
  return tags.length ? tags : ['OTHER'];
}

export function detectSafety(text: string): SafetyStatus {
  // Only suppress a quoted segment when the surrounding text explicitly
  // attributes it to another person. A first-person quote without that
  // attribution is still a current-user signal, e.g. “我现在正准备伤害自己”
  // or 我现在想“自杀”.
  const quotedText = text.replace(/[“「『][^”」』]*[”」』]|"[^"]*"|'[^']*'/g, (quote, offset) => {
    const before = text.slice(Math.max(0, offset - 32), offset);
    const after = text.slice(offset + quote.length, offset + quote.length + 32);
    const thirdParty = /(?:朋友|他人|对方|家人|同事|同学|伴侣|父母|孩子|有人|他说|她说|对方说|某人)(?:刚刚|之前|曾经|一直)?(?:说|表示|提到|告诉我|发来|写道)\s*[:：]?\s*$/.test(before)
      || /^\s*[,，。:：]?\s*(?:朋友|他人|对方|家人|同事|同学|伴侣|父母|孩子|有人|某人)(?:刚刚|之前|曾经|一直)?(?:说|表示|提到|告诉我|发来|写道)/.test(after);
    return thirdParty ? ' ' : quote;
  });
  // SAFE-01 第三轮：按标点 + 主语切换分句。
  // 处理无标点中文消息中用户本人表达被第三人称转述吞掉的问题。
  const segments = splitSafetySegments(quotedText);

  const explicitNegative = /(?:没有|不会|不想|并没有|没打算).{0,10}(?:自杀|轻生|结束生命|伤害自己|自残|伤害别人)/;

  // SAFE-01 第四轮：以具体风险候选表达为最小判定单位。
  // 否定、第三方归因、非第一人称主体只影响其对应的局部内容，不一票排除同段其他候选。

  // Pass 1：即时危险 → URGENT。原句用于保留逗号前后的明确上下文，
  // 分段用于准确处理局部否定；两者都只排除匹配点所在的第三方归因区域。
  // SAFE-01 第五轮：遍历所有匹配，不只查首个
  for (const segment of [...segments, quotedText]) {
    for (const pattern of immediateDangerPatterns) {
      for (const m of findAllMatches(segment, pattern)) {
        if (!isMatchLocallyNegated(segment, m.start, m.end)
          && !isMatchInThirdPartyRegion(segment, m.start, m.end)
          && !isSafetyEducationContext(segment, m.start, m.end)) {
          return 'URGENT';
        }
      }
    }
  }

  // Pass 2：可能危险 + 间接轻生意念 → NEEDS_CLARIFICATION（局部抑制）
  let hasClarification = false;
  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i];

    // 直接可能危险：遍历所有匹配，每个分别判断局部抑制
    // SAFE-01 第五轮：不只查首个匹配
    for (const pattern of possibleDangerPatterns) {
      for (const m of findAllMatches(segment, pattern)) {
        if (!isMatchLocallyNegated(segment, m.start, m.end)
          && !isMatchInThirdPartyRegion(segment, m.start, m.end)
          && !isSafetyEducationContext(segment, m.start, m.end)) {
          hasClarification = true;
        }
      }
    }

    // 间接轻生意念：仅当匹配被局部第三方归因或局部非第一人称主体否定时才抑制
    // 同时支持跨段语境恢复（前段第一人称动词+本段条件句省略主语）
    const indirectCandidates: { text: string; offset: number }[] = [{ text: segment, offset: 0 }];
    if (i > 0 && /^(?:如果|要是|若能)/.test(segment)) {
      const prev = segments[i - 1];
      if (/(?:我|自己|有时候)?(?:想|觉得|感觉)$/.test(prev)) {
        indirectCandidates.push({ text: prev.slice(-8) + segment, offset: 0 });
      }
    }
    for (const candidate of indirectCandidates) {
      for (const pattern of indirectSuicidalPatterns) {
        // SAFE-01 第五轮：遍历所有匹配，不只查首个
        for (const m of findAllMatches(candidate.text, pattern)) {
          if (!isMatchInThirdPartyRegion(candidate.text, m.start, m.end)
            && !isMatchLocallyNegated(candidate.text, m.start, m.end)
            && !hasNonFirstPersonSubjectNearMatch(candidate.text, m.start, m.end)) {
            hasClarification = true;
          }
        }
      }
    }
  }

  if (hasClarification) return 'NEEDS_CLARIFICATION';
  return 'NO_SIGNAL_DETECTED';
}

// 只排除当前命中的“自杀”词本身被预防/教育修饰的情形；不能用固定窗口，
// 否则无标点文本中另一处独立本人计划会被错误吞掉。
function isSafetyEducationContext(text: string, matchStart: number, matchEnd: number) {
  const matchedSuicide = text.lastIndexOf('自杀', matchEnd - 1);
  if (matchedSuicide < matchStart || matchedSuicide >= matchEnd) return false;
  const before = text.slice(Math.max(matchStart, matchedSuicide - 4), matchedSuicide);
  const after = text.slice(matchedSuicide + 2, Math.min(text.length, matchedSuicide + 6));
  return /(?:预防|防治|干预|教育|科普)$/.test(before)
    || /^(?:预防|防治|干预|教育|科普)/.test(after);
}

// SAFE-01 第五轮：枚举正则在全段的所有非重叠匹配及其位置。
// 用 exec 循环，防止全局标志零宽匹配死循环。
function findAllMatches(text: string, pattern: RegExp): { start: number; end: number; text: string }[] {
  const flags = pattern.flags.includes('g') ? pattern.flags : pattern.flags + 'g';
  const regex = new RegExp(pattern.source, flags);
  const results: { start: number; end: number; text: string }[] = [];
  let m: RegExpExecArray | null;
  while ((m = regex.exec(text)) !== null) {
    results.push({ start: m.index, end: m.index + m[0].length, text: m[0] });
    if (m[0].length === 0) regex.exec(text); // 零宽推进防死循环
  }
  return results;
}

// SAFE-01 第三轮：按标点和主语切换分句。
// 先按标点分割，再在每个片段内检测主语切换（"我也/我自己/但我/我也会/我也想/我觉得/我感觉"）进一步拆分。
function splitSafetySegments(text: string): string[] {
  const byPunctuation = text.split(/[，。！？\n]/).map((s) => s.trim()).filter(Boolean);
  const result: string[] = [];
  // 主语切换标记：前面是逗号/无标点分隔，后面是新的第一人称主语
  const subjectSwitch = /(?<=[，,]?\s*)(?=(?:但|可)?(?:我也|我自己|我也会|我也想|我觉得|我感觉|我现在|我正在))/;
  for (const clause of byPunctuation) {
    const subClauses = clause.split(subjectSwitch).map((s) => s.trim()).filter(Boolean);
    result.push(...subClauses);
  }
  return result;
}

// SAFE-01 第三轮：判断句段是否属于第三方/文学归属。
// 仅用于辅助，不在 detectSafety 主循环中整段使用。
function isThirdPartySegment(segment: string): boolean {
  return thirdPartyAttributionPatterns.some((pattern) => pattern.test(segment));
}

// SAFE-01 第三轮：判断句段是否包含非第一人称主体（他/她/项目/工作/角色等）。
// 仅用于辅助，不在 detectSafety 主循环中整段使用。
function hasNonFirstPersonSubject(segment: string): boolean {
  return nonFirstPersonSubjectPatterns.some((pattern) => pattern.test(segment));
}

// SAFE-01 第四轮：判断风险匹配是否被局部否定覆盖。
// 否定模式与风险匹配在文本中有重叠区域时，视为被局部否定。
// 但否定不能跨越对比/转折标记（但/可/只），只作用于同一局部主语范围。
function isMatchLocallyNegated(text: string, matchStart: number, matchEnd: number): boolean {
  const negPattern = /(?:没有|不会|不想|并没有|没打算)[^但可只]{0,10}(?:自杀|轻生|结束生命|伤害自己|自残|伤害别人)/g;
  let m: RegExpExecArray | null;
  while ((m = negPattern.exec(text)) !== null) {
    const negStart = m.index;
    const negEnd = negStart + m[0].length;
    // 否定范围与风险匹配有重叠 → 被否定
    if (negStart < matchEnd && negEnd > matchStart) return true;
  }
  return false;
}

// SAFE-01 第四轮：判断风险匹配是否处于第三方/文学归因区域内。
// 第三方归因区域从归属动词开始，延伸到下一个第一人称主语切换或段尾。
function isMatchInThirdPartyRegion(text: string, matchStart: number, matchEnd: number): boolean {
  for (const pattern of thirdPartyAttributionPatterns) {
    const regex = new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : 'g');
    let m: RegExpExecArray | null;
    while ((m = regex.exec(text)) !== null) {
      const regionStart = m.index;
      const verbEnd = m.index + m[0].length;
      // 第三方区域延伸到下一个第一人称主语切换或段尾
      const rest = text.slice(verbEnd);
      const switchMatch = rest.match(/(?:但|可)?(?:我也|我自己|我也会|我也想|我觉得|我感觉|我现在|我正在)/);
      const regionEnd = switchMatch && switchMatch.index !== undefined ? verbEnd + switchMatch.index : text.length;
      // 风险匹配完全在第三方区域内
      if (matchStart >= regionStart && matchEnd <= regionEnd) return true;
    }
  }
  return false;
}

// SAFE-01 第四轮：判断风险匹配附近是否有非第一人称主体在修饰它。
// 仅当非第一人称主体出现在匹配之前或之内（修饰该匹配）时，才视为修饰。
// 出现在匹配之后的主体（如"如果我不在了就好了但她希望"中的"她希望"）不否决前面的匹配。
function hasNonFirstPersonSubjectNearMatch(text: string, matchStart: number, matchEnd: number): boolean {
  for (const pattern of nonFirstPersonSubjectPatterns) {
    const regex = new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : 'g');
    let m: RegExpExecArray | null;
    while ((m = regex.exec(text)) !== null) {
      const subjStart = m.index;
      const subjEnd = subjStart + m[0].length;
      // 非第一人称主体在匹配之前或之内（起始在匹配结束之前）→ 修饰该匹配
      if (subjStart < matchEnd && subjEnd > matchStart) return true;
    }
  }
  return false;
}

function isSafetyClarification(text: string) {
  const normalized = text.trim().replace(/\s+/g, ' ');
  if (!normalized || /[?？]/.test(normalized)) return false;
  // Do not let uncertainty, a feared loss of control, or a mixed statement
  // clear a pending risk. This is intentionally a positive-form assertion,
  // not a punctuation-stripped substring check.
  if (/(?:还是|是否|吗|么|不确定|不知道|怕|担心|失控|可能|不安全|危险|会)/.test(normalized)) return false;
  return /^(?:(?:我(?:现在|此刻)?|现在我|目前我)?(?:是)?安全(?:的)?(?:了|啦)?(?:[，,、](?:我)?(?:身边有人|有人陪着我|已经离开危险环境|在安全的地方))?|(?:我)?没有危险)[。.]?$/.test(normalized);
}

/**
 * Safety continuity is deliberately limited to the current Issue's user
 * messages. A later ordinary sentence cannot erase a recent risk signal; an
 * explicit safety clarification can restore normal support.
 */
export function recentSafetyStatus(messages: ChatMessage[]): SafetyStatus {
  let pending: SafetyStatus = 'NO_SIGNAL_DETECTED';
  for (const message of messages) {
    if (message.role !== 'user') continue;
    const text = message.content.trim();
    if (!text) continue;
    const current = detectSafety(text);
    if (current === 'URGENT') {
      pending = 'URGENT';
      continue;
    }
    if (current === 'NEEDS_CLARIFICATION') {
      pending = pending === 'URGENT' ? 'URGENT' : 'NEEDS_CLARIFICATION';
      continue;
    }
    if (pending !== 'NO_SIGNAL_DETECTED' && isSafetyClarification(text)) pending = 'NO_SIGNAL_DETECTED';
  }
  return pending;
}

const actionRequestPattern = /怎么办|怎么做|给.{0,8}(?:建议|办法)|(?:要|想要).{0,4}(?:具体)?(?:建议|办法|方案)|方案|下一步|行动|该不该|要不要|别光安慰我|(?:怎么|如何).{0,12}(?:谈|说|开口|做|办|处理)|(?:今天|现在|接下来|先).{0,12}(?:做|办|处理).{0,8}(?:哪一件|什么|怎么)|(?:今天|现在|接下来).{0,12}(?:该|先).{0,8}(?:看|做|办|处理|什么)|(?:愿意|想|准备).{0,6}(?:做点事|行动起来)/;
const declinedActionPattern = /(?:别|不要|不用|不想|不必|无需|不需要|没有必要)\s*(?:再)?(?:给.{0,8}(?:建议|办法|方案)|建议|方案|办法|下一步|行动|(?:教|告诉|劝).{0,6}(?:怎么办|怎么做)|怎么办|怎么做)/;

function intentClauses(text: string) {
  return text.split(/(?:但是|不过|可是|但)|[，,。！？!?；;\n]+/).map((clause) => clause.trim()).filter(Boolean);
}

function hasExplicitActionRequest(text: string) {
  // Advice-related words can be quoted only to reject them. Keep the scope
  // local to each clause so a later, affirmative request still takes effect:
  // “别往自信上分析，我现在该怎么和主管谈？”.
  return intentClauses(text)
    .some((clause) => actionRequestPattern.test(clause) && !declinedActionPattern.test(clause));
}

function hasExplicitActionDecline(text: string) {
  return intentClauses(text).some((clause) => declinedActionPattern.test(clause));
}

function isBroadEmotionActionRequest(text: string) {
  // “焦虑怎么办”表达了想被帮助，但首轮没有足够事实来指定行动。
  // 只收窄短、泛化的情绪主诉；具体场景或明确要方法仍直接帮助。
  return text.length <= 30
    && /焦虑|难受|压力大|烦|低落|累|紧张|害怕/.test(text)
    && /怎么办|怎么做/.test(text)
    && !/具体|办法|步骤|下一步|先做|怎么和|怎么跟|明天|今天|工作优先级/.test(text);
}

function hasExplicitClarificationRequest(text: string) {
  return /(?:帮我|请你|能不能|想请你).{0,12}(?:理清|弄清|分析|梳理)|(?:为什么|到底).{0,10}(?:是|怎么回事)|(?:然后|接下来|所以)呢|具体写什么|(?:事情|思绪|脑子).{0,8}(?:乱|一团)|心里(?:很|有点)?着急/.test(text);
}

function correctionDeclinesExploration(text: string) {
  return /(?:不要|别|不是要|不用).{0,8}(?:再)?(?:往|对着)?.{0,8}分析|不想回答|不想被问|只想倾诉|只想说说|不是这个意思|你说得不对|(?:我)?不是(?:不)?自信/.test(text);
}

export function deniedTopicsForText(text: string) {
  const denied: TopicCode[] = [];
  if (/(?:我)?(?:没有|没|并没有|并非).{0,8}(?:提到|说过|说).{0,12}(?:经济|收入|钱|欠钱|财务|房租)/.test(text)) denied.push('MONEY');
  return denied;
}

/**
 * A medication mention alone is ordinary context. This helper only matches a
 * concrete medication decision or side-effect question, which must not be
 * answered by the general growth-support route.
 */
export function isMedicationDecisionRequest(text: string, issueContextText = '') {
  if (medicationDecisionPatterns.some((pattern) => pattern.test(text))) return true;
  if (!issueContextText || !medicationContextPatterns.some((pattern) => pattern.test(issueContextText))) return false;
  // An omitted subject is only safe to inherit when the latest turn does not
  // explicitly name a non-medical object such as work or a task.
  if (/(?:任务|工作量|工作压力|工作|事情|计划|安排|时间)/.test(text)) return false;
  return contextualMedicationDecisionPatterns.some((pattern) => pattern.test(text));
}

function effectiveUserLines(lines: string[], latestText: string) {
  const denied = new Set(deniedTopicsForText(latestText));
  if (!denied.size) return lines;
  return lines.filter((line) => {
    if (!denied.has('MONEY') || !moneyMentionPattern.test(line)) return true;
    if (deniedTopicsForText(line).includes('MONEY')) return true;
    // 保留“我只是在说工作压力”这类混合纠正，但不再把孤立的
    // “没收入/经济压力”历史句当成当前 Issue 的事实。
    return careerMentionPattern.test(line) ? line.replace(moneyMentionPattern, '').trim() : false;
  }).filter(Boolean);
}

function detectIntent(text: string): UserIntent {
  if (isHumanHandoffDecline(text)) return 'VENTING';
  if (endPatterns.some((pattern) => pattern.test(text))) return 'WANTS_END';
  if (isUndecidedHumanHelpQuestion(text)) return 'WANTS_CLARITY';
  if (wantsHumanBooking(text)) return 'WANTS_HUMAN';
  // A correction is not automatically an invitation to analyse the user. It
  // takes priority unless the same turn contains a clear new request for help.
  if (correctionPatterns.some((pattern) => pattern.test(text))) {
    if (hasExplicitActionRequest(text)) return 'WANTS_ACTION';
    if (hasExplicitActionDecline(text)) return 'WANTS_COMFORT';
    if (hasExplicitClarificationRequest(text)) return 'WANTS_CLARITY';
    return correctionDeclinesExploration(text) ? 'WANTS_COMFORT' : 'VENTING';
  }
  if (isBroadEmotionActionRequest(text)) return 'WANTS_CLARITY';
  if (hasExplicitActionRequest(text)) return 'WANTS_ACTION';
  if (/别给我建议|不想听建议|只想倾诉|先听我说|陪我一会|不用分析|(?:只想|就想|只是想把?)(?:把)?[^。！？\n]{0,30}(?:(?:感觉|感受|心里话).{0,8})?说出来/.test(text) || hasExplicitActionDecline(text)) return 'WANTS_COMFORT';
  if (hasExplicitClarificationRequest(text)) return 'WANTS_CLARITY';
  if (/理清|弄清|分析|为什么|到底|看不明白|梳理|帮我理/.test(text)) return 'WANTS_CLARITY';
  // JTBD-02B D7：拒绝分析+想倾诉应为 WANTS_COMFORT（放在显式请求之后，防止吞掉混合意愿）
  if (/别(?:再)?(?:给我|往)?.{0,4}分析|不用(?:再)?分析|不想被分析(?![成为])/.test(text)) return 'WANTS_COMFORT';
  return 'VENTING';
}

/**
 * A clearly stated wish to only talk is a conversation preference, not a
 * one-message flag. Keep it for later factual additions in the same Issue,
 * but release it immediately when the user makes a new explicit request.
 */
export function resolveConversationIntent(latestText: string, contextText = ''): UserIntent {
  const latest = detectIntent(latestText);
  if (latest !== 'VENTING') return latest;
  if (correctionPatterns.some((pattern) => pattern.test(latestText))) return latest;
  const priorUserMessages = contextText
    .split(/\r?\n/)
    .filter((line) => !line.trim().startsWith('AI：'))
    .map((line) => line.replace(/^\s*用户：/, '').trim())
    .filter(Boolean)
    .reverse();
  for (const message of priorUserMessages) {
    const prior = detectIntent(message);
    if (prior === 'WANTS_COMFORT') return prior;
    // A later explicit mode change belongs to its own turn; do not resurrect
    // an older comfort preference across it.
    if (prior !== 'VENTING') break;
  }
  return latest;
}

function firstMatch(text: string, pattern: RegExp) {
  return text.match(pattern)?.[0] || null;
}

function extractDuration(text: string) {
  const specific = firstMatch(text, /[0-9一二两三四五六七八九十]+\s*(?:年|个月|周|天)|半年|一年多|几个月|几周|好几年|几年|数年|这些年|多年来|多年|一阵子|很久|长期|一直以来/);
  return specific || firstMatch(text, /最近一段时间|最近|这段时间/);
}

function extractFrequency(text: string) {
  return firstMatch(text, /几乎每天|每天|经常|反复|每次|偶尔|有时|总是|一直|周期性/);
}

function extractSeverity(text: string) {
  const numeric = text.match(/(?:现在|目前|大概|大约|强度|严重程度|焦虑|痛苦|难受)?[^0-9]{0,8}(10|[0-9])\s*(?:分|\/10)/);
  if (numeric) return Math.max(0, Math.min(10, Number(numeric[1])));
  return null;
}

function extractFunctionalImpacts(text: string) {
  const impacts: string[] = [];
  if (/睡眠|失眠|睡不着|睡不好|早醒|噩梦/.test(text)) impacts.push('sleep');
  const workImpactPattern = /(?:影响|耽误|拖累)[^，。！？；,!?;]{0,8}(?:工作能力|工作效率|工作状态|工作表现|工作|学习|上班)|(?:工作能力|工作效率|工作状态|工作表现|工作|学习|上班)[^，。！？；,!?;]{0,8}(?:受到影响|受影响|被影响|受损)|(?:无法|没法|做不下去)(?:工作|上班|学习)/;
  const deniedWorkImpactPattern = /(?:没有|没|并没有|并没|未|不曾|未曾)\s*(?:影响|耽误|拖累)[^，。！？；,!?;]{0,8}(?:工作能力|工作效率|工作状态|工作表现|工作|学习|上班)|(?:工作能力|工作效率|工作状态|工作表现|工作|学习|上班)[^，。！？；,!?;]{0,8}(?:不受影响|没有受影响|没受影响|未受影响)|不会\s*(?:影响|耽误|拖累)[^，。！？；,!?;]{0,8}(?:工作能力|工作效率|工作状态|工作表现|工作|学习|上班)/;
  if (text.split(/[，。！？；,!?;]/).some((clause) => workImpactPattern.test(clause) && !deniedWorkImpactPattern.test(clause))) impacts.push('work_study');
  if (/关系|伴侣|家里|父母|孩子|吵架/.test(text) && /影响|冲突|吵|疏远|没法|无法/.test(text)) impacts.push('relationship');
  if (/吃饭|起床|出门|生活|日常|状态|照顾自己/.test(text) && /影响|没法|无法|不想|做不到/.test(text)) impacts.push('daily_life');
  if (/身体|心慌|胸闷|头痛|胃口|疼/.test(text)) impacts.push('body');
  if (sentences(text).some((sentence) => !deniedTopicsForText(sentence).includes('MONEY') && /收入|房贷|债务|经济|钱/.test(sentence) && /影响|压力|担心|无法/.test(sentence))) impacts.push('finance');
  return unique(impacts);
}

function extractTriggers(text: string) {
  const triggers: string[] = [];
  for (const match of text.matchAll(/(?:因为|由于|遇到|当|每当|一到)([^，。！？\n]{2,60})/g)) {
    const matchIndex = match.index ?? -1;
    const prefix = matchIndex >= 0 ? text.slice(Math.max(0, matchIndex - 12), matchIndex) : '';
    if (/(?:不是|并不是|并非|没有|没)\s*$/.test(prefix)) continue;
    triggers.push(match[1].trim());
  }
  const negatedCause = /(?:不是|并不是|并非|没有|没)\s*(?:因为|由于)[^，。！？\n]{2,60}/.test(text);
  if (!negatedCause && /加班|工作量|工作压力|领导|同事|项目/.test(text)) triggers.push('work_pressure');
  if (!negatedCause && /吵架|冲突|不回消息|关系变化|分手/.test(text)) triggers.push('relationship_conflict');
  if (!negatedCause && /父母|家人|原生家庭|孩子/.test(text)) triggers.push('family_context');
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

function factValue(understanding: ConversationUnderstanding | undefined, field: FactField) {
  return understanding?.known_facts[field]?.value;
}

function applyKnownFacts(problemMap: ProblemMap, understanding?: ConversationUnderstanding) {
  const duration = factValue(understanding, 'duration');
  const frequency = factValue(understanding, 'frequency');
  const severity = factValue(understanding, 'severity_score');
  const functionalImpact = factValue(understanding, 'functional_impact');
  const trigger = factValue(understanding, 'trigger');
  const attempts = factValue(understanding, 'attempts');
  const goal = factValue(understanding, 'user_goal');
  if (typeof duration === 'string') problemMap.onset_duration = duration;
  if (typeof frequency === 'string') problemMap.frequency = frequency;
  if (typeof severity === 'number') problemMap.severity_score = severity;
  if (typeof functionalImpact === 'string' && !problemMap.functional_impacts.length) problemMap.functional_impacts = [functionalImpact];
  if (typeof trigger === 'string' && !problemMap.known_triggers.length) problemMap.known_triggers = [trigger];
  if (Array.isArray(attempts) && attempts.length) problemMap.attempts = attempts.filter((item): item is string => typeof item === 'string');
  if (typeof goal === 'string') problemMap.user_goal = goal;
  return problemMap;
}

function isSpecificDuration(value: unknown): value is string {
  return typeof value === 'string' && Boolean(value.trim()) && !/^(?:最近|最近一段时间|这段时间)$/.test(value.trim());
}

function buildInformationGaps(problemMap: ProblemMap, understanding?: ConversationUnderstanding) {
  const gaps: string[] = [];
  const asked = new Set(understanding?.asked_fields || []);
  if (problemMap.issue_types.includes('OTHER') && !asked.has('main_issue')) gaps.push('主要问题/主诉');
  if (!problemMap.scene_summary && !asked.has('scene')) gaps.push('最近一次最典型的场景');
  if (problemMap.severity_score === null && !problemMap.functional_impacts.length && !asked.has('severity_score')) gaps.push('严重程度与日常功能影响');
  if (!problemMap.functional_impacts.length && !asked.has('functional_impact')) gaps.push('日常功能影响');
  if (!isSpecificDuration(problemMap.onset_duration) && !asked.has('duration')) gaps.push('持续时间');
  if (!problemMap.frequency && !asked.has('frequency')) gaps.push('出现频率');
  if (!problemMap.user_goal && !asked.has('user_goal')) gaps.push('用户希望先获得的帮助');
  return unique(gaps, 6);
}

function chooseNextQuestion(gaps: string[], latestText = '', problemMap?: ProblemMap) {
  if (/(?:然后|接下来|所以)呢|具体写什么/.test(latestText)) {
    if (problemMap?.issue_types.includes('CAREER')) return '你说的工作压力，最近具体卡在哪一件事上？';
    return '你希望我先帮你把哪一件具体的事说清楚？';
  }
  if (/(?:事情|思绪|脑子).{0,8}(?:乱|一团)|心里(?:很|有点)?着急/.test(latestText)) return '现在最让你着急的，是哪一件具体的事？';
  if (correctionPatterns.some((pattern) => pattern.test(latestText))) {
    if (problemMap?.issue_types.includes('CAREER')) return '那工作压力最近具体卡在哪一件事上？';
    return '你刚刚纠正的这件事，具体发生在哪个场景里？';
  }
  const gap = gaps[0];
  if (!gap) return null;
  if (gap.includes('功能')) return '它现在有没有影响睡眠、工作、关系或日常生活？';
  if (gap.includes('严重')) return '如果用 0-10 分估计，现在的难受程度大概是多少？';
  if (gap.includes('持续')) return '这种状态大概持续多久了？';
  if (gap.includes('频率')) return '这种情况一般多久会出现一次？';
  if (gap.includes('场景')) return '最近一次最典型的情况是什么？';
  if (gap.includes('主诉')) return '如果今天只先看一件事，你最想先解决什么？';
  if (gap.includes('帮助')) return '你希望这次先得到哪一种帮助：缓解当下、理清问题，还是找下一步？';
  return '你自己试过哪些办法？有哪一点稍微有用吗？';
}

function questionLike(text: string) {
  return /[？?]|(?:吗|呢)[。！？!?]?$/.test(text.trim());
}

export function questionField(text: string): FactField | null {
  const value = text.trim();
  if (!questionLike(value)) return null;
  if (/0\s*[-～到]\s*10|几分|严重程度|难受程度|痛苦程度|强度/.test(value)) return 'severity_score';
  if (/持续多久|多长时间|从什么时候|什么时候开始|多久了|多久以来|几年|几个月|多年来/.test(value)) return 'duration';
  if (/多久.*一次|多频繁|频率|每天.*发生|经常.*发生|多常发生/.test(value)) return 'frequency';
  if (/影响.*(?:睡眠|工作|关系|日常|生活)|有没有影响|白天.*状态|功能影响/.test(value)) return 'functional_impact';
  if (/什么.*导致|什么时候.*加重|诱因|触发/.test(value)) return 'trigger';
  if (/试过哪些|尝试过|做过什么|什么办法/.test(value)) return 'attempts';
  if (/希望.*帮助|想要.*帮助|最想|先解决什么|先处理什么/.test(value)) return 'user_goal';
  if (/最近一次|最典型|具体发生了什么|什么情况|哪一件.*事|哪件事|卡在哪/.test(value)) return 'scene';
  if (/只先看一件事|主要问题|最困扰/.test(value)) return 'main_issue';
  return null;
}

function semanticKey(field: FactField) {
  return {
    main_issue: 'primary_concern',
    scene: 'recent_scene',
    severity_score: 'subjective_severity',
    duration: 'issue_duration',
    frequency: 'issue_frequency',
    functional_impact: 'functional_impact',
    trigger: 'trigger_context',
    attempts: 'previous_attempts',
    user_goal: 'support_goal',
  }[field];
}

function addFact(facts: Partial<Record<FactField, KnownFact>>, field: FactField, value: string | number | string[] | null | undefined) {
  if (value === null || value === undefined || value === '' || (Array.isArray(value) && value.length === 0)) return;
  facts[field] = { value, source: 'user_explicit', confidence: 1 };
}

function standaloneSeverity(messages: ChatMessage[]) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role !== 'user' || !/^(?:10|[0-9])(?:\s*分)?$/.test(message.content.trim())) continue;
    const previousAssistant = messages.slice(0, index).reverse().find((item) => item.role === 'assistant');
    if (previousAssistant && /0\s*[-～到]\s*10|几分|严重程度|难受程度|强度/.test(previousAssistant.content)) return Number(message.content.match(/10|[0-9]/)?.[0]);
  }
  return null;
}

/** V1.7 在进入模型前从当前 Issue 建立事实和已问问题记忆。 */
export function buildConversationUnderstanding(messages: ChatMessage[], issueTopicTags: TopicCode[] = []): ConversationUnderstanding {
  const userMessages = messages.filter((message) => message.role === 'user');
  const latestUserText = userMessages.at(-1)?.content || '';
  const rawUserLines = userMessages.map((message) => message.content.trim()).filter(Boolean);
  const userText = effectiveUserLines(rawUserLines, rawUserLines.join('\n')).join('\n').slice(-18_000);
  const intent = detectIntent(latestUserText);
  const deniedTopics = new Set(deniedTopicsForText(userText));
  const topics = Array.from(new Set([...issueTopicTags.filter((topic) => topic !== 'OTHER' && !deniedTopics.has(topic)), ...classifyConcern(userText).filter((topic) => !deniedTopics.has(topic))]));
  const problemMap = buildProblemMap(userText, topics, intent);
  const facts: Partial<Record<FactField, KnownFact>> = {};
  const latestExtracted = <T>(extractor: (text: string) => T | null) => {
    for (const message of [...userMessages].reverse()) {
      const value = extractor(message.content);
      if (value !== null) return value;
    }
    return null;
  };
  addFact(facts, 'main_issue', problemMap.main_issue);
  addFact(facts, 'scene', problemMap.scene_summary);
  addFact(facts, 'severity_score', latestExtracted(extractSeverity) ?? standaloneSeverity(messages) ?? problemMap.severity_score);
  const duration = latestExtracted(extractDuration) ?? problemMap.onset_duration;
  addFact(facts, 'duration', isSpecificDuration(duration) ? duration : null);
  addFact(facts, 'frequency', latestExtracted(extractFrequency) ?? problemMap.frequency);
  addFact(facts, 'functional_impact', problemMap.functional_impacts.length ? problemMap.functional_impacts.join(', ') : null);
  addFact(facts, 'trigger', problemMap.known_triggers.length ? problemMap.known_triggers.join(', ') : null);
  addFact(facts, 'attempts', problemMap.attempts);
  addFact(facts, 'user_goal', latestExtracted((text) => extractGoal(text, detectIntent(text))) ?? problemMap.user_goal);

  const askedQuestions: AskedQuestion[] = [];
  for (const message of messages.filter((item) => item.role === 'assistant')) {
    const field = questionField(message.content);
    if (!field || askedQuestions.some((item) => item.field === field)) continue;
    askedQuestions.push({ field, semantic_key: semanticKey(field), question: message.content.trim().slice(-240), answered: facts[field] !== undefined });
  }
  const askedFields = askedQuestions.map((item) => item.field);
  const unresolvedFields = (['main_issue', 'scene', 'severity_score', 'duration', 'frequency', 'functional_impact', 'trigger', 'attempts', 'user_goal'] as FactField[])
    .filter((field) => facts[field] === undefined);
  return { known_facts: facts, asked_fields: askedFields, unresolved_fields: unresolvedFields, asked_questions: askedQuestions };
}

export function isDuplicateQuestion(text: string, analysis: Pick<ConversationAnalysis, 'known_facts' | 'asked_questions'>) {
  const field = questionField(text);
  if (!field) return false;
  // A broad scene summary inferred from the user's latest sentence is not an
  // answer to a useful request for one concrete example. Only treat scene
  // questions as duplicates after that field was explicitly asked and answered.
  if (field === 'scene') return analysis.asked_questions.some((item) => item.field === field && item.answered);
  return analysis.known_facts[field] !== undefined || analysis.asked_questions.some((item) => item.field === field && item.answered);
}

function fieldForNextQuestion(question: string | null) {
  return question ? questionField(question.replace(/[。！？!?]$/, '') + '？') : null;
}

function questionValueFor(intent: UserIntent, question: string | null, problemMap: ProblemMap, userTurnCount: number, latestText = '') {
  const field = fieldForNextQuestion(question);
  if (!field) return 0;
  if (intent === 'WANTS_CLARITY' || intent === 'WANTS_ACTION' || hasExplicitClarificationRequest(latestText) || correctionPatterns.some((pattern) => pattern.test(latestText))) return 0.85;
  if (field === 'severity_score' && problemMap.functional_impacts.length) return 0.8;
  if (field === 'functional_impact' && problemMap.severity_score !== null) return 0.78;
  if (userTurnCount > 1) return 0.68;
  return 0.45;
}

export function selectDialogueStrategy(input: {
  routing: TriageRouting;
  intent: UserIntent;
  assessment: AssessmentRecommendation;
  supportFeedback: string | null;
  nextQuestion: string | null;
  questionValue: number;
  problemMap: ProblemMap;
  openQuestionRequested?: boolean;
  latestText?: string;
  responseGoal?: string;
}): DialogueStrategy {
  if (input.routing === 'SAFETY_SUPPORT') return 'EMPATHIZE';
  if (input.routing === 'HUMAN_MENTOR') return 'HANDOFF';
  if (input.intent === 'WANTS_COMFORT') return 'EMPATHIZE';
  // JTBD-02B P1-C/D3：结束意愿优先于普通测评/探索/追问
  if (input.intent === 'WANTS_END') return 'MIRROR';
  if (input.assessment.needed) return 'ASSESSMENT';
  if (input.intent === 'WANTS_ACTION') return 'PROVIDE_HELP';
  if (input.supportFeedback) return 'CLARIFY_GOAL';
  // JTBD-02B D5b/D7b：纠正理解后先镜像确认，不追问事实
  const latestText = input.latestText ?? '';
  if (latestText && correctionPatterns.some((pattern) => pattern.test(latestText))) {
    return 'MIRROR';
  }
  // JTBD-02B D6：讨论专业支持时（犹豫中的询问）先镜像说明边界，不追问事实
  if (latestText && professionalPatterns.some((pattern) => pattern.test(latestText)) && isUndecidedHumanHelpQuestion(latestText)) {
    return 'MIRROR';
  }
  if (input.intent === 'WANTS_CLARITY' && input.nextQuestion && input.questionValue >= 0.6) return 'CLARIFY_FACT';
  // JTBD-02B P1-A/D4：倾听为主时不被追问策略覆盖；明确想探索时保留有价值提问
  if (input.responseGoal === 'LISTEN') return input.problemMap.scene_summary || input.problemMap.user_goal ? 'MIRROR' : 'LISTEN';
  if (input.openQuestionRequested && input.nextQuestion && input.questionValue >= 0.6) return 'CLARIFY_FACT';
  if (input.nextQuestion && input.questionValue >= 0.72) return questionField(input.nextQuestion) === 'severity_score' ? 'QUANTIFY' : input.intent === 'WANTS_CLARITY' ? 'CLARIFY_FACT' : 'CONTINUE';
  if (input.problemMap.scene_summary || input.problemMap.user_goal) return 'MIRROR';
  return 'LISTEN';
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

function hasSustainedHandoffEvidence(problemMap: ProblemMap) {
  const duration = problemMap.onset_duration || '';
  const sustainedDuration = /(?:半个?月|[一二两三四五六七八九十\d]+(?:周|个?月|年)|半年|长期|很久|一直)/.test(duration);
  const impactful = problemMap.functional_impacts.length > 0;
  return impactful && (sustainedDuration || isRepeated('', problemMap) || problemMap.attempts.length > 0);
}

function shouldOfferHuman(text: string, intent: UserIntent, complexity: Complexity, problemMap: ProblemMap, sufficiency: number, supportFeedback: string | null, userTurnCount = 1, latestText = '') {
  if (intent === 'WANTS_HUMAN') return true;
  if (intent === 'WANTS_COMFORT' || intent === 'WANTS_END') return false;
  // JTBD-02B P1-B/D5：纠正保护只对当前轮生效，不永久禁止真人交接
  if (latestText && correctionPatterns.some((pattern) => pattern.test(latestText))) return false;
  if (userTurnCount < 3) return false;
  // A user who is actively asking to clarify or work through a concrete next
  // step normally still has a useful AI-support path. Keep that protection
  // unless they explicitly say the current AI help has not worked; the latter
  // may still pass the complete, evidence-based handoff judgment below.
  if ((intent === 'WANTS_CLARITY' || intent === 'WANTS_ACTION') && !supportFeedback) return false;
  // A short-lived event and a single emotional impact do not establish that
  // human support is already more suitable than continuing the conversation.
  if (!hasSustainedHandoffEvidence(problemMap)) return false;
  return minimumSufficientJudgment(text, complexity, problemMap, sufficiency)
    && aiFurtherValue(text, complexity, problemMap, supportFeedback) === 'LOW'
    && humanHelpLevel(text, intent, complexity, problemMap, supportFeedback) === 'HIGH';
}

function routeFor(safety: SafetyStatus, text: string, intent: UserIntent, complexity: Complexity, sufficiency: number, assessment: AssessmentRecommendation, supportFeedback: string | null, handoffReady = false, issueContextText = ''): TriageRouting {
  if (safety !== 'NO_SIGNAL_DETECTED') return 'SAFETY_SUPPORT';
  // A general mentor handoff must not replace a concrete medication decision
  // that needs a prescriber or another qualified medical professional.
  if (isMedicationDecisionRequest(text, issueContextText)) return 'PROFESSIONAL_REFERRAL';
  if (intent === 'WANTS_HUMAN') return 'HUMAN_MENTOR';
  if (handoffReady) return 'HUMAN_MENTOR';
  if (isHumanHandoffDecline(text)) return 'AI_SUPPORT';
  if (professionalPatterns.some((pattern) => pattern.test(text)) && (!isUndecidedHumanHelpQuestion(text) || /心理治疗|精神科|药物|医疗|诊断|法律|律师|诉讼|投资建议|税务/.test(text))) return 'PROFESSIONAL_REFERRAL';
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

function strategyFor(routing: TriageRouting, intent: UserIntent, gaps: string[], assessment: AssessmentRecommendation, complexity: Complexity, selected?: DialogueStrategy) {
  if (routing === 'SAFETY_SUPPORT') return '先确认现实安全并提供当地紧急求助方向，暂停普通建议、测评与商业推荐';
  if (routing === 'PROFESSIONAL_REFERRAL') return '说明普通成长支持边界，提供合适的专业求助方向，不把 AI 结论当作诊断';
  if (routing === 'HUMAN_MENTOR') return '先做阶段性镜像和前端导诊摘要，说明为什么真人更适合，不再进入 D3 深度探索';
  if (intent === 'WANTS_COMFORT') return '具体回应用户已表达的处境，先陪伴和倾听，不急着给建议';
  if (assessment.needed) return `短镜像后说明测评用途，推荐${assessment.recommended_tool}，明确它只是辅助参考，不是诊断`;
  if (selected === 'PROVIDE_HELP') return '直接给一个眼下可执行的支持，不用固定提问收尾';
  if (gaps.length) return `短镜像后只推进一个最高价值缺口：${gaps[0]}`;
  if (selected === 'EMPATHIZE') return '用具体、克制的语言接住用户，不急着追问或给结论';
  if (selected === 'MIRROR') return '镜像用户已经说出的事实和感受，避免加入未经确认的解释';
  if (selected === 'QUANTIFY') return `只确认一个会改变支持方式的信息：${gaps[0] || '当前状态的强度'}`;
  if (selected === 'CLARIFY_FACT' || selected === 'CLARIFY_GOAL') return `只推进一个尚未确认且有实际价值的信息：${gaps[0] || '当前目标'}`;
  if (selected === 'CONTINUE') return '承接用户刚补充的内容，继续围绕当前困扰自然回应，不重复已确认事实';
  if (complexity === 'LIGHT') return '总结当前问题，给 1-3 个有针对性的轻量支持，不强行提问';
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
  if (intent === 'WANTS_END') return 'MIRROR';
  if (intent === 'WANTS_COMFORT') return 'LISTEN';
  if (assessment.needed) return 'ASSESSMENT';
  if (intent === 'WANTS_ACTION') return 'HELP';
  if (intent === 'VENTING') return supportFeedback ? 'MIRROR' : 'LISTEN';
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

export function analyzeConversation(latestText: string, contextText = '', options: IssueAnalysisOptions = {}): ConversationAnalysis {
  const text = latestText.trim();
  const allUserText = userTextOnly(text, contextText);
  const userTurnCount = Math.max(1, Math.min(200, Math.round(options.userTurnCount ?? userTurnCountFromContext(contextText))));
  const issueId = options.issueId || 'issue-current';
  const issueStatus = options.issueStatus || 'ACTIVE';
  const switchResult = options.newIssueDetected === undefined ? detectIssueSwitch(text, contextText, options.previousTopics) : { detected: options.newIssueDetected, confidence: options.newIssueConfidence ?? (options.newIssueDetected ? 0.9 : 0.12) };
  const handoffWasOffered = options.handoffOffered === true;
  const safety = options.safetyStatus || detectSafety(text);
  const intent = resolveConversationIntent(text, contextText);
  const deniedTopics = new Set(deniedTopicsForText(allUserText));
  const topics = Array.from(new Set([...(options.issueTopicTags || []).filter((topic) => topic !== 'OTHER' && !deniedTopics.has(topic)), ...classifyConcern(allUserText).filter((topic) => !deniedTopics.has(topic))]));
  const understanding = options.understanding || buildConversationUnderstanding([{ role: 'user', content: allUserText }], options.issueTopicTags || []);
  const problemMap = applyKnownFacts(buildProblemMap(allUserText, topics, intent), understanding);
  const complexity = determineComplexity(allUserText, topics, problemMap, safety);
  const gaps = buildInformationGaps(problemMap, understanding);
  const assessmentCandidate = chooseAssessment(allUserText, topics, complexity, problemMap.user_goal);
  const sufficiency = diagnosticSufficiency(problemMap, safety);
  const supportFeedback = /没用|没什么用|没帮助|更焦虑|不太有用|不适合/.test(text) ? '用户反馈当前帮助效果不足' : null;
  const preliminaryHandoffReady = safety === 'NO_SIGNAL_DETECTED'
    && (intent === 'WANTS_HUMAN' || (!handoffWasOffered && shouldOfferHuman(allUserText, intent, complexity, problemMap, sufficiency, supportFeedback, userTurnCount, text)));
  const routing = routeFor(safety, text, intent, complexity, sufficiency, assessmentCandidate, supportFeedback, preliminaryHandoffReady, contextText);
  const handoffReady = routing === 'HUMAN_MENTOR';
  // A question about human support is not consent to offer a booking CTA.
  // Keep the conversation on AI until the user explicitly chooses to book.
  const optionalHumanOffer = false;
  const showBookingButton = handoffReady || optionalHumanOffer;
  const assessment = handoffReady
    ? { needed: false, recommended_tool: null, reason: null }
    : assessmentCandidate;
  const minimumJudgment = minimumSufficientJudgment(allUserText, complexity, problemMap, sufficiency);
  const directHumanIntent = intent === 'WANTS_HUMAN';
  const humanIntent = isHumanHandoffDecline(text) ? 'DECLINED' as const : directHumanIntent ? 'EXPLICIT' as const : 'NOT_EXPLICIT' as const;
  const handoffMode = directHumanIntent ? 'DIRECT_HANDOFF' as const : handoffReady ? 'QUICK_HANDOFF' as const : 'NONE' as const;
  const furtherValue = aiFurtherValue(allUserText, complexity, problemMap, supportFeedback);
  const humanLevel = humanHelpLevel(allUserText, intent, complexity, problemMap, supportFeedback);
  const responseGoal = responseGoalFor(routing, intent, gaps, assessment, supportFeedback);
  const declinedHuman = isHumanHandoffDecline(text);
  const handoffState = declinedHuman ? 'DECLINED' as const : (handoffReady || optionalHumanOffer) ? 'OFFERED' as const : handoffWasOffered ? 'READY' as const : 'NOT_READY' as const;
  const nextQuestionCandidate = handoffReady ? null : chooseNextQuestion(gaps, text, problemMap);
  const questionValue = Number(questionValueFor(intent, nextQuestionCandidate, problemMap, userTurnCount, text).toFixed(2));
  // `ask_question` is a structured gap suggestion. `no_more_questions` is a
  // hard conversational boundary. Ordinary VENTING is allowed to receive one
  // useful, context-specific open question from the model even when no
  // predefined field question was selected; explicit comfort/end, safety,
  // professional and handoff paths remain non-questioning.
  const hardNoQuestionBoundary = handoffReady
    || routing === 'PROFESSIONAL_REFERRAL'
    || safety !== 'NO_SIGNAL_DETECTED'
    || intent === 'WANTS_COMFORT'
    || intent === 'WANTS_END'
    || options.controlIntent === 'PAUSE_TOPIC'
    || options.controlIntent === 'RESOLVE_TOPIC';
  const openQuestionRequested = !hardNoQuestionBoundary;
  const primaryResponseStrategy = selectDialogueStrategy({ routing, intent, assessment, supportFeedback, nextQuestion: nextQuestionCandidate, questionValue, problemMap, openQuestionRequested, latestText: text, responseGoal });
  const askQuestion = !handoffReady
    && responseGoal !== 'HANDOFF'
    && responseGoal !== 'HELP'
    && responseGoal !== 'ASSESSMENT'
    && intent !== 'WANTS_END'
    && Boolean(nextQuestionCandidate)
    && ['CLARIFY_FACT', 'QUANTIFY', 'CLARIFY_GOAL'].includes(primaryResponseStrategy)
    && questionValue >= 0.72;
  const noMoreQuestions = hardNoQuestionBoundary;
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
    next_question: nextQuestionCandidate,
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
    no_more_questions: noMoreQuestions,
    show_booking_button: showBookingButton,
    booking_button_text: showBookingButton ? '免费预约真人聊聊' : null,
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
    booking_preference: isHumanHandoffDecline(text) ? 'DECLINED' : intent === 'WANTS_HUMAN' ? 'ACCEPTED' : isUndecidedHumanHelpQuestion(text) ? 'INTERESTED' : 'NOT_EXPRESSED',
    safety_status: safety,
    routing_reason: routingReason(routing, complexity, problemMap, intent, assessment),
    reply_strategy: strategyFor(routing, intent, gaps, assessment, complexity, primaryResponseStrategy),
    tags: topics,
    route: routeForLegacy(routing),
    safety: safety === 'URGENT' ? 'urgent' : safety === 'NEEDS_CLARIFICATION' ? 'clarify' : 'normal',
    reasons,
    current_issue_id: issueId,
    new_issue_detected: switchResult.detected,
    new_issue_confidence: Number(Math.max(0, Math.min(1, switchResult.confidence)).toFixed(2)),
    user_turn_count: userTurnCount,
    issue_status: safety !== 'NO_SIGNAL_DETECTED' ? 'ACTIVE' : handoffReady ? 'HANDOFF_OFFERED' : declinedHuman ? 'ACTIVE' : options.controlIntent === 'PAUSE_TOPIC' ? 'PAUSED' : options.controlIntent === 'RESOLVE_TOPIC' ? 'CLOSED' : issueStatus,
    handoff_offered: handoffWasOffered || showBookingButton,
    control_intent: options.controlIntent,
    known_facts: understanding.known_facts,
    asked_fields: understanding.asked_fields,
    unresolved_fields: understanding.unresolved_fields,
    asked_questions: understanding.asked_questions,
    primary_response_strategy: primaryResponseStrategy,
    question_value: questionValue,
    help_progress: detectHelpProgress(text),
  };
}

export function resetForAwaitingTopic(analysis: ConversationAnalysis, previousIssueId: string | null): ConversationAnalysis {
  return {
    ...analysis,
    problem_map: {
      main_issue: null,
      issue_types: [],
      scene_summary: null,
      onset_duration: null,
      frequency: null,
      severity_score: null,
      functional_impacts: [],
      known_triggers: [],
      attempts: [],
      user_goal: null,
    },
    information_gaps: [],
    assessment: { needed: false, recommended_tool: null, reason: null },
    complexity: 'LIGHT',
    diagnostic_sufficiency: 0,
    routing: 'AI_SUPPORT',
    depth_level: 'D0',
    next_question: null,
    conversation_mode: 'LISTEN',
    response_goal: 'LISTEN',
    problem_clarity: 0,
    severity_level: 'UNKNOWN',
    ai_help_value: 1,
    human_help_value: 0,
    handoff_state: 'NOT_READY',
    handoff_mode: 'NONE',
    minimum_sufficient_judgment: false,
    human_intent: 'NOT_EXPLICIT',
    ai_can_help_now: true,
    ai_further_value: 'HIGH',
    human_help_level: 'LOW',
    reply_length: 'SHORT',
    ask_question: false,
    no_more_questions: true,
    show_booking_button: false,
    booking_button_text: null,
    booking_summary_ready: false,
    handoff_ready: false,
    conversation_state: 'LISTENING',
    primary_topic: 'OTHER',
    secondary_topics: [],
    user_intent: 'UNKNOWN',
    confirmed_facts: [],
    confirmed_goal: null,
    tentative_hypotheses: [],
    support_provided: [],
    support_feedback: null,
    routing_state: 'AI_SELF_HELP',
    booking_preference: 'NOT_EXPRESSED',
    safety_status: 'NO_SIGNAL_DETECTED',
    routing_reason: '用户想换个话题，等待新的困扰',
    reply_strategy: '自然邀请用户开始新的话题',
    tags: [],
    route: 'self_help',
    safety: 'normal',
    reasons: [],
    new_issue_detected: true,
    new_issue_confidence: 1,
    user_turn_count: 0,
    issue_status: 'AWAITING_TOPIC',
    handoff_offered: false,
    control_intent: 'SWITCH_TOPIC',
    issue_action: 'CREATE_NEW',
    previous_issue_id: previousIssueId,
    known_facts: {},
    asked_fields: [],
    unresolved_fields: [],
    asked_questions: [],
    primary_response_strategy: 'LISTEN',
    question_value: 0,
    help_progress: 'UNDETERMINED',
  };
}

export const emergencyReply = '我先不继续做普通建议了。你现在的安全更重要：请立刻联系身边可信任的人陪着你，尽快前往就近的医院急诊；如果存在迫在眉睫的人身危险，请联系当地紧急服务。你也可以只回复我一句：你现在是否已经安全、身边是否有人？';

export const safetyClarificationReply = '我想先确认一件重要的事：你现在有没有马上伤害自己或他人的打算，或者正处在会被伤害的环境里？你只需要回复“安全”或“有危险”即可；如果已经有迫在眉睫的危险，请先联系身边可信任的人和当地紧急服务。';
