import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('./config.js', () => ({
  config: {
    feishu: {
      appId: 'mock-app-id',
      appSecret: 'mock-app-secret',
      appToken: 'mock-base-token',
      tableId: 'tblUrXu4ivBGJ7zV',
      baseUrl: 'https://feishu.test',
    },
  },
}));

import { createFeishuAppointment } from './feishu.js';

describe('local Node Feishu appointment mapping', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('uses the production table fields and Beijing text appointment time', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-02T00:03:04Z'));
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ code: 0, tenant_access_token: 'mock-token', expire: 7_200 }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ code: 0, data: { record: { record_id: 'rec-node-001' } } }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(createFeishuAppointment({
      requestId: 'node-production-contract-001',
      nickname: 'Node Mock User',
      contact: 'node@example.invalid',
      concern: '仅用于 Node 飞书映射测试。',
      desiredHelp: '',
      consent: true,
    })).resolves.toBe('rec-node-001');

    const fields = JSON.parse(String(fetchMock.mock.calls[1][1].body)).fields;
    expect(fields).toEqual({
      预约ID: 'node-production-contract-001',
      客户昵称: 'Node Mock User',
      联系方式: 'node@example.invalid',
      当前困扰: '仅用于 Node 飞书映射测试。',
      预约时间: '2026-01-02 08:03:04',
      处理状态: '待分配',
    });
  });
});
