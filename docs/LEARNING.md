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
