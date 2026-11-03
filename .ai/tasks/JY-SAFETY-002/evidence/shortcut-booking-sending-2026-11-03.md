# 快捷真人预约发送保护证据

时间：2026-11-03（Asia/Shanghai）

## 代码与自动化证据

- `src/client/main.tsx` 的 `wantsHumanBooking(content)` 分支现在在 `ensureBookingIssueId()`、`addMessage()`、`moveToBooking()` 整个异步链路前调用 `setSending(true)`。
- `finally` 中统一调用 `setSending(false)`，因此安全检查成功、失败或异常后都会恢复正常操作。
- `src/client/deletion-flow.test.ts` 新增“真人快捷预约的异步过程也使用 sending 保护”测试，确认该分支包含 `setSending(true)`、全部异步调用和 `setSending(false)`。

## 本地页面观察

- 虚构输入：`我想找真人聊聊`。
- 本地代理未启动 API，页面返回 `安全检查暂时不可用，请稍后重试`；未提交预约，也未产生外部写入。
- 请求结束后页面恢复为可操作状态，清空按钮重新可用。
- 发送期间的精确按钮快照由静态测试保证；本次页面请求返回过快，未把请求结束后的状态冒充为请求中截图或观察结果。
