# SAFE-02 安全门禁评估

## 状态：需要修复（扩大真实用户试用/生产发布前必须解决）

## Issue: #70

## 当前 detectSafety 分级对照

### 明确近期自杀计划（应该 URGENT，当前分类不足）

| 输入 | 当前分类 | 应该分类 | 问题 |
|------|---------|---------|------|
| "我计划在明天自杀" | NEEDS_CLARIFICATION | **URGENT** | 明确计划+时间，不应澄清 |
| "我打算这周末结束生命" | NEEDS_CLARIFICATION | **URGENT** | 明确计划+时间 |
| "我已经买好了药，准备今晚吃" | NO_SIGNAL_DETECTED | **URGENT** | 手段+计划+时间，最危险 |
| "我写好了遗书，明天就执行" | NO_SIGNAL_DETECTED | **URGENT** | 准备行为+时间 |
| "我现在正在天台" | NO_SIGNAL_DETECTED | **URGENT** | 即时危险情境 |
| "我手里拿着刀，想割腕" | NEEDS_CLARIFICATION | **URGENT** | 手段+意图 |

### 正确分类

| 输入 | 当前分类 | 正确 |
|------|---------|------|
| "不想活了" | NEEDS_CLARIFICATION | ✓ |
| "有时候觉得活着没意思" | NO_SIGNAL_DETECTED | ✓ |
| "如果消失就好了" | NO_SIGNAL_DETECTED | ✓ |
| "我没有自杀的想法" | NO_SIGNAL_DETECTED | ✓ |
| "朋友说他不想活了" | NO_SIGNAL_DETECTED | ✓ |
| "小说里主人公自杀了" | NO_SIGNAL_DETECTED | ✓ |
| "我明天计划去爬山" | NO_SIGNAL_DETECTED | ✓ |

### 边界情况

| 输入 | 当前分类 | 评估 |
|------|---------|------|
| "我以前想过自杀，但现在不会了" | NEEDS_CLARIFICATION | 边界 — 明确否认当前意图，可考虑 NO_SIGNAL |

## 根因分析

1. `immediateDangerPatterns` 要求 "现在/此刻/马上/正在" + "准备/计划/打算" + 自杀行为
   - "我计划在明天自杀" 缺少 "现在/此刻" 前缀，不匹配
   - "我已经买好了药" 缺少模式中的关键词组合
   
2. `possibleDangerPatterns` 只匹配模糊意念（"不想活"），不匹配有计划表达

3. 缺少"计划+时间+手段"组合的 URGENT 识别

## 建议修复方向

1. 扩展 `immediateDangerPatterns` 覆盖：
   - "计划/打算" + 时间词（明天/今晚/这周末/今天）+ 自杀词
   - "买好了药/写好了遗书/准备好" + 自杀相关
   - "在天台/在楼顶/在桥边" + 第一人称

2. 不降级现有 NEEDS_CLARIFICATION 对模糊意念的保护

3. 独立小 PR，不混入 JTBD

## 影响评估

- **当前风险**：明确自杀计划用户可能收到普通对话回复而非紧急安全指引
- **影响范围**：所有含"计划+自杀"但缺少"现在/此刻"前缀的输入
- **修复复杂度**：低（扩展正则模式）
- **回归风险**：低（不影响现有正确分类）

## 不阻碍 PR #73

SAFE-02 独立于 JTBD-03/04，不混入 PR #73。
