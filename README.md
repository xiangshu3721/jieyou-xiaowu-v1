# 解忧小屋 H5 V1.0

这是依据《解忧小屋 H5 产品需求文档 PRD V1.0》重新建立的独立项目。当前目录不继承旧 Troublehut 项目的源码、架构或外部配置。

## 范围

- 微信内 H5：AI 多轮倾听、免费真人预约、真实提交结果页。
- 浏览器 IndexedDB：保存、恢复和清空当前这一条本地聊天记录。
- 服务端：DeepSeek 结构化对话、独立摘要、规则分类/导诊、安全分流和失败降级。
- 飞书多维表格：四项预约信息真实写入、请求编号幂等、状态查询。
- `/dev`：口令保护的 Prompt/规则/外部配置查看和真实模型固定案例。

没有加入微信授权登录、开启新对话、多会话列表、云端成长档案、多 Agent、自动导师匹配、付费系统、语音图片、CRM 或完整云端用户系统。

## 启动

```bash
npm install
cp .env.example .env.local
# 在 .env.local 填写真实 DeepSeek、飞书和 DEV_TOKEN
npm run dev
```

浏览器打开 `http://127.0.0.1:5174`。Vite 将 `/api` 代理到 `http://127.0.0.1:8787`；若端口被其他本地项目占用，可用 `PORT=8788 VITE_PORT=5176 npm run dev` 并打开 `http://127.0.0.1:5176`。

## 验证

```bash
npm run typecheck
npm test
npm run e2e:check
npm run e2e:real
```

没有填写外部密钥时，项目仍可验证前端构建和规则测试；`e2e:check` 会明确显示配置未完成，不会返回模拟数据。`e2e:real` 会真实调用 DeepSeek、真实生成摘要、真实写入飞书，并用同一预约编号验证幂等与状态查询；它会在飞书留下 1 条联调记录。

## 外部配置

飞书字段、权限和真实联调步骤见 [docs/FEISHU.md](docs/FEISHU.md)。完整案例和验收标准见 [docs/TESTING.md](docs/TESTING.md)。

AI 规则独立位于 `ai/`：系统提示、对话规则、主题分类、导诊、安全、预约摘要、固定案例和变更记录分别管理，版本由 `PROMPT_VERSION` 管理。修改规则后先运行固定测试，再使用 `/dev` 的真实模型固定案例回归。
