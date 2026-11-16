# 本土案例 Prompt 候选试验 V1（不允许直接发布）

## 本次最小改动
- 只增加一份约 1.5k 中文字的 **10 组候选示范**：`ai/examples/candidate-prompt-v1.md`。
- 仅调整 `worker/prompts.ts` 和 `server/prompts.ts` 的 `chat` Prompt 加载；不改分类器、路由、安全、预约、Issue、飞书和 API。
- 独立实验分支：`experiment/cn-dialogue-prompt-v1`。独立数据源 PR #44：完整 45 条训练 + 15 条盲测，不随聊天请求发送。
- 示例经过一次文本审查、移除明显的动机臆测；**尚未经 ASVA 导师确认，不能把示范视为认证咨询话术**。

## 验证规则
1. GitHub Quality Gate：TypeScript、Vitest、前端和 CloudBase build 应通过；静态测试校验 Worker/Node Prompt 完全一致，案例只注入 chat。
2. 真实 DeepSeek A/B **仍待执行**：使用现有 `/dev`、`ai/test-cases.json` 和 PR #44 的 15 条独立盲测；两个候选版本采用相同模型参数与相同 Issue 上下文，保存去标识的输出、延迟、是否重复追问、事实准确性、行动有效性、导诊与安全表现。
3. 盲测不得加入实时 Prompt，不得为了跑测试修改期望答案；至少复核新/旧话题切换、短答“7”、明显换问题、拒绝真人、主动预约、即时危险、专业转介。
4. 本 PR 没有调用真实 DeepSeek 或任何真实用户对话；GitHub Quality Gate **不等于**真实模型测试。
5. 不执行 `npm run e2e:real`：该脚本会写入真实飞书预约测试记录。
6. 导师审核及盲测满意后，仍需单独授权合并和生产 CloudBase 发布。

## 成功/失败判断
- 回复更自然、更少无意义问题，用户已表达的事实不被误读，用户要实用方案时能获得一项具体支持。
- **任一**安全/专业转介/真人按钮/Issue 隔离回归失败都不发布；响应显著变慢则缩减示范数量。
- 暂停的自动学习引擎 PR #41 继续保持暂停，不作为本次依赖。
