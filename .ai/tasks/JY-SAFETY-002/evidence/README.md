# JY-SAFETY-002 证据索引

记录时间：2026-11-03（Asia/Shanghai）

代码基线：`28c927fc680f8cd346324673427dbb82a6ecc486`

任务分支：`codex/jy-safety-002`

## 验收映射

- **AT001 / R001：PASS**
  - `automation-regression.log`：正式 Schema 校验、类型检查和 91 项测试。
  - `browser-e2e-2026-11-03.md`：本地浏览器中含“清空”措辞的消息进入普通发送流程，消息仍显示在聊天记录中；请求失败只显示错误，没有触发本地清空。
- **AT002 / R002：BLOCKED**
  - `automation-regression.log`：静态边界测试包含确认文案和清空后的重新读取逻辑。
  - `browser-e2e-2026-11-03.md`：真实观察到原生确认框；取消后消息仍在。未执行“确认删除”这一会实际删除本地记录的图形界面动作，因此确认后的清空、重建 Session/Issue 和清空后新消息未取得完整浏览器证据。
- **AT003 / R003：PASS（Staging 成功路径受隔离配置限制）**
  - `automation-regression.log`：成功、HTTP 错误、服务端未明确确认、网络失败四类本地 Mock 测试。
  - `staging-api-2026-11-03.json`：Staging 的学习存储关闭，虚构 session 删除请求返回 503；未写入真实学习数据。成功响应的明确确认由本地 Mock 覆盖。
- **AT004 / R004：PASS（按已执行范围）**
  - `automation-regression.log`：类型检查、全量 91 项测试、CloudBase/Pages 构建、Staging 隔离检查。
  - `staging-api-2026-11-03.json`：Staging health、普通真人意图安全门禁；未提交预约，不触碰正式飞书或生产数据库。

## 环境边界与剩余限制

- Staging function：`jieyou-v19-staging`；Pages 路径：`v19-staging`。
- Staging `learningConfigured=false`，所以不能用它证明远端学习删除成功路径；该路径只用本地 Mock 验证。
- 未调用付费 DeepSeek；未部署 Production；未写入正式飞书或生产数据库。
- 构建命令退出码均为 0，但 Wrangler 尝试写入用户目录日志时输出 EPERM 警告；这不影响本次构建产物生成，已在日志中保留。
- 工作树中原有未跟踪 `docs/.DS_Store`、`docs/audit/` 未修改、未删除。
