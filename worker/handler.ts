import type { AppointmentInput, ChatMessage } from '../src/shared.js';
import { analyzeConversation, detectSafety, emergencyReply, resetForAwaitingTopic, safetyClarificationReply } from '../server/rules.js';
import { annotateAnalysis, applyDeclinedHandoff, messagesForIssue, parseIssueContext, resolveCurrentIssue, userContextText, userMessagesForIssue } from '../server/issue.js';
import { fallbackReply, mergeAnalysis, naturalReply, normalizeUserReply, parseAssistantOutput } from '../server/structured.js';
import { deleteLearningSession, learningDashboard, recordLearningEvent, recordMentorFeedback, reviewConversation, runLearningInsights } from '../server/learning-service.js';
import { createCloudBaseLearningStore } from './learning-store.js';
import { promptMetadata, prompts } from './prompts.js';

export interface WorkerEnv {
  DEEPSEEK_API_KEY?: string;
  DEEPSEEK_MODEL?: string;
  DEEPSEEK_BASE_URL?: string;
  FEISHU_APP_ID?: string;
  FEISHU_APP_SECRET?: string;
  FEISHU_APP_TOKEN?: string;
  FEISHU_TABLE_ID?: string;
  FEISHU_BASE_URL?: string;
  PROMPT_VERSION?: string;
  DEV_TOKEN?: string;
  CLOUDBASE_APIKEY?: string;
  CLOUDBASE_ENV_ID?: string;
  CLOUDBASE_API_ENDPOINT?: string;
  DB?: D1Database;
}

interface StoredAppointmentState {
  requestId: string;
  status: 'processing' | 'submitted' | 'failed';
  recordId?: string;
  createdAt: string;
  updatedAt: string;
  error?: string;
}

class ExternalServiceError extends Error {
  constructor(message: string, public readonly code: 'DEEPSEEK_UNAVAILABLE' | 'FEISHU_UNAVAILABLE') {
    super(message);
    this.name = 'ExternalServiceError';
  }
}

const jsonHeaders = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
};

const requestCounts = new Map<string, { count: number; resetAt: number }>();
let feishuTokenCache: { token: string; expiresAt: number } | null = null;
let learningStoreCache: { key: string; store: ReturnType<typeof createCloudBaseLearningStore> } | null = null;

function json(status: number, body: unknown, request?: Request) {
  const origin = request?.headers.get('Origin');
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...jsonHeaders,
      'Access-Control-Allow-Origin': origin || '*',
      'Access-Control-Allow-Headers': 'Content-Type, X-Dev-Token',
      'Access-Control-Allow-Methods': 'DELETE, GET, POST, OPTIONS',
    },
  });
}

function stringValue(value: unknown, max = 4_000) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function messagesValue(value: unknown): ChatMessage[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is ChatMessage => Boolean(item && typeof item === 'object' && ((item as ChatMessage).role === 'user' || (item as ChatMessage).role === 'assistant') && typeof (item as ChatMessage).content === 'string'))
    .slice(-40)
    .map((item) => ({ role: item.role, content: item.content.slice(0, 4_000), id: typeof item.id === 'string' ? item.id.slice(0, 120) : undefined, issueId: typeof item.issueId === 'string' ? item.issueId.slice(0, 120) : undefined, createdAt: typeof item.createdAt === 'string' ? item.createdAt.slice(0, 40) : undefined }));
}

function conversationText(messages: ChatMessage[]) {
  return messages.map((message) => `${message.role === 'user' ? '用户' : 'AI'}：${message.content}`).join('\n').slice(-18_000);
}

async function readBody(request: Request) {
  const bodyText = await request.text();
  if (new TextEncoder().encode(bodyText).byteLength > 1_500_000) throw new Error('请求体过大');
  try {
    return JSON.parse(bodyText || '{}') as Record<string, unknown>;
  } catch {
    throw new Error('请求格式不正确');
  }
}

function timeoutSignal(milliseconds: number) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), milliseconds);
  return { signal: controller.signal, clear: () => clearTimeout(timeout) };
}

