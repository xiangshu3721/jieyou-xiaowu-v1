import http from 'node:http';
import type { ConversationAnalysis, AppointmentInput, ChatMessage } from '../src/shared.js';
import { config, configurationStatus } from './config.js';
import { callDeepSeek, DeepSeekUnavailableError } from './deepseek.js';
import { createFeishuAppointment, FeishuUnavailableError, getFeishuAppointment } from './feishu.js';
import { analyzeConversation, detectIssueSwitch, emergencyReply, safetyClarificationReply } from './rules.js';
import { createIssueId, messagesForIssue, parseIssueContext, userContextText, userMessagesForIssue } from './issue.js';
import { promptMetadata, prompts } from './prompts.js';
import { getAppointmentState, saveAppointmentState } from './state.js';
import { fallbackReply, mergeAnalysis, naturalReply, normalizeUserReply, parseAssistantOutput } from './structured.js';
import { FileLearningStore } from './learning-store.js';
import { deleteLearningSession, learningDashboard, recordLearningEvent, recordMentorFeedback, reviewConversation, runLearningInsights } from './learning-service.js';

const jsonHeaders = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' };
const learningStore = new FileLearningStore();

function send(response: http.ServerResponse, status: number, body: unknown) {
  response.writeHead(status, { ...jsonHeaders, 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type, X-Dev-Token', 'Access-Control-Allow-Methods': 'DELETE, GET, POST, OPTIONS' });
  response.end(JSON.stringify(body));
}

async function readBody(request: http.IncomingMessage) {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    size += Buffer.byteLength(chunk);
    if (size > 1_500_000) throw new Error('请求体过大');
    chunks.push(Buffer.from(chunk));
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') as Record<string, unknown>;
}

function stringValue(value: unknown, max = 4_000) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function messagesValue(value: unknown): ChatMessage[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is ChatMessage => Boolean(item && typeof item === 'object' && ((item as ChatMessage).role === 'user' || (item as ChatMessage).role === 'assistant') && typeof (item as ChatMessage).content === 'string')).slice(-40).map((item) => ({ role: item.role, content: item.content.slice(0, 4_000), id: typeof item.id === 'string' ? item.id.slice(0, 120) : undefined, issueId: typeof item.issueId === 'string' ? item.issueId.slice(0, 120) : undefined, createdAt: typeof item.createdAt === 'string' ? item.createdAt.slice(0, 40) : undefined }));
}

function conversationText(messages: ChatMessage[]) {
  return messages.map((message) => `${message.role === 'user' ? '用户' : 'AI'}：${message.content}`).join('\n').slice(-18_000);
}

function isDevAuthorized(request: http.IncomingMessage) {
  return Boolean(config.devToken && request.headers['x-dev-token'] === config.devToken);
}

async function handle(request: http.IncomingMessage, response: http.ServerResponse) {
  const url = new URL(request.url || '/', `http://${request.headers.host || '127.0.0.1'}`);
  if (request.method === 'OPTIONS') return send(response, 204, {});

  if (request.method === 'GET' && url.pathname === '/api/health') {
    return send(response, 200, { ok: true, service: 'jieyou-xiaowu-v1', promptVersion: config.promptVersion, learningConfigured: true, ...configurationStatus() });
  }

  if (request.method === 'GET' && url.pathname === '/api/dev/rules') {
    if (!isDevAuthorized(request)) return send(response, 401, { error: '需要 /dev 调试口令' });
    return send(response, 200, { promptMetadata, promptTexts: prompts, ...configurationStatus() });
  }

  if (request.method === 'POST' && url.pathname === '/api/learning/events') {
    const body = await readBody(request);
    const result = await recordLearningEvent(body, learningStore);
    return send(response, result.status, result.body);
  }

  if (request.method === 'POST' && url.pathname === '/api/learning/review') {
    const body = await readBody(request);
    const result = await reviewConversation(body, learningStore, callDeepSeek, prompts.reviewer);
    return send(response, result.status, result.body);
  }

  if (request.method === 'POST' && url.pathname === '/api/learning/session/delete') {
    const body = await readBody(request);
    const result = await deleteLearningSession(body, learningStore);
    return send(response, result.status, result.body);
  }

  if (request.method === 'GET' && url.pathname === '/api/learning/dashboard') {
    if (!isDevAuthorized(request)) return send(response, 401, { error: '需要 /dev 调试口令' });
    const result = await learningDashboard(learningStore, config.promptVersion);
    return send(response, result.status, result.body);
  }

  if (request.method === 'POST' && url.pathname === '/api/learning/insights/run') {
    if (!isDevAuthorized(request)) return send(response, 401, { error: '需要 /dev 调试口令' });
    const result = await runLearningInsights(learningStore, config.promptVersion);
    return send(response, result.status, result.body);
  }

  if (request.method === 'POST' && url.pathname === '/api/learning/mentor-feedback') {
    if (!isDevAuthorized(request)) return send(response, 401, { error: '需要 /dev 调试口令' });
    const body = await readBody(request);
    const result = await recordMentorFeedback(body, learningStore);
    return send(response, result.status, result.body);
  }

  if (request.method === 'POST' && url.pathname === '/api/chat') {
    const body = await readBody(request);
    const messages = messagesValue(body.messages);
    const userMessages = messages.filter((item) => item.role === 'user');
    const latestText = userMessages.at(-1)?.content || '';
    if (!messages.length || !latestText) return send(response, 400, { error: '请先输入你想聊的内容' });
    const requestedIssueId = typeof body.currentIssueId === 'string' && body.currentIssueId.trim() ? body.currentIssueId.trim() : undefined;
    const issueContext = parseIssueContext(body.issue, requestedIssueId || 'issue-current');
    const issueMessages = messagesForIssue(messages, issueContext.issue_id);
    const currentUserMessages = userMessagesForIssue(messages, issueContext.issue_id);
    const previousUserMessages = currentUserMessages.slice(0, -1);
    const switchResult = detectIssueSwitch(latestText, userContextText(previousUserMessages), issueContext.topic_tags);
    const activeIssueId = switchResult.detected ? createIssueId() : issueContext.issue_id;
    const analysisMessages = switchResult.detected ? [{ role: 'user' as const, content: latestText }] : issueMessages;
    const contextText = userContextText(analysisMessages.slice(0, -1));
    const baseline = analyzeConversation(latestText, contextText, { issueId: activeIssueId, issueStatus: switchResult.detected ? 'ACTIVE' : issueContext.status, userTurnCount: switchResult.detected ? 1 : Math.max(1, currentUserMessages.length), handoffOffered: switchResult.detected ? false : issueContext.handoff_offered, previousTopics: issueContext.topic_tags, newIssueDetected: switchResult.detected, newIssueConfidence: switchResult.confidence });
    if (baseline.safety_status === 'URGENT') {
      return send(response, 200, { reply: emergencyReply, analysis: baseline, promptVersion: config.promptVersion, model: 'safety-rule' });
    }
    if (baseline.safety_status === 'NEEDS_CLARIFICATION') {
      return send(response, 200, { reply: safetyClarificationReply, analysis: baseline, promptVersion: config.promptVersion, model: 'safety-rule' });
    }
    try {
      const serverGuidance = `\n\n服务端内部校验基线（不要原样展示给用户）：\n${JSON.stringify(baseline)}`;
      const raw = await callDeepSeek([{ role: 'system', content: prompts.chat + serverGuidance }, ...analysisMessages.map(({ role, content }) => ({ role, content }))]);
      const parsed = parseAssistantOutput(raw);
      const analysis = mergeAnalysis(baseline, parsed);
      const reply = analysis.safety_status !== 'NO_SIGNAL_DETECTED' ? fallbackReply(analysis) : normalizeUserReply(parsed?.reply || naturalReply(raw) || fallbackReply(analysis), analysis);
      return send(response, 200, { reply, analysis, promptVersion: config.promptVersion, model: config.deepseek.model });
    } catch (error) {
      const message = error instanceof DeepSeekUnavailableError ? error.message : 'AI 暂时没有回应，请稍后重试';
      return send(response, 502, { error: message, code: 'DEEPSEEK_UNAVAILABLE' });
    }
  }

  if (request.method === 'POST' && url.pathname === '/api/booking-summary') {
    const body = await readBody(request);
    const messages = messagesValue(body.messages);
    const currentIssueId = typeof body.currentIssueId === 'string' && body.currentIssueId.trim() ? body.currentIssueId.trim() : '';
    const scopedMessages = currentIssueId ? messagesForIssue(messages, currentIssueId) : messages;
    if (!scopedMessages.some((item) => item.role === 'user')) return send(response, 400, { error: '没有可整理的聊天内容' });
    try {
      const userOnlyText = conversationText(scopedMessages.filter((item) => item.role === 'user'));
      const summary = await callDeepSeek([
        { role: 'system', content: prompts.summary },
        { role: 'user', content: userOnlyText },
      ], 0.2);
      return send(response, 200, { summary, promptVersion: config.promptVersion });
    } catch (error) {
      const message = error instanceof DeepSeekUnavailableError ? error.message : '摘要暂时生成失败';
      return send(response, 502, { error: message, code: 'SUMMARY_UNAVAILABLE' });
    }
  }

  if (request.method === 'POST' && url.pathname === '/api/appointments') {
    const body = await readBody(request);
    const input: AppointmentInput = {
      requestId: stringValue(body.requestId, 80),
      nickname: stringValue(body.nickname, 80),
      contact: stringValue(body.contact, 160),
      concern: stringValue(body.concern, 1_000),
      desiredHelp: stringValue(body.desiredHelp, 500),
      consent: body.consent === true,
    };
    if (!input.requestId || !input.nickname || !input.contact || !input.concern || !input.desiredHelp || !input.consent) return send(response, 400, { error: '请完整填写预约信息并确认信息使用说明' });
    const existing = getAppointmentState(input.requestId);
    if (existing?.status === 'submitted' && existing.recordId) return send(response, 200, { ok: true, requestId: input.requestId, recordId: existing.recordId, status: 'submitted', idempotent: true });
    const now = new Date().toISOString();
    saveAppointmentState({ requestId: input.requestId, status: 'processing', createdAt: existing?.createdAt || now, updatedAt: now });
    try {
      const recordId = await createFeishuAppointment(input);
      saveAppointmentState({ requestId: input.requestId, status: 'submitted', recordId, createdAt: existing?.createdAt || now, updatedAt: new Date().toISOString() });
      return send(response, 200, { ok: true, requestId: input.requestId, recordId, status: 'submitted' });
    } catch (error) {
      const message = error instanceof FeishuUnavailableError ? error.message : '预约写入失败，请稍后重试';
      saveAppointmentState({ requestId: input.requestId, status: 'failed', createdAt: existing?.createdAt || now, updatedAt: new Date().toISOString(), error: message });
      return send(response, 502, { error: message, code: 'FEISHU_UNAVAILABLE', requestId: input.requestId });
    }
  }

  const statusMatch = url.pathname.match(/^\/api\/appointments\/([^/]+)\/status$/);
  if (request.method === 'GET' && statusMatch) {
    const requestId = decodeURIComponent(statusMatch[1]);
    const stored = getAppointmentState(requestId);
    if (!stored) return send(response, 404, { error: '找不到这次预约请求' });
    let remote: { status?: string; assignedMentor?: string; result?: string } | undefined;
    if (stored.recordId && configurationStatus().feishuConfigured) {
      try { remote = await getFeishuAppointment(stored.recordId); } catch { /* 状态查询失败时保留本地真实提交状态 */ }
    }
    return send(response, 200, { requestId, status: remote?.status || stored.status, recordId: stored.recordId, assignedMentor: remote?.assignedMentor, result: remote?.result, updatedAt: stored.updatedAt });
  }

  return send(response, 404, { error: '接口不存在' });
}

export function createApiServer() {
  return http.createServer((request, response) => {
    handle(request, response).catch((error) => send(response, 500, { error: error instanceof Error ? error.message : '服务器错误' }));
  });
}
