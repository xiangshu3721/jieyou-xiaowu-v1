# 解忧小屋 AI 接手规则

本文件只提供最小协作入口，不替代或放宽现有工程规则。开始前必须阅读：

1. [README.md](README.md)
2. [docs/TESTING.md](docs/TESTING.md)
3. [docs/FEISHU.md](docs/FEISHU.md)
4. [docs/release/t02-b1-release-control.md](docs/release/t02-b1-release-control.md)
5. 当前任务对应的 GitHub Issue、PR 和相关 `ai/` 规则文件

## 协作边界

- GitHub Issues 是任务交接载体；PR 是变更载体。不要另建任务系统。
- 只执行 Issue 明确范围；需求不清、事实冲突或需要改变发布/安全边界时先回到 Issue 澄清。
- 开始前核对当前分支、基线 SHA、工作区状态和发布配置。发现脏工作区、冲突或未知外部状态时停止相关写入，保留现场，不 reset、clean、checkout 覆盖。
- 所有完成回执写清 Issue/PR、commit SHA、改动文件、运行命令、测试结果、未验证能力、阻断和偏差。

## 测试与发布保护

- 代码改动至少按项目现有规范运行 `npm run typecheck`、`npm test` 和适用的构建/验证脚本；不要把未运行的命令写成通过。
- `npm run e2e:real` 会真实调用 DeepSeek、写入飞书并留下联调记录，除非 Issue 和用户明确授权，不得运行。
- 正式 Pages 发布必须遵守 [T02-B1 发布控制](docs/release/t02-b1-release-control.md)：完整 40 位 SHA、后端 smoke/Production health 核对、手动 workflow；不以普通 push 代替发布控制。
- 本文件不授权 `npm run deploy:cloudbase`、CloudBase/Pages 发布、真实飞书写入、生产配置修改、合并或删除数据。生产动作必须单独授权并附真实证据。
- 不提交 API key、token、密码、Cookie、真实用户资料或未脱敏日志。敏感信息一旦出现，停止扩散并报告。

## 交付判断

- 代码通过测试不等于真实模型、飞书、Production 或人工验收通过。
- Mock、HTTP 200、截图或执行者自填 PASS 不能单独证明生产可用。
- FAIL、BLOCKED、NOT_TESTED 和未核验的生产状态必须原样保留。
- 历史任务、取消/暂停状态和既有安全保护不可被新任务自动覆盖。

## 当前阶段默认权限

只读核查、文档修改、独立分支、自动化测试和 PR 默认允许；合并、发布、生产写入和真实外部联调默认禁止。
