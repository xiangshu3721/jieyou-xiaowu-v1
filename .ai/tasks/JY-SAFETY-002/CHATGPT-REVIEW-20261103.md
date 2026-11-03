# JY-SAFETY-002｜ChatGPT 独立复核（2026-11-03）

**状态：PARTIAL（未发放 VERIFIED；不授权发布 Production）**

审阅证据提交：`c1e824e7daaa34dca7ede967f2823fc3e537d087`  
实现提交：`de659b64f55d29a5498d48c732bb65022c5a1a82`  
原批准任务：`.ai/tasks/JY-SAFETY-002/task.yaml`（1.0.0，R001–R004 / AT001–AT004）

## 已确认

- R001 / AT001：正常输入文字不会因“删除”“清空”等词执行清空，发送函数删除分支已移除。
- R002 / AT002：独立浏览器测试记录称 Cancel 保留虚构消息 A，OK 后清空、刷新后保持空会话，可发送 B；`clearLocalMessages()` 在同一 IndexedDB 事务中清空消息并重建 Session/Issue，React 在成功后读取并重新绑定。精确 Issue UUID 未通过浏览器 API 直接读取；不虚报为直接读回。按钮在**普通 AI 发送**期间禁用。
- R003 / AT003：学习授权撤回与本地聊天删除已分离；成功/失败状态分离；Staging 学习存储关闭的 503 由本地 Mock 覆盖成功响应，不能据此声称真正的 Staging 云端成功删除已测试。
- R004 / AT004：留存日志显示 13 个测试文件、92/92 通过、类型检查通过，CloudBase/Pages 串行构建与 Staging 隔离校验最终通过；并行 dist 构建导致的一次真实校验失败已保留在日志中。未操作 Production/正式飞书/数据库。
- `result.json` 完整覆盖 AT001–AT004 且 `ready_for_release=false`，业务代码提交与证据提交 SHA 已区分。

## 未通过的已确认代码边界：预约快捷发送期间仍可清空

`src/client/main.tsx`：

- 第 414–428 行 `send()`：`wantsHumanBooking(content)` 的快捷分支在 `await ensureBookingIssueId()`、`await addMessage()`、`await moveToBooking()` 期间，**未调用 `setSending(true)`**。
- 第 493–494 行 `clearCurrentConversation()` 只以 `sending` 为保护条件。
- 第 557 行清空按钮的 `disabled={sending}` 也只覆盖普通 AI 发送。因此，快速真人预约发送尚在异步执行时，清空按钮仍可点击，若确认清空，后续写入/预约导航可能与重建 Session 交错。
- 此项目前为**代码审查发现的竞态风险**，不是已在真实浏览器复现的数据损坏；当前新增的 `deletion-flow.test.ts` 静态测试未覆盖真人快捷路径。

**判定：AT002 尚不能宣称包含所有发送途径的并发保护；JY-SAFETY-002 保持 PARTIAL。**

## 最小修复交接（已在本任务用户授权边界内）

只修改 `src/client/main.tsx` 和必要 `src/client/*.test.ts`：让真人快捷发送的整个异步过程也被同一个既有 `sending` 保护覆盖，确保成功/失败后均恢复可操作；不要引入新状态管理或后端接口。

仅补一项针对「真人快捷请求进行中 → 清空不可用 → 完成后恢复」的测试，回归现有 92 项、类型检查、隔离构建；如可以使用隔离浏览器，保存该快捷场景的真实记录。原有 Cancel/OK/刷新证据仍可复用，无须重跑所有浏览器流程。

按真实结果更新 `result.json` 与证据并推送原分支；未通过则保留 PARTIAL。不要改 `task.yaml`、不要合并 main 或发布 Production。完成后返回新 SHA 供最终复核。

## 保留边界

浏览器证据为 Codex 留存的执行描述而非 ChatGPT 亲自运行；本次没有原始 IndexedDB UUID 或独立真实服务端学习删除成功验收。上述限制如实记录，不要求额外开发调试基础设施。
