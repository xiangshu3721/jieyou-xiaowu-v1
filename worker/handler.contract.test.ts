import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { handleApi, type WorkerEnv } from './handler.js';

const baseEnv: WorkerEnv = {
  DEEPSEEK_API_KEY: 'mock-deepseek-key',
  DEEPSEEK_MODEL: 'deepseek-chat',
  DEEPSEEK_BASE_URL: 'https://deepseek.test',
  FEISHU_APP_ID: 'mock-app-id',
  FEISHU_APP_SECRET: 'mock-app-secret',
  FEISHU_APP_TOKEN: 'mock-base-token',
  FEISHU_TABLE_ID: 'tbl-staging-test',
  FEISHU_BASE_URL: 'https://feishu.test',
  APPOINTMENT_INCLUDE_METADATA: 'true',
  APPOINTMENT_SOURCE_ENVIRONMENT: 'staging',
  PROMPT_VERSION: 'v1.9.0',
  CLOUDBASE_ENV_ID: 'root-journey-prod-d4d7pzd0a8f805',
  CLOUDBASE_APIKEY: 'mock-cloudbase-key',
  GROWTH_ENABLED: 'false',
  LEARNING_ENABLED: 'false',
};

let fetchMock: ReturnType<typeof vi.fn>;

function request(path: string, method = 'GET', body?: unknown) {
  return new Request(`https://staging.test${path}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function deepSeekResponse(content: string, status = 200) {
  return new Response(JSON.stringify({ choices: [{ message: { content } }] }), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

async function json(response: Response) {
  return await response.json() as Record<string, any>;
}

describe('worker handler API 契约', () => {
  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('health 返回配置状态，并保持 Growth/Learning 关闭', async () => {
    const response = await handleApi(request('/api/health'), baseEnv);
    const body = await json(response);

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      ok: true,
      service: 'jieyou-xiaowu-v1',
      promptVersion: 'v1.9.0',
      deepseekConfigured: true,
      feishuConfigured: true,
      learningConfigured: false,
      growthConfigured: false,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('chat 返回正常结构，并将 DeepSeek 错误转为稳定契约', async () => {
    fetchMock.mockResolvedValueOnce(deepSeekResponse('{"assistant_reply":"我听见了，我们可以先把这件事理清。"}'));
    const response = await handleApi(request('/api/chat', 'POST', {
      sessionId: 'contract-chat-session',
      messages: [{ role: 'user', content: '最近工作压力很大。' }],
    }), baseEnv);
    const body = await json(response);

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ model: 'deepseek-chat' });
    expect(body.reply).toContain('我听见了');
    expect(body.analysis).toEqual(expect.objectContaining({ current_issue_id: expect.any(String), safety_status: 'NO_SIGNAL_DETECTED' }));

    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: 'mock unavailable' } }), { status: 503 }));
    const failed = await handleApi(request('/api/chat', 'POST', {
      sessionId: 'contract-chat-error',
      messages: [{ role: 'user', content: '请继续聊聊。' }],
    }), baseEnv);
    expect(failed.status).toBe(502);
    expect(await json(failed)).toMatchObject({ code: 'DEEPSEEK_UNAVAILABLE' });
  });

  it('booking-summary 返回摘要，并拒绝空消息请求', async () => {
    fetchMock.mockResolvedValueOnce(deepSeekResponse('这是一段结构化的预约摘要。'));
    const response = await handleApi(request('/api/booking-summary', 'POST', {
      sessionId: 'contract-summary-session',
      messages: [{ role: 'user', content: '我想找人帮我理清下一步。' }],
    }), baseEnv);
    expect(response.status).toBe(200);
    expect(await json(response)).toMatchObject({ summary: '这是一段结构化的预约摘要。', promptVersion: 'v1.9.0' });

    const invalid = await handleApi(request('/api/booking-summary', 'POST', { messages: [] }), baseEnv);
    expect(invalid.status).toBe(400);
    expect(await json(invalid)).toMatchObject({ error: '没有可整理的聊天内容' });
  });

  it('appointments 支持 Staging 元数据、幂等重试和状态查询', async () => {
    let listCalls = 0;
    let createCalls = 0;
    let postedFields: Record<string, unknown> | undefined;
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method || 'GET';
      if (url.endsWith('/open-apis/auth/v3/tenant_access_token/internal')) {
        return new Response(JSON.stringify({ code: 0, tenant_access_token: 'mock-tenant-token', expire: 7_200 }), { status: 200 });
      }
      if (url.includes('/records?filter=')) {
        listCalls += 1;
        const items = listCalls === 1 ? [] : [{ record_id: 'rec-staging-contract-001', fields: { 预约编号: 'contract-request-001' } }];
        return new Response(JSON.stringify({ code: 0, data: { items } }), { status: 200 });
      }
      if (method === 'POST' && url.endsWith('/records')) {
        createCalls += 1;
        postedFields = JSON.parse(String(init?.body)).fields;
        return new Response(JSON.stringify({ code: 0, data: { record: { record_id: 'rec-staging-contract-001' } } }), { status: 200 });
      }
      if (url.endsWith('/records/rec-staging-contract-001')) {
        return new Response(JSON.stringify({ code: 0, data: { record: { fields: { 处理状态: '待分配' } } } }), { status: 200 });
      }
      throw new Error(`unexpected mock request: ${method} ${url}`);
    });

    const missing = await handleApi(request('/api/appointments', 'POST', { requestId: 'invalid' }), baseEnv);
    expect(missing.status).toBe(400);

    const input = {
      requestId: 'contract-request-001',
      nickname: 'Staging Mock User',
      contact: 'mock@example.invalid',
      concern: '仅用于 Handler 契约测试。',
      desiredHelp: '验证预约主链路。',
      consent: true,
      issueId: 'issue-contract-001',
      bookingCaseId: 'booking-contract-001',
    };
    const created = await handleApi(request('/api/appointments', 'POST', input), baseEnv);
    expect(created.status).toBe(200);
    expect(await json(created)).toMatchObject({ status: 'submitted', recordId: 'rec-staging-contract-001' });
    expect(postedFields).toMatchObject({
      'Source Environment': 'staging',
      'Request ID': 'contract-request-001',
      'Issue ID': 'issue-contract-001',
      'Booking Case ID': 'booking-contract-001',
    });

    const retried = await handleApi(request('/api/appointments', 'POST', input), baseEnv);
    expect(retried.status).toBe(200);
    expect(await json(retried)).toMatchObject({ idempotent: true, recordId: 'rec-staging-contract-001' });
    expect(createCalls).toBe(1);

    const status = await handleApi(request('/api/appointments/contract-request-001/status'), baseEnv);
    expect(status.status).toBe(200);
    expect(await json(status)).toMatchObject({ requestId: 'contract-request-001', recordId: 'rec-staging-contract-001', status: '待分配' });
  });
});
