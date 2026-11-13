import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { emergencyReply, safetyClarificationReply } from '../server/rules.js';
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

function deepSeekResponse(content: string | null, status = 200, finishReason: string | null = 'stop', model = 'deepseek-chat') {
  return new Response(JSON.stringify({ model, choices: [{ finish_reason: finishReason, message: { content } }] }), {
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
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('OPTIONS 预检返回无响应体的 204', async () => {
    const response = await handleApi(request('/api/chat', 'OPTIONS'), baseEnv);

    expect(response.status).toBe(204);
    expect(await response.text()).toBe('');
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

  it('chat 的结构化输出解析失败时保留通过校验的自然语言回复', async () => {
    fetchMock.mockResolvedValueOnce(deepSeekResponse('我在听，你最想先说什么？'));
    const response = await handleApi(request('/api/chat', 'POST', {
      sessionId: 'contract-chat-fallback-session',
      messages: [{ role: 'user', content: '最近很累，能帮我理清楚吗' }],
    }), baseEnv);
    const body = await json(response);

    expect(response.status).toBe(200);
    expect(body.reply).not.toContain('我先听着，也接住你刚才说的这部分');
    expect(body.diagnostics).toEqual(expect.objectContaining({ codes: ['MODEL_SUCCESS', 'MODEL_PARSE_FAILED'], fallback_used: false }));
  });

  it('chat 不强制 JSON，保留有效 JSON 或自然语言，并明确报告空白和截断输出', async () => {
    let postedBody: Record<string, unknown> | undefined;
    fetchMock.mockImplementationOnce(async (_input: RequestInfo | URL, init?: RequestInit) => {
      postedBody = JSON.parse(String(init?.body));
      return deepSeekResponse('先把今天最紧急的一件事列出来，只做它的第一步。', 200, 'stop', 'deepseek-chat');
    });
    const plainText = await handleApi(request('/api/chat', 'POST', {
      messages: [{ role: 'user', content: '工作很多，我接下来做什么？' }],
    }), baseEnv);
    const plainTextBody = await json(plainText);
    expect(plainTextBody.reply).toContain('最紧急');
    expect(plainTextBody.diagnostics).toEqual(expect.objectContaining({
      codes: ['MODEL_SUCCESS', 'MODEL_PARSE_FAILED'],
      model: 'deepseek-chat',
      finish_reason: 'stop',
      fallback_used: false,
    }));
    expect(postedBody).toMatchObject({ max_tokens: 1_600, stream: false });
    expect(postedBody).not.toHaveProperty('response_format');

    fetchMock.mockResolvedValueOnce(deepSeekResponse(null));
    const empty = await handleApi(request('/api/chat', 'POST', { messages: [{ role: 'user', content: '我有点乱。' }] }), baseEnv);
    expect(empty.status).toBe(502);
    expect(await json(empty)).toMatchObject({
      code: 'DEEPSEEK_EMPTY_RESPONSE',
      diagnostics: { codes: ['MODEL_SUCCESS', 'MODEL_EMPTY'], fallback_used: false },
    });

    fetchMock.mockResolvedValueOnce(deepSeekResponse('{"assistant_reply":'));
    const incomplete = await handleApi(request('/api/chat', 'POST', { messages: [{ role: 'user', content: '我有点乱。' }] }), baseEnv);
    expect((await json(incomplete)).diagnostics).toEqual(expect.objectContaining({ codes: ['MODEL_SUCCESS', 'MODEL_PARSE_FAILED', 'FALLBACK_USED'], fallback_used: true }));

    fetchMock.mockResolvedValueOnce(deepSeekResponse('{"assistant_reply":"没有说完"', 200, 'length'));
    const truncated = await handleApi(request('/api/chat', 'POST', { messages: [{ role: 'user', content: '我有点乱。' }] }), baseEnv);
    expect(truncated.status).toBe(502);
    expect(await json(truncated)).toMatchObject({
      code: 'DEEPSEEK_OUTPUT_TRUNCATED',
      diagnostics: { codes: ['MODEL_SUCCESS', 'MODEL_OUTPUT_TRUNCATED'], finish_reason: 'length', fallback_used: false },
    });

    fetchMock.mockResolvedValueOnce(deepSeekResponse('{"assistant_reply":"你可以预约真人导师。"}'));
    const rejected = await handleApi(request('/api/chat', 'POST', { messages: [{ role: 'user', content: '工作压力很大怎么办？' }] }), baseEnv);
    expect((await json(rejected)).diagnostics).toEqual(expect.objectContaining({ codes: ['MODEL_SUCCESS', 'MODEL_REPLY_REJECTED', 'FALLBACK_USED'], fallback_used: true }));
  });

  it('咨询师犹豫式询问正常回复并带可选预约入口，不被强制交接覆盖', async () => {
    fetchMock.mockResolvedValueOnce(deepSeekResponse('不一定需要马上做决定。可以先看困扰有没有持续影响生活，也可以在这里继续聊聊。'));
    const response = await handleApi(request('/api/chat', 'POST', {
      currentIssueId: 'issue-optional-counselor',
      issue: { issue_id: 'issue-optional-counselor', status: 'ACTIVE', topic_tags: [], handoff_offered: false, handoff_state: 'NOT_READY' },
      messages: [{ role: 'user', content: '要不要找咨询师啊？', issueId: 'issue-optional-counselor' }],
    }), baseEnv);
    const body = await json(response);
    expect(response.status).toBe(200);
    expect(body.reply).toContain('不一定需要马上做决定');
    expect(body.reply).not.toMatch(/提交后|分配导师/);
    expect(body.analysis).toMatchObject({
      routing: 'AI_SUPPORT',
      booking_preference: 'INTERESTED',
      show_booking_button: true,
      handoff_ready: false,
      handoff_mode: 'NONE',
    });
    expect(body.diagnostics).toMatchObject({ fallback_used: false });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('跨工作、感情、亲子后回到工作时，模型只看到旧工作上下文与本轮消息', async () => {
    fetchMock.mockResolvedValueOnce(deepSeekResponse('之前我们讨论了工作项目太多，建议先列最紧急的一项。'));
    const allMessages = [
      { role: 'user', content: '工作项目太多，我经常睡不着', issueId: 'issue-work' },
      { role: 'assistant', content: '先列出今天最重要的一件事', issueId: 'issue-work' },
      { role: 'user', content: '最近和伴侣关系紧张', issueId: 'issue-love' },
      { role: 'assistant', content: '我们先看看冲突集中在哪儿', issueId: 'issue-love' },
      { role: 'user', content: '孩子最近不愿意上学', issueId: 'issue-child' },
      { role: 'assistant', content: '你最担心孩子的哪一部分', issueId: 'issue-child' },
      { role: 'user', content: '我们回到之前工作的那个问题吧，接下来怎么办？', issueId: 'issue-child' },
    ];
    const response = await handleApi(request('/api/chat', 'POST', {
      currentIssueId: 'issue-child',
      issue: { issue_id: 'issue-child', status: 'ACTIVE', topic_tags: ['PARENTING'] },
      issues: [
        { issue_id: 'issue-work', status: 'PAUSED', topic_tags: ['CAREER', 'EMOTION'] },
        { issue_id: 'issue-love', status: 'PAUSED', topic_tags: ['INTIMACY'] },
        { issue_id: 'issue-child', status: 'ACTIVE', topic_tags: ['PARENTING'] },
      ],
      messages: allMessages,
    }), baseEnv);
    const body = await json(response);
    expect(response.status).toBe(200);
    expect(body.analysis).toMatchObject({
      current_issue_id: 'issue-work', previous_issue_id: 'issue-child',
      issue_action: 'RESUME_PREVIOUS', new_issue_detected: false,
      issue_status: 'ACTIVE', user_turn_count: 2,
    });
    expect(body.reply).toContain('工作项目太多');
    const posted = JSON.parse(String(fetchMock.mock.calls[0][1]?.body)) as { messages: Array<{ role: string; content: string }> };
    expect(posted.messages.slice(1)).toEqual([
      { role: 'user', content: allMessages[0].content },
      { role: 'assistant', content: allMessages[1].content },
      { role: 'user', content: allMessages[6].content },
    ]);
    expect(JSON.stringify(posted.messages)).not.toContain('伴侣关系紧张');
    expect(JSON.stringify(posted.messages)).not.toContain('孩子最近不愿意上学');
  });

  it('第二阶段：不说回到之前也能自然恢复唯一旧工作 Issue，模型看不到关系和亲子内容', async () => {
    fetchMock.mockResolvedValueOnce(deepSeekResponse('我们之前讨论过工作任务太多，可以继续从最紧急的一项开始。'));
    const history = [
      { role: 'user', content: '工作任务太多，我常常焦虑', issueId: 'issue-work' },
      { role: 'assistant', content: '先圈出今天必须完成的一件事', issueId: 'issue-work' },
      { role: 'user', content: '最近我和伴侣有矛盾', issueId: 'issue-love' },
      { role: 'user', content: '孩子最近不愿意上学', issueId: 'issue-child' },
      { role: 'user', content: '最近工作压力又大起来了', issueId: 'issue-child' },
    ];
    const result = await handleApi(request('/api/chat', 'POST', {
      currentIssueId: 'issue-child',
      issue: { issue_id: 'issue-child', status: 'ACTIVE', topic_tags: ['PARENTING'] },
      issues: [
        { issue_id: 'issue-work', status: 'PAUSED', topic_tags: ['CAREER', 'EMOTION'], user_turn_count: 2 },
        { issue_id: 'issue-love', status: 'PAUSED', topic_tags: ['INTIMACY'] },
        { issue_id: 'issue-child', status: 'ACTIVE', topic_tags: ['PARENTING'] },
      ],
      messages: history,
    }), baseEnv);
    const body = await json(result);
    expect(result.status).toBe(200);
    expect(body.analysis).toMatchObject({
      issue_action: 'RESUME_PREVIOUS', current_issue_id: 'issue-work',
      previous_issue_id: 'issue-child', new_issue_detected: false,
    });
    expect(body.diagnostics).toMatchObject({ fallback_used: false });
    const posted = JSON.parse(String(fetchMock.mock.calls[0][1]?.body)) as { messages: Array<{ role: string; content: string }> };
    expect(posted.messages.slice(1)).toEqual([
      { role: 'user', content: history[0].content },
      { role: 'assistant', content: history[1].content },
      { role: 'user', content: history[4].content },
    ]);
    expect(JSON.stringify(posted.messages)).not.toContain('伴侣有矛盾');
    expect(JSON.stringify(posted.messages)).not.toContain('孩子最近不愿意上学');
  });

  it('超过 40 条新消息之后仍能找回旧 Issue，而不是遗漏早期工作历史', async () => {
    fetchMock.mockResolvedValueOnce(deepSeekResponse('我们之前说过先处理最紧急的工作任务，可以继续从那里开始。'));
    const history = [
      { role: 'user', content: '我负责一个大项目，工作排期一直很紧', issueId: 'issue-early-work' },
      { role: 'assistant', content: '你可以先选一项最重要的工作任务', issueId: 'issue-early-work' },
      ...Array.from({ length: 50 }, (_, index) => ({
        role: index % 2 ? 'assistant' : 'user',
        content: index % 2 ? '我们继续聊聊你的感情关系' : '和伴侣沟通又有些分歧',
        issueId: 'issue-later-intimacy',
      })),
      { role: 'user', content: '我想回到之前工作的问题', issueId: 'issue-later-intimacy' },
    ];
    const response = await handleApi(request('/api/chat', 'POST', {
      currentIssueId: 'issue-later-intimacy',
      issue: { issue_id: 'issue-later-intimacy', status: 'ACTIVE', topic_tags: ['INTIMACY'] },
      issues: [
        { issue_id: 'issue-early-work', status: 'PAUSED', topic_tags: ['CAREER'] },
        { issue_id: 'issue-later-intimacy', status: 'ACTIVE', topic_tags: ['INTIMACY'] },
      ],
      messages: history,
    }), baseEnv);
    const body = await json(response);
    expect(response.status).toBe(200);
    expect(body.analysis.current_issue_id).toBe('issue-early-work');
    expect(body.analysis.issue_action).toBe('RESUME_PREVIOUS');
    const posted = JSON.parse(String(fetchMock.mock.calls[0][1]?.body)) as { messages: Array<{ role: string; content: string }> };
    expect(posted.messages.map((message) => message.content)).toContain('我负责一个大项目，工作排期一直很紧');
    expect(posted.messages.map((message) => message.content)).not.toContain('和伴侣沟通又有些分歧');
  });

  it('已预约旧 Issue 永久封存，回到相同主题只创建新 Issue，不复用旧预约事实或 CTA', async () => {
    fetchMock.mockResolvedValueOnce(deepSeekResponse('可以从你现在的工作状况重新说起，先聊最困扰你的部分。'));
    const response = await handleApi(request('/api/chat', 'POST', {
      currentIssueId: 'issue-other',
      issue: { issue_id: 'issue-other', status: 'ACTIVE', topic_tags: ['INTIMACY'] },
      issues: [
        { issue_id: 'issue-booked', status: 'BOOKING_SUBMITTED', topic_tags: ['CAREER'], handoff_offered: true, handoff_state: 'ACCEPTED', booking_case_id: 'case-123' },
        { issue_id: 'issue-other', status: 'ACTIVE', topic_tags: ['INTIMACY'] },
      ],
      messages: [
        { role: 'user', content: '我的工作压力很大', issueId: 'issue-booked' },
        { role: 'assistant', content: '可以联系真人继续聊', issueId: 'issue-booked' },
        { role: 'user', content: '现在有感情关系烦恼', issueId: 'issue-other' },
        { role: 'user', content: '我们回到之前工作的问题吧', issueId: 'issue-other' },
      ],
    }), baseEnv);
    const body = await json(response);
    expect(response.status).toBe(200);
    expect(body.analysis.issue_action).toBe('CREATE_NEW');
    expect(body.analysis.current_issue_id).not.toBe('issue-booked');
    expect(body.analysis.current_issue_id).not.toBe('issue-other');
    expect(body.analysis.issue_status).toBe('ACTIVE');
    expect(body.analysis.show_booking_button).toBe(false);
    expect(body.analysis.handoff_mode).toBe('NONE');
    const posted = JSON.parse(String(fetchMock.mock.calls[0][1]?.body)) as { messages: Array<{ role: string; content: string }> };
    expect(posted.messages.filter((message) => message.role === 'user').map((message) => message.content))
      .toEqual(['我们回到之前工作的问题吧']);
  });

  it('旧 Issue 有未解除的危机状态时，回到旧 Issue 优先安全门禁，不调用模型', async () => {
    const response = await handleApi(request('/api/chat', 'POST', {
      currentIssueId: 'issue-other',
      issue: { issue_id: 'issue-other', status: 'ACTIVE', topic_tags: ['INTIMACY'] },
      issues: [{ issue_id: 'issue-risk', status: 'PAUSED', topic_tags: ['CAREER'] }],
      messages: [
        { role: 'user', content: '我现在正准备伤害自己，工作压力太大了', issueId: 'issue-risk' },
        { role: 'user', content: '最近感情关系很紧张', issueId: 'issue-other' },
        { role: 'user', content: '回到之前工作的问题吧', issueId: 'issue-other' },
      ],
    }), baseEnv);
    const body = await json(response);
    expect(response.status).toBe(200);
    expect(body.analysis.current_issue_id).toBe('issue-risk');
    expect(body.analysis.safety_status).toBe('URGENT');
    expect(body.reply).toBe(emergencyReply);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('多个同领域历史 Issue 或找不到旧 Issue 时不擅自恢复或新建', async () => {
    const history = [
      { role: 'user', content: '工作中和同事冲突', issueId: 'issue-a' },
      { role: 'user', content: '我在求职', issueId: 'issue-b' },
      { role: 'user', content: '和伴侣关系很紧张', issueId: 'issue-c' },
      { role: 'user', content: '回到之前工作的问题吧', issueId: 'issue-c' },
    ];
    const response = await handleApi(request('/api/chat', 'POST', {
      currentIssueId: 'issue-c',
      issue: { issue_id: 'issue-c', status: 'ACTIVE', topic_tags: ['INTIMACY'] },
      messages: history,
    }), baseEnv);
    const body = await json(response);
    expect(response.status).toBe(200);
    expect(body.reply).toContain('哪一件');
    expect(body.analysis.current_issue_id).toBe('issue-c');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('chat 模型升级安全状态时优先返回既有安全回复', async () => {
    fetchMock.mockResolvedValueOnce(deepSeekResponse('{"assistant_reply":"先继续聊工作安排。","safety_status":"URGENT"}'));
    const urgent = await handleApi(request('/api/chat', 'POST', {
      messages: [{ role: 'user', content: '最近工作压力很大。' }],
    }), baseEnv);
    expect(urgent.status).toBe(200);
    expect(await json(urgent)).toMatchObject({ reply: emergencyReply, model: 'safety-rule', analysis: { safety_status: 'URGENT' } });

    fetchMock.mockResolvedValueOnce(deepSeekResponse('{"assistant_reply":"先继续聊工作安排。","safety_status":"NEEDS_CLARIFICATION"}'));
    const clarification = await handleApi(request('/api/chat', 'POST', {
      messages: [{ role: 'user', content: '最近工作压力很大。' }],
    }), baseEnv);
    expect(clarification.status).toBe(200);
    expect(await json(clarification)).toMatchObject({ reply: safetyClarificationReply, model: 'safety-rule', analysis: { safety_status: 'NEEDS_CLARIFICATION' } });
  });

  it('连续普通对话在解析失败时回应求助和追问，不重复固定兜底', async () => {
    fetchMock
      .mockResolvedValueOnce(deepSeekResponse('{"assistant_reply":'))
      .mockResolvedValueOnce(deepSeekResponse('{"assistant_reply":'));
    const helpResponse = await handleApi(request('/api/chat', 'POST', {
      currentIssueId: 'issue-continuity',
      issue: { issue_id: 'issue-continuity', status: 'ACTIVE', topic_tags: ['CAREER'], handoff_offered: false, handoff_state: 'NOT_READY' },
      messages: [{ role: 'user', content: '工作压力很大怎么办？', issueId: 'issue-continuity' }],
    }), baseEnv);
    expect(helpResponse.status).toBe(200);
    expect((await json(helpResponse)).reply).toMatch(/任务|工作量|范围/);

    const response = await handleApi(request('/api/chat', 'POST', {
      currentIssueId: 'issue-continuity',
      issue: { issue_id: 'issue-continuity', status: 'ACTIVE', topic_tags: ['CAREER'], handoff_offered: false, handoff_state: 'NOT_READY' },
      messages: [
        { role: 'user', content: '工作压力很大怎么办？', issueId: 'issue-continuity' },
        { role: 'assistant', content: '我先听着，也接住你刚才说的这部分。你可以按自己的节奏继续说，不必急着回答问题。', issueId: 'issue-continuity' },
        { role: 'user', content: '你这话啥意思？', issueId: 'issue-continuity' },
      ],
    }), baseEnv);
    const body = await json(response);

    expect(response.status).toBe(200);
    expect(body.reply).toContain('没有回答');
    expect(body.reply).toMatch(/任务|工作量|范围/);
    expect(body.reply).not.toBe('我先听着，也接住你刚才说的这部分。你可以按自己的节奏继续说，不必急着回答问题。');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('被回复校验拦截的普通模型回复也保留当前求助语境', async () => {
    fetchMock.mockResolvedValueOnce(deepSeekResponse('{"assistant_reply":"你可以预约真人导师。"}'));
    const response = await handleApi(request('/api/chat', 'POST', {
      currentIssueId: 'issue-help',
      issue: { issue_id: 'issue-help', status: 'ACTIVE', topic_tags: ['CAREER'], handoff_offered: false, handoff_state: 'NOT_READY' },
      messages: [{ role: 'user', content: '工作压力很大怎么办？', issueId: 'issue-help' }],
    }), baseEnv);
    const body = await json(response);

    expect(response.status).toBe(200);
    expect(body.reply).toMatch(/任务|工作量|范围/);
    expect(body.reply).not.toMatch(/预约|真人|导师/);
  });

  it('连续三轮普通解析失败不在旧新兜底之间循环', async () => {
    fetchMock
      .mockResolvedValueOnce(deepSeekResponse('{"assistant_reply":'))
      .mockResolvedValueOnce(deepSeekResponse('{"assistant_reply":'))
      .mockResolvedValueOnce(deepSeekResponse('{"assistant_reply":'));
    const issue = { issue_id: 'issue-three-fallbacks', status: 'ACTIVE', topic_tags: ['EMOTION'], handoff_offered: false, handoff_state: 'NOT_READY' };
    const firstResponse = await handleApi(request('/api/chat', 'POST', {
      currentIssueId: issue.issue_id,
      issue,
      messages: [{ role: 'user', content: '今天心里很乱。', issueId: issue.issue_id }],
    }), baseEnv);
    const first = (await json(firstResponse)).reply as string;

    const secondResponse = await handleApi(request('/api/chat', 'POST', {
      currentIssueId: issue.issue_id,
      issue,
      messages: [
        { role: 'user', content: '今天心里很乱。', issueId: issue.issue_id },
        { role: 'assistant', content: first, issueId: issue.issue_id },
        { role: 'user', content: '我不知道怎么说。', issueId: issue.issue_id },
      ],
    }), baseEnv);
    const second = (await json(secondResponse)).reply as string;

    const thirdResponse = await handleApi(request('/api/chat', 'POST', {
      currentIssueId: issue.issue_id,
      issue,
      messages: [
        { role: 'user', content: '今天心里很乱。', issueId: issue.issue_id },
        { role: 'assistant', content: first, issueId: issue.issue_id },
        { role: 'user', content: '我不知道怎么说。', issueId: issue.issue_id },
        { role: 'assistant', content: second, issueId: issue.issue_id },
        { role: 'user', content: '我只是觉得很累。', issueId: issue.issue_id },
      ],
    }), baseEnv);
    const third = (await json(thirdResponse)).reply as string;

    expect(new Set([first, second, third]).size).toBe(3);
    [first, second, third].forEach((reply) => expect(reply).not.toContain('我不重复刚才那句'));
  });

  it('追问会解释上一条实际回复，不把已切换的话题拉回工作，也尊重拒绝建议', async () => {
    fetchMock
      .mockResolvedValueOnce(deepSeekResponse('{"assistant_reply":'))
      .mockResolvedValueOnce(deepSeekResponse('{"assistant_reply":'))
      .mockResolvedValueOnce(deepSeekResponse('{"assistant_reply":'));
    const workAdvice = '先把今天必须完成的任务列出来，只推进最紧急的一件，必要时提前说明期限风险。';
    const workResponse = await handleApi(request('/api/chat', 'POST', {
      currentIssueId: 'issue-explain-work',
      issue: { issue_id: 'issue-explain-work', status: 'ACTIVE', topic_tags: ['CAREER'], handoff_offered: false, handoff_state: 'NOT_READY' },
      messages: [
        { role: 'user', content: '工作压力很大怎么办？', issueId: 'issue-explain-work' },
        { role: 'assistant', content: workAdvice, issueId: 'issue-explain-work' },
        { role: 'user', content: '你这话什么意思？', issueId: 'issue-explain-work' },
      ],
    }), baseEnv);
    expect((await json(workResponse)).reply).toMatch(/任务|期限/);

    const relationshipReply = '听起来你和伴侣最近总在沟通时卡住，这会让人很疲惫。';
    const relationshipResponse = await handleApi(request('/api/chat', 'POST', {
      currentIssueId: 'issue-relationship',
      issue: { issue_id: 'issue-relationship', status: 'ACTIVE', topic_tags: ['INTIMACY'], handoff_offered: false, handoff_state: 'NOT_READY' },
      messages: [
        { role: 'user', content: '工作压力很大怎么办？', issueId: 'issue-work' },
        { role: 'user', content: '最近和伴侣说话总有些别扭。', issueId: 'issue-relationship' },
        { role: 'assistant', content: relationshipReply, issueId: 'issue-relationship' },
        { role: 'user', content: '你这话什么意思？', issueId: 'issue-relationship' },
      ],
    }), baseEnv);
    const relationshipBody = await json(relationshipResponse);
    expect(relationshipBody.reply).toContain(relationshipReply);
    expect(relationshipBody.reply).not.toMatch(/工作|任务|期限/);

    const noAdviceResponse = await handleApi(request('/api/chat', 'POST', {
      currentIssueId: 'issue-explain-no-advice',
      issue: { issue_id: 'issue-explain-no-advice', status: 'ACTIVE', topic_tags: ['CAREER'], handoff_offered: false, handoff_state: 'NOT_READY' },
      messages: [
        { role: 'user', content: '工作压力很大怎么办？', issueId: 'issue-explain-no-advice' },
        { role: 'assistant', content: workAdvice, issueId: 'issue-explain-no-advice' },
        { role: 'user', content: '不要建议，只解释下。', issueId: 'issue-explain-no-advice' },
      ],
    }), baseEnv);
    const noAdviceBody = await json(noAdviceResponse);
    expect(noAdviceBody.reply).toMatch(/只解释|不再补充/);
    expect(noAdviceBody.reply).not.toMatch(/先把|推进|提前说明/);
  });

  it('真人交接 Handler 契约保持入口、状态和无提问回复一致', async () => {
    fetchMock.mockResolvedValueOnce(deepSeekResponse('{"assistant_reply":"你愿意先说说为什么想找真人吗？"}'));
    const directResponse = await handleApi(request('/api/chat', 'POST', {
      currentIssueId: 'issue-direct-handoff',
      issue: { issue_id: 'issue-direct-handoff', status: 'ACTIVE', topic_tags: [], handoff_offered: false, handoff_state: 'NOT_READY' },
      messages: [{ role: 'user', content: '我想找真人导师聊聊', issueId: 'issue-direct-handoff' }],
    }), baseEnv);
    const directBody = await json(directResponse);
    expect(directResponse.status).toBe(200);
    expect(directBody).toMatchObject({ model: 'deepseek-chat' });
    expect(directBody.reply).toContain('免费预约真人聊聊');
    expect(directBody.reply).not.toMatch(/[？?]/);
    expect(directBody.analysis).toEqual(expect.objectContaining({
      handoff_mode: 'DIRECT_HANDOFF',
      handoff_state: 'OFFERED',
      show_booking_button: true,
      ask_question: false,
      no_more_questions: true,
    }));

    fetchMock.mockResolvedValueOnce(deepSeekResponse('{"assistant_reply":"如果你愿意，可以预约真人。"}'));
    const quickResponse = await handleApi(request('/api/chat', 'POST', {
      currentIssueId: 'issue-quick-handoff',
      issue: { issue_id: 'issue-quick-handoff', status: 'ACTIVE', topic_tags: ['CAREER'], handoff_offered: false, handoff_state: 'NOT_READY' },
      messages: [
        { role: 'user', content: '工作压力很大。', issueId: 'issue-quick-handoff' },
        { role: 'user', content: '已经两三个月了，每天都不想上班。', issueId: 'issue-quick-handoff' },
        { role: 'user', content: '晚上睡不好，白天状态也受影响。', issueId: 'issue-quick-handoff' },
      ],
    }), baseEnv);
    const quickBody = await json(quickResponse);
    expect(quickResponse.status).toBe(200);
    expect(quickBody.reply).toMatch(/睡眠|工作/);
    expect(quickBody.reply).toContain('免费预约真人聊聊');
    expect(quickBody.reply).not.toMatch(/[？?]/);
    expect(quickBody.analysis).toEqual(expect.objectContaining({
      handoff_mode: 'QUICK_HANDOFF',
      handoff_state: 'OFFERED',
      show_booking_button: true,
      ask_question: false,
      no_more_questions: true,
    }));
  });

  it('阶段 1.3：Handler 对用户纠正保持当前 Issue，不创建新 Issue', async () => {
    fetchMock.mockResolvedValueOnce(deepSeekResponse('{"assistant_reply":"我明白了，我不再按那个方向理解。"}'));
    const response = await handleApi(request('/api/chat', 'POST', {
      currentIssueId: 'issue-a',
      issue: { issue_id: 'issue-a', status: 'ACTIVE', topic_tags: ['CAREER'], handoff_offered: false, handoff_state: 'NOT_READY' },
      messages: [
        { role: 'user', content: '最近工作压力很大', issueId: 'issue-a' },
        { role: 'assistant', content: '你是不是在自我价值感上受影响？', issueId: 'issue-a' },
        { role: 'user', content: '你理解错了，不要往自我价值感上分析', issueId: 'issue-a' },
      ],
    }), baseEnv);
    const body = await json(response);

    expect(response.status).toBe(200);
    expect(body.analysis).toEqual(expect.objectContaining({
      control_intent: 'GENERAL_CHAT',
      issue_action: 'CONTINUE_CURRENT',
      current_issue_id: 'issue-a',
      new_issue_detected: false,
    }));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('阶段 1.3：Handler 对明确拒绝真人保留当前 Issue，不接受真人或结束对话', async () => {
    const response = await handleApi(request('/api/chat', 'POST', {
      currentIssueId: 'issue-a',
      issue: { issue_id: 'issue-a', status: 'HANDOFF_OFFERED', topic_tags: ['CAREER'], handoff_offered: true, handoff_state: 'OFFERED' },
      messages: [
        { role: 'user', content: '工作压力很大', issueId: 'issue-a' },
        { role: 'assistant', content: '如果你愿意，也可以预约真人。', issueId: 'issue-a' },
        { role: 'user', content: '暂时不想找真人，先这样聊聊就好', issueId: 'issue-a' },
      ],
    }), baseEnv);
    const body = await json(response);

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ model: 'control-rule', reply: '可以，我们继续按你舒服的节奏聊。' });
    expect(body.analysis).toEqual(expect.objectContaining({
      control_intent: 'DECLINE_HANDOFF',
      issue_action: 'CONTINUE_CURRENT',
      current_issue_id: 'issue-a',
      new_issue_detected: false,
      issue_status: 'ACTIVE',
      handoff_state: 'DECLINED',
    }));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('safety-gate 在危险+真人请求时优先阻断预约，普通真人请求直接放行', async () => {
    const blocked = await handleApi(request('/api/safety-gate', 'POST', {
      currentIssueId: 'issue-danger',
      messages: [
        { role: 'user', content: '我现在正准备伤害自己，想找真人导师', issueId: 'issue-danger' },
      ],
    }), baseEnv);
    expect(blocked.status).toBe(200);
    expect(await json(blocked)).toMatchObject({ allowed: false, safety_status: 'URGENT' });
    expect(fetchMock).not.toHaveBeenCalled();

    const allowed = await handleApi(request('/api/safety-gate', 'POST', {
      currentIssueId: 'issue-normal',
      messages: [{ role: 'user', content: '我想找真人导师聊聊', issueId: 'issue-normal' }],
    }), baseEnv);
    expect(allowed.status).toBe(200);
    expect(await json(allowed)).toMatchObject({ allowed: true, safety_status: 'NO_SIGNAL_DETECTED', reply: null });
  });

  it('chat 会保留当前 Issue 的近期风险，直到出现明确安全澄清', async () => {
    const blocked = await handleApi(request('/api/chat', 'POST', {
      currentIssueId: 'issue-danger',
      issue: { issue_id: 'issue-danger', status: 'ACTIVE', topic_tags: [], handoff_offered: false, handoff_state: 'NOT_READY' },
      messages: [
        { role: 'user', content: '我已经不想活了', issueId: 'issue-danger' },
        { role: 'assistant', content: '先确认你的安全', issueId: 'issue-danger' },
        { role: 'user', content: '我想找真人', issueId: 'issue-danger' },
      ],
    }), baseEnv);
    expect(blocked.status).toBe(200);
    expect(await json(blocked)).toMatchObject({ model: 'safety-rule', analysis: { safety_status: 'NEEDS_CLARIFICATION' } });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('booking-summary 返回摘要，并拒绝空消息请求', async () => {
    let postedBody: Record<string, unknown> | undefined;
    fetchMock.mockImplementationOnce(async (_input: RequestInfo | URL, init?: RequestInit) => {
      postedBody = JSON.parse(String(init?.body));
      return deepSeekResponse('这是一段纯文本预约摘要。');
    });
    const response = await handleApi(request('/api/booking-summary', 'POST', {
      sessionId: 'contract-summary-session',
      messages: [{ role: 'user', content: '我想找人帮我理清下一步。' }],
    }), baseEnv);
    expect(response.status).toBe(200);
    expect(await json(response)).toMatchObject({ summary: '这是一段纯文本预约摘要。', promptVersion: 'v1.9.0' });
    expect(postedBody).toEqual(expect.objectContaining({ stream: false }));
    expect(postedBody).not.toHaveProperty('response_format');
    expect(postedBody).not.toHaveProperty('max_tokens');

    const invalid = await handleApi(request('/api/booking-summary', 'POST', { messages: [] }), baseEnv);
    expect(invalid.status).toBe(400);
    expect(await json(invalid)).toMatchObject({ error: '没有可整理的聊天内容' });
  });

  it('appointments 使用生产表字段、富文本预约ID幂等重试和状态查询', async () => {
    let listCalls = 0;
    let createCalls = 0;
    const filters: string[] = [];
    let postedFields: Record<string, unknown> | undefined;
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method || 'GET';
      if (url.endsWith('/open-apis/auth/v3/tenant_access_token/internal')) {
        return new Response(JSON.stringify({ code: 0, tenant_access_token: 'mock-tenant-token', expire: 7_200 }), { status: 200 });
      }
      if (url.includes('/records?filter=')) {
        listCalls += 1;
        filters.push(decodeURIComponent(url.match(/[?&]filter=([^&]+)/)?.[1] || ''));
        const items = listCalls === 1 ? [] : [{ record_id: 'rec-staging-contract-001', fields: { 预约ID: [{ text: 'contract-request-001', type: 'text' }] } }];
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
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-02T00:03:04Z'));
    const created = await handleApi(request('/api/appointments', 'POST', input), baseEnv);
    expect(created.status).toBe(200);
    expect(await json(created)).toMatchObject({ status: 'submitted', recordId: 'rec-staging-contract-001' });
    expect(postedFields).toMatchObject({
      预约ID: input.requestId,
      客户昵称: input.nickname,
      联系方式: input.contact,
      当前困扰: input.concern,
      预约时间: '2026-01-02 08:03:04',
      处理状态: '待分配',
      希望获得什么帮助: input.desiredHelp,
    });
    expect(postedFields).not.toHaveProperty('预约编号');
    expect(postedFields).not.toHaveProperty('Source Environment');
    expect(postedFields).not.toHaveProperty('Request ID');

    const retried = await handleApi(request('/api/appointments', 'POST', input), baseEnv);
    expect(retried.status).toBe(200);
    expect(await json(retried)).toMatchObject({ idempotent: true, recordId: 'rec-staging-contract-001' });
    expect(createCalls).toBe(1);
    expect(filters).toEqual([
      'CurrentValue.[预约ID]="contract-request-001"',
      'CurrentValue.[预约ID]="contract-request-001"',
    ]);

    const status = await handleApi(request('/api/appointments/contract-request-001/status'), baseEnv);
    expect(status.status).toBe(200);
    expect(await json(status)).toMatchObject({ requestId: 'contract-request-001', recordId: 'rec-staging-contract-001', status: '待分配' });
  });

  it('appointments 允许省略希望获得什么帮助，并且不向飞书伪造该字段', async () => {
    let postedFields: Record<string, unknown> | undefined;
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method || 'GET';
      if (url.endsWith('/open-apis/auth/v3/tenant_access_token/internal')) return new Response(JSON.stringify({ code: 0, tenant_access_token: 'mock-tenant-token', expire: 7_200 }), { status: 200 });
      if (url.includes('/records?filter=')) return new Response(JSON.stringify({ code: 0, data: { items: [] } }), { status: 200 });
      if (method === 'POST' && url.endsWith('/records')) {
        postedFields = JSON.parse(String(init?.body)).fields;
        return new Response(JSON.stringify({ code: 0, data: { record: { record_id: 'rec-staging-optional-help-001' } } }), { status: 200 });
      }
      throw new Error(`unexpected mock request: ${method} ${url}`);
    });

    const response = await handleApi(request('/api/appointments', 'POST', {
      requestId: 'optional-help-request-001',
      nickname: 'Staging Mock User',
      contact: 'mock@example.invalid',
      concern: '仅用于验证选填字段。',
      consent: true,
      issueId: 'issue-optional-help-001',
    }), baseEnv);

    expect(response.status).toBe(200);
    expect(await json(response)).toMatchObject({ ok: true, status: 'submitted', recordId: 'rec-staging-optional-help-001' });
    expect(postedFields).not.toHaveProperty('希望获得什么帮助');
  });

  it('appointments 在后端复核预约摘要中的危险表达时不触发飞书写入', async () => {
    const response = await handleApi(request('/api/appointments', 'POST', {
      requestId: 'danger-request-001',
      nickname: 'Staging Mock User',
      contact: 'mock@example.invalid',
      concern: '我现在正准备伤害自己，想预约真人',
      desiredHelp: '先获得安全支持',
      consent: true,
      issueId: 'issue-danger',
    }), baseEnv);
    expect(response.status).toBe(409);
    expect(await json(response)).toMatchObject({ code: 'SAFETY_GATE_BLOCKED', safety_status: 'URGENT' });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