function apiConfig(env: WorkerEnv) {
  return {
    deepseek: {
      apiKey: env.DEEPSEEK_API_KEY || '',
      model: env.DEEPSEEK_MODEL || 'deepseek-chat',
      baseUrl: env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com',
    },
    feishu: {
      appId: env.FEISHU_APP_ID || '',
      appSecret: env.FEISHU_APP_SECRET || '',
      appToken: env.FEISHU_APP_TOKEN || '',
      tableId: env.FEISHU_TABLE_ID || '',
      baseUrl: env.FEISHU_BASE_URL || 'https://open.feishu.cn',
    },
  };
}

function configurationStatus(env: WorkerEnv) {
  const config = apiConfig(env);
  return {
    deepseekConfigured: Boolean(config.deepseek.apiKey),
    feishuConfigured: Boolean(config.feishu.appId && config.feishu.appSecret && config.feishu.appToken && config.feishu.tableId),
    d1Configured: Boolean(env.DB),
    learningConfigured: Boolean(env.CLOUDBASE_APIKEY && env.CLOUDBASE_ENV_ID),
    devConfigured: Boolean(env.DEV_TOKEN),
  };
}

function learningStoreFor(env: WorkerEnv) {
  const key = `${env.CLOUDBASE_ENV_ID || ''}:${env.CLOUDBASE_APIKEY || ''}`;
  if (learningStoreCache?.key === key) return learningStoreCache.store;
  const store = createCloudBaseLearningStore(env);
  learningStoreCache = { key, store };
  return store;
}

function clientKey(request: Request) {
  return request.headers.get('CF-Connecting-IP') || request.headers.get('X-Forwarded-For')?.split(',')[0]?.trim() || 'anonymous';
}

function rateLimit(request: Request, pathname: string) {
  if (!['/api/chat', '/api/booking-summary', '/api/appointments', '/api/learning/events', '/api/learning/review'].includes(pathname)) return null;
  const key = `${clientKey(request)}:${pathname}`;
  const now = Date.now();
  const current = requestCounts.get(key);
  if (!current || current.resetAt <= now) {
    requestCounts.set(key, { count: 1, resetAt: now + 10 * 60_000 });
    return null;
  }
  current.count += 1;
  if (current.count > 30) return json(429, { error: '请求过于频繁，请稍后再试', code: 'RATE_LIMITED' }, request);
  return null;
}

async function callDeepSeek(env: WorkerEnv, messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>, temperature = 0.4) {
  const config = apiConfig(env).deepseek;
  if (!config.apiKey) throw new ExternalServiceError('DeepSeek 尚未配置', 'DEEPSEEK_UNAVAILABLE');
  const timeout = timeoutSignal(35_000);
  try {
    const response = await fetch(`${config.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.apiKey}` },
      body: JSON.stringify({ model: config.model, messages, temperature, stream: false }),
      signal: timeout.signal,
    });
    const payload = await response.json().catch(() => null) as { choices?: Array<{ message?: { content?: string } }>; error?: { message?: string } } | null;
    if (!response.ok) throw new ExternalServiceError(payload?.error?.message || `DeepSeek HTTP ${response.status}`, 'DEEPSEEK_UNAVAILABLE');
    const content = payload?.choices?.[0]?.message?.content?.trim();
    if (!content) throw new ExternalServiceError('DeepSeek 返回内容为空', 'DEEPSEEK_UNAVAILABLE');
    return content;
  } catch (error) {
    if (error instanceof ExternalServiceError) throw error;
    throw new ExternalServiceError(error instanceof Error ? error.message : 'DeepSeek 请求失败', 'DEEPSEEK_UNAVAILABLE');
  } finally {
    timeout.clear();
  }
}

function assertFeishuConfigured(env: WorkerEnv) {
  const config = apiConfig(env).feishu;
  if (!config.appId || !config.appSecret || !config.appToken || !config.tableId) throw new ExternalServiceError('飞书多维表格尚未配置', 'FEISHU_UNAVAILABLE');
  return config;
}

