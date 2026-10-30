# T02-B1 正式发布控制与回滚机制

## 发布边界

正式 GitHub Pages 只允许通过 `Release Production Pages` 的 `workflow_dispatch` 发布。发布输入必须是完整 40 位 Git commit SHA；Workflow checkout 后再次比对 `git rev-parse HEAD`，不一致立即失败。发布还必须输入后端 Smoke Test 确认和 Production `/api/health` 的 `promptVersion`；健康检查不匹配时不会构建或部署前端。

该 Workflow 只发布前端，不自动部署 CloudBase 后端。Staging 仍使用 `jieyou-v19-staging` 和 `/v19-staging/`，不会触发正式 Pages 发布。

## 发布顺序

正式发布前，人工确认：

1. 读取当前 Production API health、函数状态和当前前端版本。
2. 保存当前后端版本、部署产物位置和脱敏配置快照。
3. 检查新 API 对当前前端的兼容性。
4. 通过受控 CloudBase CLI 部署经过批准的后端版本。
5. 执行 API health 和接口 Smoke Test。
6. 在 GitHub Actions 中以同一 commit SHA 手动发布前端。
7. 完成前后端联合验收，并记录 SHA、版本和回滚点。

如果第 3 步无法证明兼容，停止发布，先提供兼容过渡方案。

## 回滚

前端回滚：从 GitHub Pages deployment history 识别上一个正常版本，重新以对应完整 SHA 手动运行发布 Workflow；Workflow 会重新执行全部质量检查。

后端回滚：使用部署前保存的 CloudBase 函数版本或对应代码提交，重新部署到原 Production 函数，然后重新执行 health 和 Smoke Test。配置快照仅用于恢复环境变量，不能被误认为代码回滚已经完成。

回滚过程中不删除数据库表、不删除用户数据、不执行破坏性迁移。

## 首次切换操作

1. 先提交并审查本 Workflow 变更。
2. GitHub 管理员确认 `main` 的 Branch Protection 已要求 `Quality Gate / quality` 成功。
3. 合并后确认旧的 `push main` 触发器已从默认分支文件中消失。
4. 不使用 `push` 触发；首次正式发布只使用 `workflow_dispatch`，输入已验收的完整 SHA。
5. 首次发布完成后核对 Pages、Production API 和版本记录。

本地修改不能改变当前远程 main 的旧行为；在变更合并前，管理员不得把本地安全设计视为已经生效。
