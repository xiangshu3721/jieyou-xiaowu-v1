# JY-SAFETY-002 证据索引

记录时间：2026-11-03（Asia/Shanghai）

代码基线：`28c927fc680f8cd346324673427dbb82a6ecc486`

任务分支：`codex/jy-safety-002`

## 验收映射

- **AT001 / R001：PASS**
  - `automation-regression.log`：正式 Schema 校验、类型检查和 92 项测试。
  - `browser-e2e-2026-11-03.md`：本地浏览器中含“清空”措辞的消息进入普通发送流程，消息仍显示在聊天记录中；请求失败只显示错误，没有触发本地清空。
- **AT002 / R002：PASS（行为已完成；IndexedDB UUID 读取受工具能力限制）**
  - `automation-regression.log`：静态边界测试覆盖发送期间禁用清空、确认文案、清空后重新读取 Session/Issue 和两类失败提示；92 项测试全部通过。
  - `browser-e2e-2026-11-03.md`：全新隔离 in-app 浏览器中完成 Cancel、OK、刷新、发送新消息和发送期间按钮禁用的真实记录。
- **AT003 / R003：PASS（Staging 成功路径受隔离配置限制）**
  - `automation-regression.log`：成功、HTTP 错误、服务端未明确确认、网络失败四类本地 Mock 测试。
  - `staging-api-2026-11-03.json`：Staging 的学习存储关闭，虚构 session 删除请求返回 503；未写入真实学习数据。成功响应的明确确认由本地 Mock 覆盖。
- **AT004 / R004：PASS（按已执行范围）**
  - `automation-regression.log`：类型检查、全量 92 项测试、CloudBase/Pages 构建、Staging 隔离检查。
  - `staging-api-2026-11-03.json`：Staging health、普通真人意图安全门禁；未提交预约，不触碰正式飞书或生产数据库。

## 环境边界与剩余限制

- Staging function：`jieyou-v19-staging`；Pages 路径：`v19-staging`。
- Staging `learningConfigured=false`，所以不能用它证明远端学习删除成功路径；该路径只用本地 Mock 验证。
- 未调用付费 DeepSeek；未部署 Production；未写入正式飞书或生产数据库。
- 构建命令退出码均为 0，但 Wrangler 尝试写入用户目录日志时输出 EPERM 警告；这不影响本次构建产物生成，已在日志中保留。
- Staging 构建检查曾因两个会同时写 `dist/` 的构建命令并行执行而出现一次真实失败；随后按 CloudBase → Pages → verify 串行重跑，全部通过。该失败不代表代码或最终构建失败。
- 当前 CUA 浏览器接口只返回页面可见状态，不能直接执行页面 JavaScript 读取 IndexedDB；因此未记录真实 Issue UUID。脱敏记录使用 `jieyou-main-session`（代码固定的 Session ID）和“清空前旧 opaque Issue / 清空后新 opaque Issue”，并由 `src/client/storage.ts:34-42,237-243` 的实际逻辑与刷新后行为共同核对。
- 工作树中原有未跟踪 `docs/.DS_Store`、`docs/audit/` 未修改、未删除。
