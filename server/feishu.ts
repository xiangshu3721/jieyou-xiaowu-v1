import { config } from './config.js';
import type { AppointmentInput } from '../src/shared.js';

export class FeishuUnavailableError extends Error {
  code = 'FEISHU_UNAVAILABLE';
}

let tokenCache: { token: string; expiresAt: number } | null = null;

function assertConfigured() {
  if (!config.feishu.appId || !config.feishu.appSecret || !config.feishu.appToken || !config.feishu.tableId) {
    throw new FeishuUnavailableError('飞书多维表格尚未配置');
  }
}

async function getTenantToken() {
  assertConfigured();
  if (tokenCache && tokenCache.expiresAt > Date.now() + 60_000) return tokenCache.token;
  const response = await fetch(`${config.feishu.baseUrl}/open-apis/auth/v3/tenant_access_token/internal`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ app_id: config.feishu.appId, app_secret: config.feishu.appSecret }),
  });
  const payload = await response.json().catch(() => null) as { code?: number; msg?: string; tenant_access_token?: string; expire?: number } | null;
  if (!response.ok || payload?.code || !payload?.tenant_access_token) throw new FeishuUnavailableError(payload?.msg || `飞书鉴权失败 HTTP ${response.status}`);
  tokenCache = { token: payload.tenant_access_token, expiresAt: Date.now() + (payload.expire || 7_200) * 1000 };
  return tokenCache.token;
}

function fieldsFor(input: AppointmentInput) {
  return {
    预约编号: input.requestId,
    昵称: input.nickname,
    '微信 / 联系方式': input.contact,
    当前困扰描述: input.concern,
    希望获得什么帮助: input.desiredHelp,
    提交时间: new Date().toISOString(),
    处理状态: '待分配',
  };
}

export async function createFeishuAppointment(input: AppointmentInput) {
  const token = await getTenantToken();
  const response = await fetch(`${config.feishu.baseUrl}/open-apis/bitable/v1/apps/${config.feishu.appToken}/tables/${config.feishu.tableId}/records`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ fields: fieldsFor(input) }),
  });
  const payload = await response.json().catch(() => null) as { code?: number; msg?: string; data?: { record?: { record_id?: string } } } | null;
  if (!response.ok || payload?.code || !payload?.data?.record?.record_id) throw new FeishuUnavailableError(payload?.msg || `飞书写入失败 HTTP ${response.status}`);
  return payload.data.record.record_id;
}

export async function getFeishuAppointment(recordId: string) {
  const token = await getTenantToken();
  const response = await fetch(`${config.feishu.baseUrl}/open-apis/bitable/v1/apps/${config.feishu.appToken}/tables/${config.feishu.tableId}/records/${recordId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const payload = await response.json().catch(() => null) as { code?: number; msg?: string; data?: { record?: { fields?: Record<string, unknown> } } } | null;
  if (!response.ok || payload?.code || !payload?.data?.record) throw new FeishuUnavailableError(payload?.msg || `飞书查询失败 HTTP ${response.status}`);
  const fields = payload.data.record.fields || {};
  const text = (key: string) => typeof fields[key] === 'string' ? fields[key] as string : undefined;
  return { status: text('处理状态'), assignedMentor: text('分配导师'), result: text('接待结果、最近跟进时间、备注') };
}
