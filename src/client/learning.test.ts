import { afterEach, describe, expect, it, vi } from 'vitest';
import { deleteLearningSession } from './learning.js';

describe('学习数据删除结果', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('只在 HTTP 成功时确认远端删除', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(deleteLearningSession('learning-session-001', 'https://staging.example')).resolves.toEqual({ ok: true, status: 200 });
    expect(fetchMock).toHaveBeenCalledWith('https://staging.example/api/learning/session/delete', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ sessionId: 'learning-session-001' }),
    }));
  });

  it('HTTP 错误不会虚报成功，并保留可重试结果', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 503 })));

    await expect(deleteLearningSession('learning-session-002', 'https://staging.example')).resolves.toEqual({ ok: false, reason: 'http', status: 503 });
  });

  it('HTTP 200 但服务端未明确确认时仍视为未确认', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: false }), { status: 200 })));

    await expect(deleteLearningSession('learning-session-004', 'https://staging.example')).resolves.toEqual({ ok: false, reason: 'http', status: 200 });
  });

  it('网络失败不会虚报成功', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));

    await expect(deleteLearningSession('learning-session-003', 'https://staging.example')).resolves.toEqual({ ok: false, reason: 'network' });
  });
});