async function getTenantToken(env: WorkerEnv) {
  const config = assertFeishuConfigured(env);
  if (feishuTokenCache && feishuTokenCache.expiresAt > Date.now() + 60_000) return feishuTokenCache.token;
  const timeout = timeoutSignal(20_000);
  try {
    const response = await fetch(`${config.baseUrl}/open-apis/auth/v3/tenant_access_token/internal`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ app_id: config.appId, app_secret: config.appSecret }),
      signal: timeout.signal,
    });
    const payload = await response.json().catch(() => null) as { code?: number; msg?: string; tenant_access_token?: string; expire?: number } | null;
    if (!response.ok || payload?.code || !payload?.tenant_access_token) throw new ExternalServiceError(payload?.msg || `飞书鉴权失败 HTTP ${response.status}`, 'FEISHU_UNAVAILABLE');
    feishuTokenCache = { token: payload.tenant_access_token, expiresAt: Date.now() + (payload.expire || 7_200) * 1000 };
    return feishuTokenCache.token;
  } catch (error) {
    if (error instanceof ExternalServiceError) throw error;
    throw new ExternalServiceError(error instanceof Error ? error.message : '飞书鉴权失败', 'FEISHU_UNAVAILABLE');
  } finally {
    timeout.clear();
  }
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

async function createFeishuAppointment(env: WorkerEnv, input: AppointmentInput) {
  const config = assertFeishuConfigured(env);
  const token = await getTenantToken(env);
  const timeout = timeoutSignal(20_000);
  try {
    const response = await fetch(`${config.baseUrl}/open-apis/bitable/v1/apps/${config.appToken}/tables/${config.tableId}/records`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ fields: fieldsFor(input) }),
      signal: timeout.signal,
    });
    const payload = await response.json().catch(() => null) as { code?: number; msg?: string; data?: { record?: { record_id?: string } } } | null;
    if (!response.ok || payload?.code || !payload?.data?.record?.record_id) throw new ExternalServiceError(payload?.msg || `飞书写入失败 HTTP ${response.status}`, 'FEISHU_UNAVAILABLE');
    return payload.data.record.record_id;
  } catch (error) {
    if (error instanceof ExternalServiceError) throw error;
    throw new ExternalServiceError(error instanceof Error ? error.message : '飞书写入失败', 'FEISHU_UNAVAILABLE');
  } finally {
    timeout.clear();
  }
}

function recordRequestId(record: { record_id?: string; id?: string; fields?: Record<string, unknown> }) {
  const value = record.fields?.['预约编号'];
  return typeof value === 'string' ? value.trim() : '';
}

async function findFeishuAppointmentByRequestId(env: WorkerEnv, requestId: string) {
  const config = assertFeishuConfigured(env);
  const token = await getTenantToken(env);
  const escapedRequestId = requestId.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  const filter = `CurrentValue.[预约编号]="${escapedRequestId}"`;
  const timeout = timeoutSignal(20_000);
  try {
    const response = await fetch(`${config.baseUrl}/open-apis/bitable/v1/apps/${config.appToken}/tables/${config.tableId}/records?filter=${encodeURIComponent(filter)}&page_size=10`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: timeout.signal,
    });
    const payload = await response.json().catch(() => null) as {
      code?: number;
      msg?: string;
      data?: { items?: Array<{ record_id?: string; id?: string; fields?: Record<string, unknown> }> };
    } | null;
    if (!response.ok || payload?.code) throw new ExternalServiceError(payload?.msg || `飞书查询失败 HTTP ${response.status}`, 'FEISHU_UNAVAILABLE');
    const record = (payload?.data?.items || []).find((item) => recordRequestId(item) === requestId);
    if (!record) return null;
    const recordId = record.record_id || record.id;
    return recordId ? { recordId } : null;
  } catch (error) {
    if (error instanceof ExternalServiceError) throw error;
    throw new ExternalServiceError(error instanceof Error ? error.message : '飞书查询失败', 'FEISHU_UNAVAILABLE');
  } finally {
    timeout.clear();
  }
}

