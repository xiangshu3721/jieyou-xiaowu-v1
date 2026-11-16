# V1.5A 学习数据中心

V1.5A 只做可审计的匿名学习闭环，不做模型微调、自动改 Prompt、自动改规则或自动上线。

## 数据边界

- 默认不发送学习数据；聊天仍只保存在用户浏览器 IndexedDB。
- 用户勾选“允许匿名使用本次对话帮助改进解忧小屋”后，才发送匿名结构化指标。
- 用户授权后，页面离开时才会尝试发送最近一段脱敏对话给 Conversation Reviewer。服务端会再次脱敏，复盘结果只保存结构化评分和简短改进建议。
- 姓名、手机、邮箱、身份证号、微信号和地址等会在服务端脱敏；复盘不生成诊断或用户画像。
- 用户清空本次对话时，会同时请求删除该匿名会话的事件、指标和复盘数据；网络不可用时，浏览器本地聊天仍会先清除。

## API

- `POST /api/learning/events`：匿名结构化事件。事件类型包括 `chat_turn`、`booking_cta_shown`、`booking_clicked`、`summary_generated`、`summary_edited`、`session_end`、`learning_consent_updated`。
- `POST /api/learning/review`：仅在显式授权后调用，服务端脱敏并调用 Reviewer Prompt。
- `POST /api/learning/session/delete`：按浏览器持有的随机学习会话标识删除该会话的学习数据。
- `GET /api/learning/dashboard`：需要 `X-Dev-Token`，返回匿名指标、近期洞察和待人工审核候选规则。
- `POST /api/learning/insights/run`：需要 `X-Dev-Token`，只根据样本生成候选规则。
- `POST /api/learning/mentor-feedback`：需要 `X-Dev-Token`，记录人工导师对 AI 判断、摘要和交接时机的反馈。

## 审核边界

候选规则带有样本量、证据、预期效果、潜在风险和回归案例，状态默认为 `PENDING_HUMAN_REVIEW`。任何候选规则都不会自动写入 `ai/*.md`，安全边界、隐私边界、诊断边界和紧急响应规则不会进入自动学习修改范围。

本地开发时使用 `data/learning/*.jsonl`，该目录已加入 `.gitignore`。CloudBase HTTP 云函数配置 `CLOUDBASE_APIKEY` 后使用当前环境的 PostgreSQL 服务端 API；未配置时不会影响聊天，但学习 API 返回 `LEARNING_STORE_UNAVAILABLE`。

后台入口：`/admin/learning`。它只提供前端操作界面，所有数据接口仍由服务端 `DEV_TOKEN` 保护。

生产发布前必须在服务端环境变量中配置 `CLOUDBASE_APIKEY` 和 `DEV_TOKEN`；部署脚本会在缺少任一项时停止，避免发布一个聊天可用但学习数据无法落地的半成品。

## V1 受控经验回流（候选，不代表已生产启用）

复用现有学习数据中心，不增加新的客户身份系统、模型微调、私密原文案例库或后台自动部署。

最小闭环：用户明确授权 → 浏览器发送匿名指标和脱敏对话复盘 → 在服务端只保存结构化评价 → 管理员按指标运行洞察 → 形成候选经验 → 回归测试与人工审核 → 独立灰度开关下用于后续普通导诊 → 观察指标及可撤回。

**首版仅允许一种预设的、无用户原文的汇总经验**：最近会话出现过度提问趋势时，减少重复追问、优先镜像已知事实。系统不会把 Reviewer 的自由文本、私人案例或未审核的候选规则插入实时 Prompt。成功案例的通用策略提炼属于下一阶段，待评价质量和隐私保护验证后再推进。

### 审核与启用

1. 打开 `/admin/learning`，读取看板、运行洞察（测试期用虚构会话，不触碰真人预约）。
2. 对候选经验跑完列出的固定测试；按「回归通过，批准灰度」填写验收依据并确认；同一页面可拒绝/撤回。
3. **新环境变量 `LEARNING_APPLY_ENABLED=true` 才会让已批准的预设经验参与普通 AI 对话**。默认关闭，生产环境不得由候选审核动作自动打开。先灰度/测试环境验证，再按独立发布流程发布。
4. 运行时只对 `AI_SUPPORT` 且未显示预约入口的正常回复添加低优先级建议；高危、需澄清、明确真人交接、Issue 恢复与核心安全规则保留原有优先级。
5. CloudBase 对获准经验做最多 60 秒的只读缓存，学习数据库异常时直接忽略新经验、不阻断对话。撤回后缓存最多延迟 60 秒失效；要立即停用可将开关设回 `false` 并完成受控发布。
6. 通过 `GET /api/learning/dashboard`（`X-Dev-Token`）核验候选状态。 `POST /api/learning/candidates/decision`（同样需口令）接收 `{candidateId,decision,note,testsPassed}`；决定为 `APPROVED_FOR_GRAY` 时需要 `testsPassed:true` 和至少八字验收依据。仅支持 `REJECTED` 回滚，禁止直接改为 `RELEASED`。

### 必须回归的边界

- 没有授权的会话不产生学习记录，删除请求仍然生效。
- 无开关/无人工审核/候选被拒绝时，新的导诊不引用经验。
- 有开关、有人审、预设模式匹配时才低优先级应用；不能影响 Issue 恢复、紧急安全、拒答、预约导流。
- 学习存储暂时不可用，聊天保持原有行为与时延；禁止把真实用户聊天或受控信息放入 GitHub 测试证据。
- 此 V1 没有可信的「效果自动证明」；要先收集固定用例和导师标注的前后对比，再考虑自动总结优质对话策略。
