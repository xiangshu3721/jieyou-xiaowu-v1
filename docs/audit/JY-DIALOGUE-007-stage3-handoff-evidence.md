# JY-DIALOGUE-007 阶段 3 真人交接证据

## 范围

- 基线 Production main：`823c209b971c619fc0227324c0c0977213f35df2`
- 本次只调整真人交接表达，不修改交接时机规则、Issue 生命周期、预约表单或飞书写入。
- 真实模型评测使用合成对话，未调用 Production 聊天，未写入飞书或数据库。
- 原始 DeepSeek HTTP 响应、解析状态、最终回复和 Fallback 判定保存在：[real-deepseek-handoff-evidence.json](../../.ai/releases/JY-DIALOGUE-007/evidence/real-deepseek-handoff-evidence.json)

## 真实 DeepSeek 评测

共执行 4 次，未重试：

| 样本 | 结果 | 最终控制状态 | Fallback | 结论 |
|---|---|---|---|---|
| S01 明确要求真人 | HTTP 200，JSON 解析成功 | `DIRECT_HANDOFF` / `OFFERED` / 显示入口 / 不提问 | 否 | 模型正常生成了简短真人交接表达 |
| S02 前两次有效表达 | HTTP 200，模型返回非 JSON | `NONE` / `NOT_READY` / 不显示入口 | 是，`parseAssistantOutput=null` | 服务端降级仍不提前导流 |
| S03 第三次满足条件 | HTTP 502，DeepSeek `internal_error` | 无最终 Handler 回复 | 否；解析未执行 | 原始上游错误已保存，未伪造成功结果，未重试 |
| S04 已推荐后继续聊天 | HTTP 200，模型返回非 JSON | `NONE` / `READY` / 不显示入口 | 是，`parseAssistantOutput=null` | 降级回复未重复推销真人 |

S03 的原始响应仅为上游错误 JSON，未产生模型内容，因此不能作为“快速交接真实模型话术通过”的证据。快速交接的用户可见话术由本地 Handler 契约测试覆盖，并保留为待后续独立验证项。

## 代码与 Handler 验证

- 明确要求真人：`show_booking_button=true`、`handoff_mode=DIRECT_HANDOFF`、`handoff_state=OFFERED`、`ask_question=false`、`no_more_questions=true`。
- 第三轮充分判断：`show_booking_button=true`、`handoff_mode=QUICK_HANDOFF`，话术引用当前 Issue 中明确的睡眠/工作影响，不使用“撑了很久”“一个人扛着”等无依据套话。
- 前两轮：保持 `AI_SUPPORT`，不展示预约入口。
- 已推荐后继续聊天：`show_booking_button=false`，不重复推销。
- 拒绝真人、新旧 Issue 隔离、安全及专业转介均由既有规则和契约测试覆盖，本次未改动。

## Staging 隔离检查

- Staging 函数：`jieyou-v19-staging`
- Staging health：HTTP 200，`deepseekConfigured=true`，`feishuConfigured=true`，学习/Growth 保持关闭。
- Staging CORS：HTTP 204，正式 Pages Origin 允许。
- Staging 安全门禁：危险样例返回 `allowed=false`、`safety_status=URGENT`。
- 未对 Staging 重新发起聊天请求，避免超过本轮 4 次真实 DeepSeek 上限；拒绝控制链路由本地 Handler 契约测试验证。

## 测试门禁

- 定向交接与 Handler 测试：81/81 通过。
- 全量测试：14 个文件、109 个测试通过。
- TypeScript：通过。
- CloudBase 构建：通过；Wrangler 日志写入存在既知 EPERM 警告，但构建产物正常生成。
- Staging 安全构建、发布控制检查：通过。