async function getFeishuAppointment(env: WorkerEnv, recordId: string) {
  const config = assertFeishuConfigured(env);
  const token = await getTenantToken(env);
  const timeout = timeoutSignal(20_000);
  try {
    const response = await fetch(`${config.baseUrl}/open-apis/bitable/v1/apps/${config.appToken}/tables/${config.tableId}/records/${encodeURIComponent(recordId)}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: timeout.signal,
    });
    const payload = await response.json().catch(() => null) as { code?: number; msg?: string; data?: { record?: { fields?: Record<string, unknown> } } } | null;
    if (!response.ok || payload?.code || !payload?.data?.record) throw new ExternalServiceError(payload?.msg || `飞书查询失败 HTTP ${response.status}`, 'FEISHU_UNAVAILABLE');
    const fields = payload.data.record.fields || {};
    const text = (key: string) => typeof fields[key] === 'string' ? fields[key] as string : undefined;
    return { status: text('处理状态'), assignedMentor: text('分配导师'), result: text('接待结果、最近跟进时间、备注') };
  } finally {
    timeout.clear();
  }
}

async function getAppointmentState(db: D1Database, requestId: string) {
  return await db.prepare('SELECT request_id as requestId, status, record_id as recordId, created_at as createdAt, updated_at as updatedAt, error FROM appointment_states WHERE request_id = ?').bind(requestId).first<StoredAppointmentState>();
}

async function saveAppointmentState(db: D1Database, state: StoredAppointmentState) {
  await db.prepare('UPDATE appointment_states SET status = ?, record_id = ?, created_at = ?, updated_at = ?, error = ? WHERE request_id = ?')
    .bind(state.status, state.recordId || null, state.createdAt, state.updatedAt, state.error || null, state.requestId)
    .run();
}

async function claimAppointment(db: D1Database, requestId: string) {
  const existing = await getAppointmentState(db, requestId);
  if (existing?.status === 'submitted' && existing.recordId) return { state: existing, claimed: false };
  if (existing?.status === 'processing') return { state: existing, claimed: false };
  const now = new Date().toISOString();
  if (existing?.status === 'failed') {
    const retry = await db.prepare("UPDATE appointment_states SET status = 'processing', record_id = NULL, updated_at = ?, error = NULL WHERE request_id = ? AND status = 'failed'").bind(now, requestId).run();
    if (retry.meta.changes === 1) return { state: { requestId, status: 'processing' as const, createdAt: existing.createdAt, updatedAt: now }, claimed: true };
    const latest = await getAppointmentState(db, requestId);
    return { state: latest || existing, claimed: false };
  }
  const inserted = await db.prepare("INSERT OR IGNORE INTO appointment_states (request_id, status, created_at, updated_at) VALUES (?, 'processing', ?, ?)").bind(requestId, now, now).run();
  const state = await getAppointmentState(db, requestId);
  return { state: state || { requestId, status: 'processing' as const, createdAt: now, updatedAt: now }, claimed: inserted.meta.changes === 1 };
}

function isDevAuthorized(request: Request, env: WorkerEnv) {
  return Boolean(env.DEV_TOKEN && request.headers.get('X-Dev-Token') === env.DEV_TOKEN);
}

export async function handleApi(request: Request, env: WorkerEnv) {
  const url = new URL(request.url);
  if (request.method === 'OPTIONS') return json(204, {}, request);
  const limited = rateLimit(request, url.pathname);
  if (limited) return limited;

  if (request.method === 'GET' && url.pathname === '/api/health') {
    return json(200, { ok: true, service: 'jieyou-xiaowu-v1', promptVersion: env.PROMPT_VERSION || 'v1.6.1', ...configurationStatus(env) }, request);
  }

  if (request.method === 'GET' && url.pathname === '/api/dev/rules') {
    if (!isDevAuthorized(request, env)) return json(401, { error: '需要 /dev 调试口令' }, request);
    return json(200, { promptMetadata: { ...promptMetadata, version: env.PROMPT_VERSION || 'v1.6.1' }, promptTexts: prompts, ...configurationStatus(env) }, request);
  }

  if (request.method === 'POST' && url.pathname === '/api/learning/events') {
    const body = await readBody(request);
    const result = await recordLearningEvent(body, learningStoreFor(env));
    return json(result.status, result.body, request);
  }

  if (request.method === 'POST' && url.pathname === '/api/learning/review') {
    const body = await readBody(request);
    const result = await reviewConversation(body, learningStoreFor(env), (messages, temperature) => callDeepSeek(env, messages, temperature), prompts.reviewer);
    return json(result.status, result.body, request);
  }

  if (request.method === 'POST' && url.pathname === '/api/learning/session/delete') {
    const body = await readBody(request);
    const result = await deleteLearningSession(body, learningStoreFor(env));
    return json(result.status, result.body, request);
  }

  if (request.method === 'GET' && url.pathname === '/api/learning/dashboard') {
    if (!isDevAuthorized(request, env)) return json(401, { error: '需要 /dev 调试口令' }, request);
    const result = await learningDashboard(learningStoreFor(env), env.PROMPT_VERSION || 'v1.6.1');
    return json(result.status, result.body, request);
  }

  if (request.method === 'POST' && url.pathname === '/api/learning/insights/run') {
    if (!isDevAuthorized(request, env)) return json(401, { error: '需要 /dev 调试口令' }, request);
    const result = await runLearningInsights(learningStoreFor(env), env.PROMPT_VERSION || 'v1.6.1');
    return json(result.status, result.body, request);
  }

  if (request.method === 'POST' && url.pathname === '/api/learning/mentor-feedback') {
    if (!isDevAuthorized(request, env)) return json(401, { error: '需要 /dev 调试口令' }, request);
    const body = await readBody(request);
    const result = await recordMentorFeedback(body, learningStoreFor(env));
    return json(result.status, result.body, request);
  }

  if (request.method === 'POST' && url.pathname === '/api/chat') {
    try {
      const body = await readBody(request);
      const messages = messagesValue(body.messages);
      const latestText = messages.filter((item) => item.role === 'user').at(-1)?.content || '';
      if (!messages.length || !latestText) return json(400, { error: '请先输入你想聊的内容' }, request);
      const requestedIssueId = typeof body.currentIssueId === 'string' && body.currentIssueId.trim() ? body.currentIssueId.trim() : undefined;
      const issueContext = parseIssueContext(body.issue, requestedIssueId || 'issue-current');
      const issueMessages = messagesForIssue(messages, issueContext.issue_id);
      const currentUserMessages = userMessagesForIssue(messages, issueContext.issue_id);
      const previousUserMessages = issueContext.status === 'AWAITING_TOPIC' ? [] : currentUserMessages.slice(0, -1);
      const resolution = resolveCurrentIssue({
        message: latestText,
        currentIssueId: issueContext.issue_id,
        currentIssue: issueContext,
        previousMessages: previousUserMessages,
        previousTopics: issueContext.topic_tags,
        safetyDetected: detectSafety(latestText) !== 'NO_SIGNAL_DETECTED',
      });
      const analysisMessages = resolution.issue_action === 'CREATE_NEW'
        ? (resolution.awaiting_topic ? [] : [{ role: 'user' as const, content: latestText }])
        : issueContext.status === 'AWAITING_TOPIC'
          ? [{ role: 'user' as const, content: latestText }]
          : issueMessages;
      const contextText = userContextText(analysisMessages.slice(0, -1));
      const userTurnCount = resolution.awaiting_topic
        ? 0
        : resolution.issue_action === 'CREATE_NEW' || issueContext.status === 'AWAITING_TOPIC'
          ? 1
          : Math.max(1, currentUserMessages.length);
      const rawBaseline = analyzeConversation(latestText, contextText, {
        issueId: resolution.current_issue_id,
        issueStatus: resolution.awaiting_topic ? 'AWAITING_TOPIC' : resolution.issue_action === 'CREATE_NEW' || issueContext.status === 'AWAITING_TOPIC' ? 'ACTIVE' : issueContext.status,
        userTurnCount,
        handoffOffered: resolution.issue_action === 'CREATE_NEW' ? false : issueContext.handoff_state === 'DECLINED' ? false : issueContext.handoff_offered,
        previousTopics: issueContext.topic_tags,
        newIssueDetected: resolution.new_issue_detected,
        newIssueConfidence: resolution.new_issue_confidence,
        controlIntent: resolution.control_intent,
      });
      let baseline = resolution.awaiting_topic ? resetForAwaitingTopic(rawBaseline, resolution.previous_issue_id) : annotateAnalysis(rawBaseline, resolution);
      if (resolution.control_intent === 'DECLINE_HANDOFF' || (resolution.issue_action === 'CONTINUE_CURRENT' && issueContext.handoff_state === 'DECLINED' && resolution.control_intent !== 'ACCEPT_HANDOFF')) baseline = applyDeclinedHandoff(baseline);
      if (baseline.safety_status === 'URGENT') return json(200, { reply: emergencyReply, analysis: baseline, promptVersion: env.PROMPT_VERSION || 'v1.6.1', model: 'safety-rule' }, request);
      if (baseline.safety_status === 'NEEDS_CLARIFICATION') return json(200, { reply: safetyClarificationReply, analysis: baseline, promptVersion: env.PROMPT_VERSION || 'v1.6.1', model: 'safety-rule' }, request);
      if (resolution.awaiting_topic) return json(200, { reply: '可以呀，换个话题。你想聊什么？', analysis: baseline, promptVersion: env.PROMPT_VERSION || 'v1.6.1', model: 'control-rule' }, request);
      if (resolution.control_intent === 'DECLINE_HANDOFF') return json(200, { reply: '可以，我们继续按你舒服的节奏聊。', analysis: baseline, promptVersion: env.PROMPT_VERSION || 'v1.6.1', model: 'control-rule' }, request);
      const serverGuidance = `\n\n服务端内部校验基线（不要原样展示给用户）：\n${JSON.stringify(baseline)}`;
      const raw = await callDeepSeek(env, [{ role: 'system', content: prompts.chat + serverGuidance }, ...analysisMessages.map(({ role, content }) => ({ role, content }))]);
      const parsed = parseAssistantOutput(raw);
      const analysis = mergeAnalysis(baseline, parsed);
      const reply = analysis.safety_status !== 'NO_SIGNAL_DETECTED' ? fallbackReply(analysis) : normalizeUserReply(parsed?.reply || naturalReply(raw) || fallbackReply(analysis), analysis);
      return json(200, { reply, analysis, promptVersion: env.PROMPT_VERSION || 'v1.6.1', model: apiConfig(env).deepseek.model }, request);
    } catch (error) {
      const message = error instanceof ExternalServiceError && error.code === 'DEEPSEEK_UNAVAILABLE' ? error.message : error instanceof Error ? error.message : 'AI 暂时没有回应，请稍后重试';
      return json(502, { error: message, code: 'DEEPSEEK_UNAVAILABLE' }, request);
    }
  }

  if (request.method === 'POST' && url.pathname === '/api/booking-summary') {
    try {
      const body = await readBody(request);
      const messages = messagesValue(body.messages);
      const currentIssueId = typeof body.currentIssueId === 'string' && body.currentIssueId.trim() ? body.currentIssueId.trim() : '';
      const scopedMessages = currentIssueId ? messagesForIssue(messages, currentIssueId) : messages;
      if (!scopedMessages.some((item) => item.role === 'user')) return json(400, { error: '没有可整理的聊天内容' }, request);
      const summary = await callDeepSeek(env, [{ role: 'system', content: prompts.summary }, { role: 'user', content: conversationText(scopedMessages.filter((item) => item.role === 'user')) }], 0.2);
      return json(200, { summary, currentIssueId: currentIssueId || undefined, promptVersion: env.PROMPT_VERSION || 'v1.6.1' }, request);
    } catch (error) {
      const message = error instanceof ExternalServiceError ? error.message : '摘要暂时生成失败';
      return json(502, { error: message, code: 'SUMMARY_UNAVAILABLE' }, request);
    }
  }

  if (request.method === 'POST' && url.pathname === '/api/appointments') {
    try {
      const body = await readBody(request);
      const input: AppointmentInput = {
        requestId: stringValue(body.requestId, 80),
        nickname: stringValue(body.nickname, 80),
        contact: stringValue(body.contact, 160),
        concern: stringValue(body.concern, 1_000),
        desiredHelp: stringValue(body.desiredHelp, 500),
        consent: body.consent === true,
      };
      if (!input.requestId || !input.nickname || !input.contact || !input.concern || !input.desiredHelp || !input.consent) return json(400, { error: '请完整填写预约信息并确认信息使用说明' }, request);
      if (!env.DB) {
        const existing = await findFeishuAppointmentByRequestId(env, input.requestId);
        if (existing) return json(200, { ok: true, requestId: input.requestId, recordId: existing.recordId, status: 'submitted', idempotent: true }, request);
        try {
          const recordId = await createFeishuAppointment(env, input);
          return json(200, { ok: true, requestId: input.requestId, recordId, status: 'submitted' }, request);
        } catch (error) {
          // 网络超时后先回查，避免用户重试时再次创建同一预约。
          try {
            const recovered = await findFeishuAppointmentByRequestId(env, input.requestId);
            if (recovered) return json(200, { ok: true, requestId: input.requestId, recordId: recovered.recordId, status: 'submitted', idempotent: true }, request);
          } catch { /* 回查失败时返回原始写入错误 */ }
          const message = error instanceof ExternalServiceError ? error.message : '预约写入失败，请稍后重试';
          return json(502, { error: message, code: 'FEISHU_UNAVAILABLE', requestId: input.requestId }, request);
        }
      }
      const claim = await claimAppointment(env.DB, input.requestId);
      if (!claim.claimed && claim.state?.status === 'submitted' && claim.state.recordId) return json(200, { ok: true, requestId: input.requestId, recordId: claim.state.recordId, status: 'submitted', idempotent: true }, request);
      if (!claim.claimed) return json(409, { error: '这次预约正在提交中，请稍候查看结果', code: 'APPOINTMENT_IN_PROGRESS', requestId: input.requestId }, request);
      try {
        const recordId = await createFeishuAppointment(env, input);
        await saveAppointmentState(env.DB, { requestId: input.requestId, status: 'submitted', recordId, createdAt: claim.state?.createdAt || new Date().toISOString(), updatedAt: new Date().toISOString() });
        return json(200, { ok: true, requestId: input.requestId, recordId, status: 'submitted' }, request);
      } catch (error) {
        const message = error instanceof ExternalServiceError ? error.message : '预约写入失败，请稍后重试';
        await saveAppointmentState(env.DB, { requestId: input.requestId, status: 'failed', createdAt: claim.state?.createdAt || new Date().toISOString(), updatedAt: new Date().toISOString(), error: message });
        return json(502, { error: message, code: 'FEISHU_UNAVAILABLE', requestId: input.requestId }, request);
      }
    } catch (error) {
      return json(500, { error: error instanceof Error ? error.message : '预约提交失败' }, request);
    }
  }

  const statusMatch = url.pathname.match(/^\/api\/appointments\/([^/]+)\/status$/);
  if (request.method === 'GET' && statusMatch) {
    const requestId = decodeURIComponent(statusMatch[1]);
    if (!env.DB) {
      const found = await findFeishuAppointmentByRequestId(env, requestId);
      if (!found) return json(404, { error: '找不到这次预约请求' }, request);
      let remote: { status?: string; assignedMentor?: string; result?: string } | undefined;
      try { remote = await getFeishuAppointment(env, found.recordId); } catch { /* 查询失败时仍保留已找到的提交状态 */ }
      return json(200, { requestId, status: remote?.status || 'submitted', recordId: found.recordId, assignedMentor: remote?.assignedMentor, result: remote?.result, updatedAt: new Date().toISOString() }, request);
    }
    const stored = await getAppointmentState(env.DB, requestId);
    if (!stored) return json(404, { error: '找不到这次预约请求' }, request);
    let remote: { status?: string; assignedMentor?: string; result?: string } | undefined;
    if (stored.recordId && configurationStatus(env).feishuConfigured) {
      try { remote = await getFeishuAppointment(env, stored.recordId); } catch { /* 飞书状态查询失败时保留本地真实提交状态 */ }
    }
    return json(200, { requestId, status: remote?.status || stored.status, recordId: stored.recordId, assignedMentor: remote?.assignedMentor, result: remote?.result, updatedAt: stored.updatedAt }, request);
  }

  return json(404, { error: '接口不存在' }, request);
}
