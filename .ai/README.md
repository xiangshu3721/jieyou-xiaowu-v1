# 解忧小屋｜JY-SAFETY-001 研发接管入口

本分支仅用于已经获用户批准的 P0「危机安全分流与真人预约快捷入口统一守门」任务。
本分支尚未合并或部署 Production。

## 接管文件（全部在本分支）
- [任务契约](tasks/JY-SAFETY-001/task.yaml)：R001–R006 / AT001–AT006 / 禁做事项 / 授权
- [研发协议](protocol/PROTOCOL.md)：XSH AI Dev Protocol V1.0
- [任务 Schema](schemas/task.schema.json)、[回执 Schema](schemas/result.schema.json)
- [校验器](tools/validate.py)、[依赖](tools/requirements.txt)

协议和工具文件从 `xiangshu3721/asva-workbench` 的 PR #57 源提交
`f5f05cbb287909de2e6fa6d799d9a70e9f5db56d` 原样复制，仅作为本任务研发协议。
这不会自动合并 ASVA 仓库中的 Draft PR。

## Codex 接管步骤
在本项目根目录，先保护本地未提交内容，之后：
```bash
git fetch origin codex/jy-safety-001-20261031
git switch --track origin/codex/jy-safety-001-20261031
python3 -m pip install -r .ai/tools/requirements.txt
python3 .ai/tools/validate.py task .ai/tasks/JY-SAFETY-001/task.yaml
```
若本地已有同名分支，使用 `git switch codex/jy-safety-001-20261031` 并确认对齐远程；
若切换被本地更改阻止，停止，勿强制 checkout/reset/clean/stash/drop。

仅在校验通过且核对代码与权限后实施；提交 `result.json` 并逐项附真实证据。
任务批准 ≠ Production 部署授权：不得改生产、写正式飞书、合并 main。
