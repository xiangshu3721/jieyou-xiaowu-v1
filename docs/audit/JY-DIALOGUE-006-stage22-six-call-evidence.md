# JY-DIALOGUE-006 阶段 2.2 六次真实 DeepSeek 对比证据

## 验证边界

- 基线 main：`7e03dade2770bd1cf26747a7f1ba725c3678a3c5`
- 候选 Prompt：阶段 2.1 自然表达规则 + 阶段 2.2 价值提问规则
- 候选聊天 Prompt SHA256：`27a4777d33ab594208251490d92d10eccc1b44ef0f12d48699a1772e637049d4`
- 模型：`deepseek-chat`
- 隔离调用：6 次，均 HTTP 200；未调用 Production，未写入飞书或数据库。
- 本附件保留每次完整用户可见 `reply` 和本次采集到的结构化分析字段，用于 ChatGPT/产品复核。

## T32-R3：短答“7”绑定既有严重程度问题

用户上下文：用户先说“最近总是焦虑”，回答上一条严重程度问题：“7”。

完整回复：

> 7分，已经挺压人了。这种焦虑有没有影响到你的睡眠、工作或日常生活？

结构化分析：

```json
{
  "user_intent": "VENTING",
  "ask_question": false,
  "next_question": "它现在有没有影响睡眠、工作、关系或日常生活？",
  "response_goal": "LISTEN",
  "primary_response_strategy": "CONTINUE",
  "information_gaps": ["日常功能影响", "持续时间", "用户希望先获得的帮助"],
  "unresolved_fields": ["duration", "functional_impact", "trigger", "attempts", "user_goal"],
  "show_booking_button": false,
  "safety_status": "NO_SIGNAL_DETECTED"
}
```

观察：没有重复询问“现在几分”，下一步聚焦到功能影响；模型可见回复保留了一个高价值问题。

## T06-R2：用户说“真的说不上来”

用户上下文：用户先说“一直在想自己到底想要什么”，在被追问后回答“真的说不上来”。

完整回复：

> 我先听着，也接住你刚才说的这部分。你可以按自己的节奏继续说，不必急着回答问题。

结构化分析：

```json
{
  "user_intent": "VENTING",
  "ask_question": false,
  "next_question": "如果今天只先看一件事，你最想先解决什么？",
  "response_goal": "LISTEN",
  "primary_response_strategy": "MIRROR",
  "information_gaps": ["主要问题/主诉", "严重程度与日常功能影响", "日常功能影响", "持续时间"],
  "unresolved_fields": ["severity_score", "duration", "functional_impact", "trigger", "attempts"],
  "show_booking_button": false,
  "safety_status": "NO_SIGNAL_DETECTED"
}
```

观察：结构化字段仍有缺口，但回复没有把缺口转成新的问题，尊重了“不知道”。

## T34-R1：单句“我就是觉得特别累”

完整回复：

> 嗯，那种特别累的感觉，有时候是身体被掏空，有时候是心里撑了太久。不用急着说清楚，你想从哪儿说起都行。

结构化分析：

```json
{
  "user_intent": "VENTING",
  "ask_question": false,
  "next_question": "如果今天只先看一件事，你最想先解决什么？",
  "response_goal": "LISTEN",
  "primary_response_strategy": "MIRROR",
  "information_gaps": ["主要问题/主诉", "严重程度与日常功能影响", "日常功能影响", "持续时间", "出现频率", "用户希望先获得的帮助"],
  "unresolved_fields": ["main_issue", "severity_score", "duration", "frequency", "functional_impact", "trigger", "attempts", "user_goal"],
  "show_booking_button": false,
  "safety_status": "NO_SIGNAL_DETECTED"
}
```

观察：没有追问，保留开放空间；“身体被掏空/心里撑了太久”属于表达性镜像，后续仍需关注是否被用户纠正。

## T03-R2：明确需要实际行动方案

用户上下文：用户先说“卡在一个工作选择上”，随后明确要求“该不该辞职，你能给我一个实际行动方案吗？”。

完整回复：

