zsh:1: no matches found: repos/xiangshu3721/jieyou-xiaowu-v1/contents/.ai/tasks/JY-SAFETY-002/evidence/production-release-2026-11-03.md?ref=codex/jy-safety-002
# JY-SAFETY-002 Production 发布回执

记录时间：2026-11-03（Asia/Shanghai）  
发布范围：仅 Production 后端函数 + GitHub Pages 前端  
正式代码 SHA：`171e1f606d7294ad3e46dd45cb0c5e911e7a4b1e`

## 发布前门禁

- `git rev-parse origin/main` 与候选 SHA 一致。
- Production API：`https://root-journey-prod-d4d7pzd0a8f805-1304965105.ap-shanghai.app.tcloudbase.com/jieyou-http-api`
- 发布前 health：HTTP `200`，`service=jieyou-xiaowu-v1`，`promptVersion=v1.7.0`，`deepseekConfigured=true`，`feishuConfigured=true`，`learningConfigured=false`，`growthConfigured=false`。
- Production 函数：`jieyou-http-api`，函数 ID `lam-plqehwo9`，原状态 `Active/Available`，原版本 `$LATEST`，原修改时间 `2026-10-31 07:54:05`。
- HTTP 服务路径：`/jieyou-http-api`，未改变。
- 候选归档的 typecheck、93 项测试、release-control 和 staging guard 均通过；未运行组合部署脚本。

## 后端发布

使用 CloudBase CLI 仅执行函数代码更新：

```text
tcb fn code update jieyou-http-api --dir /private/tmp/jy-safety-002-prod-171e1f6/cloudbase/functions/api --json
```

结果：`Code updated`。未执行 `npm run deploy:cloudbase`，未部署 CloudBase 静态托管，未修改环境变量、正式 Feishu、学习或 Growth 配置。

发布后函数状态：`Active/Available`，`FunctionVersion=$LATEST`，修改时间 `2026-11-03 19:41:54`。候选 bundle 与 Production 下载回读的 `cloudbase/functions/api/index.js` SHA256 均为：

```text
78fb10e56ec4125a8326f3722f0cf81e880dafa702f0b1531939e1de20d66d2f
```

## 后端烟测

时间约为 `2026-11-03 19:42:14–19:42:15`（UTC 请求日志；本地为 19:42:14–19:42:15 +08:00）。虚构 Issue ID 仅用于安全门禁请求，没有预约提交。

| 检查 | 真实结果 |
|---|---|
| `GET /api/health` | HTTP `200`；`ok=true`；`service=jieyou-xiaowu-v1`；`promptVersion=v1.7.0`；配置状态与发布前一致 |
| `POST /api/safety-gate` 危险表达 + 真人请求 | HTTP `200`；`allowed=false`；`safety_status=URGENT` |
| `POST /api/safety-gate` 普通真人请求 | HTTP `200`；`allowed=true`；`safety_status=NO_SIGNAL_DETECTED` |
| 预约提交 / 飞书写入 | 未执行 |

## 前端 Pages 发布

- Workflow：[`Release Production Pages #41629724809`](https://github.com/xiangshu3721/jieyou-xiaowu-v1/actions/runs/41629724809)
- 触发方式：`workflow_dispatch`，`ref=main`。
- 输入：`release_sha=171e1f606d7294ad3e46dd45cb0c5e911e7a4b1e`、`backend_version=v1.7.0`、`backend_smoke_confirmed=CONFIRMED`。
- 结果：`success`；Job `125895921416`；精确 SHA、质量检查、生产构建、Production API 版本门禁和 Pages 部署全部通过。
- 正式地址：[`https://xiangshu3721.github.io/jieyou-xiaowu-v1/`](https://xiangshu3721.github.io/jieyou-xiaowu-v1/)
- 线上首页：HTTP `200`；最后修改时间 `2026-11-03 11:43:58 GMT`。
- 线上 JS 资产已确认包含 Production API base、`我想找真人聊聊`、`真人导师` 和安全检查逻辑。浏览器隔离标签已加载页面，标题为“解忧小屋”；未发送聊天、未点击提交。

## 回滚点

发布前已只读下载 Production `$LATEST` 到隔离临时目录：

`/private/tmp/jy-safety-002-prod-rollback-171e1f6`

旧工件 SHA256：

```text
30231bb510a1fecc02421121d35c745bae559c898c61609afc6f855d6b8b0783  index.js
8005a3491db7d92f36ac66369861589f9c47123d3a7c71e643fc2c06168cd45a  package.json
b987a47ccb3466bacbef92de537a808572060cc3b75bc776b82281a5bbea2585  scf_bootstrap
```

CloudBase 没有返回已发布的正整数版本，当前回滚点是函数 ID `lam-plqehwo9` 的部署前 `$LATEST` 代码工件及其脱敏元数据。若需回滚，应使用该工件通过同一 Production 函数代码更新命令恢复，然后重新执行 health 与安全门禁烟测；不得删除数据库表或用户数据。前端回滚点为 Pages deployment history 中本次之前的成功发布：SHA `861a446847f032dece7927ba358eb9f1c311fa75`，回滚仍须通过同一 `Release Production Pages` workflow。

## 限制与结论

- 本次未提交真实预约，未写入正式 Feishu 或生产数据库。
- 未调用付费 DeepSeek 聊天，仅验证首页、Production health、安全门禁和不写入的真人入口资产；匿名聊天的真实模型回复未纳入本次证据。
- 未修改学习、Growth 或飞书正式配置；Production health 仍明确显示 `learningConfigured=false`、`growthConfigured=false`。
- 正式发布链路已完成：候选 SHA 的后端代码已生效，Pages 同 SHA 发布成功，安全门禁联合烟测通过。
