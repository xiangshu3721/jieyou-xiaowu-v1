# 内部导师试用与 GitHub Pages 发布核验记录（2026-11-28）

> STATUS: PUBLIC_PAGES_EXISTS / LATEST_RELEASE_NOT_PERFORMED / STAGING_URL_NOT_VERIFIED
> 本文记录可用已知入口、实际核验、反馈方式和下一步发布闸门，不是“新版本发布成功”的证明。

## 1. 已验证的事实

- 已存在公开 Pages 地址：https://xiangshu3721.github.io/jieyou-xiaowu-v1/ 。2026-11-28 公开页面可读取并显示“解忧小屋”首页。
- GitHub Actions 最近一次可核对的 **Release Production Pages** 成功 run #44845624287（2026-11-21 UTC），head SHA：\`9ab03cf9f4b139934150bd030a1b53e0f3a3985a\`。
- 远端当前 \`main\` 为 \`f12abcc667659fbc29699b86c5ab9906c7816c03\`；包含后续安全/离线测试合并成果，但不等于后端/Pages 已部署。
- 历史 Staging 自述版本 \`759c72f\` 有较新的非指令式/开放提问补丁，但用户随后提供了“明确要求提问却未提问”的体验失败案例；当前本轮尝试读取 Staging 页面返回 404，**不能宣称它可用或已核验**。
- \`.github/workflows/deploy-pages.yml\` 为**显式 workflow_dispatch**，必须传入 40 位 \`release_sha\`、生产后端 \`promptVersion\` 和 \`backend_smoke_confirmed=CONFIRMED\`；不会因在 main 上提交文档自动发布。
- 正式 Pages 前端请求指向 CloudBase 的 production \`jieyou-http-api\`；不能假设 Pages 可直接切换到 Staging 后端而不受 CORS/凭据/稳定性影响。
- GitHub 文档设计 Draft PR #78 只包含 Markdown，**V3 架构没有实现**，不可将该 PR 当作可发布产品版本。

## 2. 内部导师试用的合理起点

**现在即可分享的已有正式旧版页面**：https://xiangshu3721.github.io/jieyou-xiaowu-v1/

但先限定为**小范围、有意识的试用，优先使用虚构情境**，不建议直接投入真实咨询客户数据。试用者需知道：该页面不是 V3 功能；聊天表现可能与正在设计的导师规则不一致，碰到安全/专业话题应按现实专业流程判断，不能把 AI 输出当咨询或诊断。

**目标是收集设计与体验证据，不是从用户数据中偷偷训练模型**。

## 3. 内测反馈模板（不存储真实对话原文）

- 测试编号、设备与浏览器、日期、测试环境（正式 Pages / 新 Staging）；
- 使用虚构场景的编号或自己编写的非敏感复现步骤；
- 预期行为、实际行为摘要、影响等级 P0/P1/P2；
- 归属候选模块（身份 / 方法 / JTBD / 动作 / 表达 / 校验 / 发布）；
- 是否允许保留提交的**特定**反馈文本；不要在公开 Issue 填写真实个人隐私；
- 一次反馈只归类一条主要缺陷，保留相似案例聚合依据。

## 4. “最新可用版”公开内测发布门槛

1. 明确**候选代码 SHA 和来源**，核对最新 Staging 热修成果是否已在安全独立分支/PR 中受控保存；不能把过时的 main 当成最新 Staging。
2. 候选前后端 API 合同与 CloudBase production 模型兼容；若需更新后端，先完成已授权的 CloudBase 备份/部署/Health、CORS、虚构聊天和安全/真人 smoke。
3. 通过 Release Production Pages 原有质量门禁精确发布同一 SHA，附 Actions run ID，浏览器实际验收手机/电脑；不得修改工作流绕过后台核验。
4. 若目的是让导师评估**尚未上线的新策略**，更适合使用受保护或清楚标识的 Staging/preview 环境，避免正式用户混淆；经单独验收后再推至正式 Pages。
5. 发布后更新本文件：实际 commit、前/后端版本、Actions URL、真实 HTTP/浏览器 Smoke、回滚点、未验证项，才允许将状态改成 RELEASED。

## 5. 本次未做

没有触发新的 Pages/CloudBase 部署，没有变更生产 Prompt、模型、飞书、预约或业务用户数据；也没有自动采集训练样本。不能把“网页可打开”写成“真实模型聊天完整通过”。

## 6. 下一步

- 内部导师可先打开现有正式 Pages，采用虚构测试案例，人工填写脱敏反馈。
- 需要发布更新版时，先完成代码基线/服务端验证和受控工作流；实际部署结果必须单独记录。