> 辞职这件事，先别急着做“走或留”的二选一，可以先拆成三步：
>
> 1. 写下你想离开的真正原因——是这份工作本身、某个具体的人，还是你对下一步没底？原因不同，方案完全不同。
> 2. 算一笔现实的账：手上有几个月的生活费缓冲？如果裸辞，最坏情况能撑多久？
> 3. 先做一个低成本试探：更新简历、投两三家、约一次行业里的人聊聊，看看外面的机会是不是比想象中好或差。
>
> 这三步走完，答案通常会清楚很多。你现在最想离开的原因，更偏向工作内容本身，还是人际和氛围？

结构化分析：

```json
{
  "user_intent": "WANTS_ACTION",
  "ask_question": false,
  "next_question": "它现在有没有影响睡眠、工作、关系或日常生活？",
  "response_goal": "CLARIFY",
  "primary_response_strategy": "CONTINUE",
  "information_gaps": ["严重程度与日常功能影响", "日常功能影响", "持续时间", "出现频率"],
  "unresolved_fields": ["severity_score", "duration", "frequency", "functional_impact", "trigger", "attempts"],
  "show_booking_button": false,
  "safety_status": "NO_SIGNAL_DETECTED"
}
```

观察：先提供具体行动支持，再问一个会明显改变方案的问题，没有只停留在共情。

## T37-R2：多次失望但未提供原因

用户上下文：用户先说“我感觉谁都靠不住”，随后说“我已经失望过很多次了”。

完整回复：

> 我先听着，也接住你刚才说的这部分。你可以按自己的节奏继续说，不必急着回答问题。

结构化分析：

```json
{
  "user_intent": "VENTING",
  "ask_question": false,
  "next_question": "如果今天只先看一件事，你最想先解决什么？",
  "response_goal": "LISTEN",
  "primary_response_strategy": "MIRROR",
  "information_gaps": ["主要问题/主诉", "严重程度与日常功能影响", "日常功能影响", "持续时间", "出现频率", "用户希望先获得的帮助"],
  "unresolved_fields": ["severity_score", "duration", "frequency", "functional_impact", "trigger", "attempts", "user_goal"],
  "show_booking_button": false,
  "safety_status": "NO_SIGNAL_DETECTED"
}
```

观察：没有把“失望过很多次”擅自解释为固定人格或关系原因，也没有为了聚焦而强行追问。

## T01-R2：明确只想被听见

用户上下文：用户先说“最近每天都很累，回家也不想说话”，随后明确说“我现在只想有人听我说，不想听建议”。

完整回复：

> 我先听着，也接住你刚才说的这部分。你可以按自己的节奏继续说，不必急着回答问题。

结构化分析：

```json
{
  "user_intent": "WANTS_COMFORT",
  "ask_question": false,
  "next_question": "如果今天只先看一件事，你最想先解决什么？",
  "response_goal": "LISTEN",
  "primary_response_strategy": "EMPATHIZE",
  "information_gaps": ["主要问题/主诉", "严重程度与日常功能影响", "日常功能影响", "持续时间"],
  "unresolved_fields": ["severity_score", "duration", "functional_impact", "trigger", "attempts"],
  "show_booking_button": false,
  "safety_status": "NO_SIGNAL_DETECTED"
}
```

观察：用户明确拒绝建议时没有继续导诊或给方案；结构化字段仍由服务端基线维护，不等于必须追问。

## 阶段性结论

- 提问数量：6 个样本中，倾诉/拒答/疲惫/关系失望样本均未出现可见追问；短答样本推进了一个功能影响问题；行动样本保留一个决策相关问题。
- 问题价值：没有重复询问“7 分”，没有把“不知道”改写成同一问题继续追问。
- 聚焦能力：行动样本先提供三步支持；其余样本根据用户目标停留在倾听或留白。
- 保留观察：结构化 `information_gaps` 仍可能较长，但本轮 Prompt 明确它不是必答清单；服务端规则、Schema 和 `ask_question` 裁决未修改。

## 最终证据核验（2026-11-06）

### 证据边界

