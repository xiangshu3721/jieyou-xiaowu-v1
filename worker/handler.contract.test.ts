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
