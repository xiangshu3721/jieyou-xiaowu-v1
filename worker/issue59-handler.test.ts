import { describe, expect, it, vi } from 'vitest';
import { handleApi, type WorkerEnv } from './handler.js';

const env: WorkerEnv = {
  DEEPSEEK_API_KEY: 'mock-key', DEEPSEEK_MODEL: 'deepseek-chat', DEEPSEEK_BASE_URL: 'https://deepseek.test',
  FEISHU_APP_ID: 'mock', FEISHU_APP_SECRET: 'mock', FEISHU_APP_TOKEN: 'mock', FEISHU_TABLE_ID: 'mock', FEISHU_BASE_URL: 'https://feishu.test',
  PROMPT_VERSION: 'v1.9.0', APPOINTMENT_SOURCE_ENVIRONMENT: 'staging', GROWTH_ENABLED: 'false', LEARNING_ENABLED: 'false',
};

function response(content: string) {
  return new Response(JSON.stringify({ model: 'deepseek-chat', choices: [{ finish_reason: 'stop', message: { content } }] }), { status: 200 });
}

describe('Issue #59 Handler 控制面回归', () => {
  it('将纠正后的禁止事实写入模型控制提示，并保留上下文开放问题', async () => {
    const fetchMock = vi.fn().mockResolvedValue(response('你说的工作压力，最近具体卡在哪一件事上？'));
    vi.stubGlobal('fetch', fetchMock);
    const issueId = 'issue-59-career';
    const request = new Request('https://staging.test/api/chat', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        currentIssueId: issueId,
        issue: { issue_id: issueId, status: 'ACTIVE', topic_tags: ['CAREER', 'MONEY'], handoff_offered: false, handoff_state: 'NOT_READY' },
        messages: [
          { role: 'user', content: '最近工作压力很大。', issueId },
          { role: 'assistant', content: '是不是也有经济压力？', issueId },
          { role: 'user', content: '我没有提到经济压力吧', issueId },
          { role: 'user', content: '然后呢？', issueId },
        ],
      }),
    });
    const result = await handleApi(request, env);
    const body = await result.json() as Record<string, any>;
    expect(result.status).toBe(200);
    expect(body.analysis).toMatchObject({ user_intent: 'WANTS_CLARITY', ask_question: true, no_more_questions: false });
    const posted = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(posted.messages[0].content).toContain('do_not_assume');
    expect(posted.messages[0].content).toContain('经济压力');
    expect(body.reply).toContain('工作压力');
    vi.unstubAllGlobals();
  });
});