现有六次记录保存了 HTTP 状态、`model`、`promptVersion`、最终用户可见 `reply` 和部分合并后 `analysis`。记录中没有保存：

- DeepSeek 原始响应正文；
- `parseAssistantOutput(raw)` 的返回值或成功/失败标记；
- `fallback_used`、最终回复分支标记或运行时日志。

因此，`model: "deepseek-chat"` 只能证明请求返回对象沿用了模型配置名，不能单独证明回复来自正常模型 JSON，也不能证明使用了 Fallback。对 T01、T06、T37 的来源只能标记为 `ORIGIN_UNVERIFIABLE`。

### 代码可确认的处理链路

- `server/rules.ts` 的 `analyzeConversation()` 计算服务端基线 `ask_question`。
- `worker/handler.ts` 调用 `parseAssistantOutput(raw)`，再调用 `mergeAnalysis(baseline, parsed)`；`mergeAnalysis()` 展开 `baseline`，没有用模型的 `ask_question` 覆盖基线字段。
- 安全状态正常时，`parsed` 非空走 `normalizeUserReply(parsed.reply, analysis)`；`parsed` 为空走 `fallbackReply(analysis, { allowQuestion: false })`。
- 当前 `server/structured.ts` 的 `fallbackReply()` 在 `!analysis.ask_question` 或 `allowQuestion === false` 时固定返回：

  > 我先听着，也接住你刚才说的这部分。你可以按自己的节奏继续说，不必急着回答问题。

  因此，在六条记录的 `safety_status=NO_SIGNAL_DETECTED` 且 `ask_question=false` 条件下，最终可见回复若不是上述固定文本，则可由当前 Handler 分支排除“服务端 Fallback”，判定为正常模型 JSON 回复；若恰好等于上述固定文本，则无法仅凭已保存记录区分“模型 JSON 也返回了相同文本”和“服务端 Fallback”。

### 六条核验结论

1. **T32-R3：正常模型 JSON 回复（代码可排除 Fallback）。** 记录的 `ask_question=false` 是服务端基线字段；最终回复包含“有没有影响到你的睡眠、工作或日常生活？”是已保存的用户可见文本。由于该文本不是 `ask_question=false` 时的固定 Fallback 文案，当前 Handler 路径表明它走了 `parsed` 正常回复分支；没有保存原始 JSON，无法进一步核对模型原始字段。
2. **T06-R2：`ORIGIN_UNVERIFIABLE`。** 最终文本与固定 Fallback 文案逐字相同；现有记录没有解析结果或分支标记，不能确认是模型 JSON 返回相同文本，还是解析失败后由 Fallback 生成。
3. **T34-R1：正常模型 JSON 回复（代码可排除 Fallback）。** `ask_question=false`，但可见回复为“嗯，那种特别累的感觉……”，不同于固定 Fallback 文案；按当前 Handler 分支可排除该条最终来自 Fallback。原始 JSON 仍未保存。
4. **T03-R2：正常模型 JSON 回复（代码可排除 Fallback）。** 记录的 `ask_question=false` 是服务端基线控制字段，不是最终回复文本的硬过滤器；该条最终回复包含决策相关问句，且不是固定 Fallback 文案，因此当前链路表明它走了正常 `parsed.reply` 分支。`normalizeUserReply()` 在该条件下没有通用的问号删除规则。
5. **T37-R2：`ORIGIN_UNVERIFIABLE`。** 最终文本与固定 Fallback 文案逐字相同；没有原始模型响应、解析标记或运行日志，不能进一步判定来源。
6. **T01-R2：`ORIGIN_UNVERIFIABLE`。** 最终文本与固定 Fallback 文案逐字相同；`WANTS_COMFORT` 会触发同一 Fallback 文案，但这仍不能证明本次运行实际进入了 Fallback 分支。

### 未找到的原始证据

在现有仓库证据和工作区临时目录中，未找到包含上述六个样本原始 DeepSeek 响应、解析结果或 Fallback 分支记录的文件。因此没有补造缺失字段，也没有重新调用 DeepSeek。
