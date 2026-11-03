import { afterEach, describe, expect, it, vi } from 'vitest';
import { requestSafetyGate } from './safety-gate.js';

describe('客户端安全门禁请求', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('只把当前 Issue 消息交给后台安全门禁，并保留后台裁决', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ allowed: false, safety_status: 'URGENT', reply: '先确认安全' }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const result = await requestSafetyGate('https://staging.example', [{ role: 'user', content: '我现在正准备伤害自己', issueId: 'issue-a' }], 'issue-a');
    expect(result).toEqual({ allowed: false, safety_status: 'URGENT', reply: '先确认安全' });
    expect(fetchMock).toHaveBeenCalledWith('https://staging.example/api/safety-gate', expect.objectContaining({ method: 'POST', body: JSON.stringify({ messages: [{ role: 'user', content: '我现在正准备伤害自己', issueId: 'issue-a' }], currentIssueId: 'issue-a' }) }));
  });
});
