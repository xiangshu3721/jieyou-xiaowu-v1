type Json = Record<string, unknown>;

const baseUrl = process.env.API_BASE_URL || 'http://127.0.0.1:8787';
const requestId = `E2E-${Date.now()}`;
const conversation = [
  { role: 'user', content: '这是解忧小屋 V1 的真实联调测试。我最近因为工作压力很大，想有人帮我理清下一步。' },
];

async function request<T extends Json>(path: string, init?: RequestInit) {
  const response = await fetch(`${baseUrl}${path}`, { ...init, headers: { 'content-type': 'application/json', ...(init?.headers || {}) } });
  const body = await response.json() as T;
  if (!response.ok) throw new Error(`${path} HTTP ${response.status}: ${String(body.error || 'unknown error')}`);
  return body;
}

const health = await request<{ deepseekConfigured: boolean; feishuConfigured: boolean }>('/api/health');
if (!health.deepseekConfigured || !health.feishuConfigured) throw new Error('真实 E2E 被外部配置阻断：请先配置 DeepSeek 与飞书');

const chat = await request<{ reply: string; model: string; analysis: { conversation_state: string; routing_state: string; safety_status: string } }>('/api/chat', { method: 'POST', body: JSON.stringify({ sessionId: requestId, messages: conversation }) });
if (!chat.reply || chat.model === 'safety-rule') throw new Error('真实聊天没有返回可用模型回复');
if (!chat.analysis || !chat.analysis.conversation_state || !chat.analysis.routing_state || chat.analysis.safety_status !== 'NO_SIGNAL_DETECTED') throw new Error('真实聊天没有返回合法的结构化导诊状态');

const summary = await request<{ summary: string }>('/api/booking-summary', { method: 'POST', body: JSON.stringify({ sessionId: requestId, messages: [...conversation, { role: 'assistant', content: chat.reply }] }) });
if (!summary.summary) throw new Error('真实摘要为空');

const appointmentInput = { requestId, nickname: '解忧小屋 V1 联调', contact: `E2E-${requestId}`, concern: summary.summary, desiredHelp: '验证真实摘要、编辑后的预约信息可以写入飞书。', consent: true };
const created = await request<{ status: string; recordId?: string }>('/api/appointments', { method: 'POST', body: JSON.stringify(appointmentInput) });
if (created.status !== 'submitted' || !created.recordId) throw new Error('飞书真实写入没有返回 recordId');

const retried = await request<{ idempotent?: boolean; recordId?: string }>('/api/appointments', { method: 'POST', body: JSON.stringify(appointmentInput) });
if (!retried.idempotent || retried.recordId !== created.recordId) throw new Error('预约幂等重试未复用同一条飞书记录');

const status = await request<{ requestId: string; status: string }>(`/api/appointments/${encodeURIComponent(requestId)}/status`);
if (status.requestId !== requestId) throw new Error('预约状态查询编号不一致');

console.log(JSON.stringify({ ok: true, requestId, model: chat.model, summaryLength: summary.summary.length, recordId: created.recordId, status: status.status }, null, 2));

export {};
