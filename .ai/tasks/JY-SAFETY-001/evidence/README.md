# JY-SAFETY-001 真实验收证据

- 任务分支：`codex/jy-safety-001-20261031`
- 代码基线：`f743e19474ab307f5ad40934eb421b50f3bfc7ea`
- 安全规则实现提交：`63d87f4827e306236bef8cd58245f96150cfab1f`
- Staging：CloudBase 函数 `jieyou-v19-staging`，Pages 路径 `v19-staging`
- Staging API：`https://root-journey-prod-d4d7pzd0a8f805-1304965105.ap-shanghai.app.tcloudbase.com/jieyou-v19-staging`
- 本证据使用虚构测试内容；未调用付费 DeepSeek，未提交普通预约，未写入正式飞书或数据库。

## 证据映射

| 验收项 | 证据 | 结论 |
| --- | --- | --- |
| AT001 | `staging-api-2026-11-01.json`、`automation-regression.log` | PASS：危险表达和危险预约均被安全门禁拦截 |
| AT002 | `browser-e2e-2026-11-01.md`、`browser-chat-staging-2026-11-01.png`、历史 Staging 三入口记录 | PASS：三类入口均有记录；危险状态不放行 |
| AT003 | `browser-e2e-2026-11-01.md`、`browser-booking-staging-2026-11-01.png` | PASS：无风险用户进入预约页，未提交表单 |
| AT004 | `staging-api-2026-11-01.json`、`automation-regression.log` | PASS：疑问/矛盾陈述不解除，明确安全澄清可解除 |
| AT005 | `automation-regression.log`、`staging-api-2026-11-01.json` | PASS：85 项自动测试和受影响 Staging API 场景通过 |
| AT006 | `automation-regression.log` | PASS：类型、测试、CloudBase/Pages 构建及 Staging 隔离检查通过 |

## 限制

- 浏览器中的 AI 消息 CTA 复用 2026-10-31 已有 Staging 会话记录；本次未再次触发模型调用，避免付费 DeepSeek 调用。
- 未执行普通成功预约提交、状态回写或真实导师接待，因此没有新增飞书写入证据；危险预约的 409 证据见 API 记录。
- 截图由隔离浏览器采集，视觉分析服务本身未调用成功；页面结构以同一会话的可访问性快照为准。
