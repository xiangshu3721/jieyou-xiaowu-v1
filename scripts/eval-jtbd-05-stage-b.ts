/**
 * JTBD-05 Stage B: isolated, single-version DeepSeek experience evaluator.
 *
 * This runner is deliberately separate from the normal API configuration:
 * - it reads only the existing fictional JTBD-05 cases;
 * - it injects deepseek-flash only for this process;
 * - every fetch, including an unexpected one, is intercepted before network I/O;
 * - the default is a no-network dry run. Live mode needs an explicit, separate
 *   confirmation argument and a private report path.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

type ChatMessage = { role: 'user' | 'assistant'; content: string; issueId: string };
type IssueState = {
  issue_id: string;
  status: string;
  topic_tags: unknown[];
  handoff_offered: boolean;
  handoff_state: string;
  booking_case_id: null;
};
type ChatResult = {
  reply?: string;
  reply_parts?: string[];
  model?: string;
  analysis?: Record<string, unknown>;
  diagnostics?: Record<string, unknown>;
  error?: string;
  code?: string;
};
type HandleApi = (request: Request, env: Record<string, string | undefined>) => Promise<Response>;
type Usage = { total_tokens?: number; prompt_tokens?: number; completion_tokens?: number };
type Transport = (url: string, init: RequestInit) => Promise<Response>;

const endpoint = 'https://api.deepseek.com/chat/completions';
const model = 'deepseek-flash';
const maxRequests = 50;
const budgetRmb = 10;
const maxMessageBytes = 40_000;
const internalPromptReserveTokens = 10_000;
const maxOutputTokens = 1_600;
const inputRmbPerMillion = 2;
const outputRmbPerMillion = 8;
// Treat every UTF-8 byte as a possible token, then add internal prompt reserve.
// This is intentionally much more conservative than normal Chinese tokenization.
const reservedInputTokens = maxMessageBytes + internalPromptReserveTokens;
const reservationRmb = (reservedInputTokens * inputRmbPerMillion + maxOutputTokens * outputRmbPerMillion) / 1_000_000;
const liveConfirmation = 'USER_CONFIRMED_STAGE_B_DEEPSEEK_FLASH';

class StageBGuardError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
  }
}

type GuardRecord = {
  attempt: number;
  url: string;
  reservedRmb: number;
  cumulativeReservedRmb: number;
  model: string;
  thinkingDisabled: boolean;
  maxTokens: number;
  messageBytes: number;
  httpStatus?: number;
  usage?: Usage;
  actualRmb?: number | null;
};

type GuardOptions = { maxRequests?: number; budgetRmb?: number };

class OutboundGuard {
  readonly records: GuardRecord[] = [];
  private reservedRmb = 0;
  private sent = 0;
  private actualRmb = 0;

  constructor(private readonly options: Required<GuardOptions> = { maxRequests, budgetRmb }) {}

  snapshot() {
    return {
      sent: this.sent,
      maxRequests: this.options.maxRequests,
      reservedRmb: roundRmb(this.reservedRmb),
      actualRmb: roundRmb(this.actualRmb),
      reservationRmb: roundRmb(reservationRmb),
      budgetRmb: this.options.budgetRmb,
    };
  }

  async fetch(input: RequestInfo | URL, init: RequestInit | undefined, transport: Transport): Promise<Response> {
    const requestUrl = input instanceof Request ? input.url : input.toString();
    if (requestUrl !== endpoint) throw new StageBGuardError('OUTBOUND_URL_BLOCKED', `Stage B only permits ${endpoint}`);
    const method = (init?.method || (input instanceof Request ? input.method : 'GET')).toUpperCase();
    if (method !== 'POST') throw new StageBGuardError('OUTBOUND_METHOD_BLOCKED', 'Stage B model call must use POST');
    const rawBody = typeof init?.body === 'string' ? init.body : null;
    if (!rawBody) throw new StageBGuardError('OUTBOUND_BODY_BLOCKED', 'Stage B requires a JSON request body');

    let parsed: { model?: unknown; messages?: unknown; max_tokens?: unknown; thinking?: unknown };
    try {
      parsed = JSON.parse(rawBody) as typeof parsed;
    } catch {
      throw new StageBGuardError('OUTBOUND_BODY_BLOCKED', 'Stage B request body must be JSON');
    }
    if (parsed.model !== model) throw new StageBGuardError('OUTBOUND_MODEL_BLOCKED', `Stage B only permits ${model}`);
    if (!Array.isArray(parsed.messages)) throw new StageBGuardError('OUTBOUND_MESSAGES_BLOCKED', 'Stage B requires model messages');
    const messageBytes = parsed.messages.reduce((total, item) => {
      if (!item || typeof item !== 'object' || typeof (item as { content?: unknown }).content !== 'string') {
        throw new StageBGuardError('OUTBOUND_MESSAGES_BLOCKED', 'Stage B message content must be text');
      }
      return total + new TextEncoder().encode((item as { content: string }).content).byteLength;
    }, 0);
    if (messageBytes > maxMessageBytes) throw new StageBGuardError('OUTBOUND_SIZE_BLOCKED', `Stage B messages exceed ${maxMessageBytes} UTF-8 bytes`);
    const requestedMax = typeof parsed.max_tokens === 'number' ? parsed.max_tokens : maxOutputTokens;
    if (!Number.isInteger(requestedMax) || requestedMax < 1 || requestedMax > maxOutputTokens) {
      throw new StageBGuardError('OUTBOUND_MAX_TOKENS_BLOCKED', `Stage B max_tokens must be 1-${maxOutputTokens}`);
    }
    if (this.sent + 1 > this.options.maxRequests) throw new StageBGuardError('OUTBOUND_REQUEST_LIMIT', `Stage B limit is ${this.options.maxRequests} model requests`);
    if (this.reservedRmb + reservationRmb > this.options.budgetRmb + Number.EPSILON) {
      throw new StageBGuardError('OUTBOUND_BUDGET_BLOCKED', `Stage B reservation would exceed ¥${this.options.budgetRmb}`);
    }

    // Enforce the actual outbound payload, rather than trusting the handler's
    // production defaults. This is the only place the isolated process adds it.
    const outgoing = { ...parsed, model, max_tokens: requestedMax, thinking: { type: 'disabled' as const } };
    this.sent += 1;
    this.reservedRmb += reservationRmb;
    const record: GuardRecord = {
      attempt: this.sent,
      url: requestUrl,
      reservedRmb: roundRmb(reservationRmb),
      cumulativeReservedRmb: roundRmb(this.reservedRmb),
      model,
      thinkingDisabled: true,
      maxTokens: requestedMax,
      messageBytes,
    };
    this.records.push(record);

    let response: Response;
    try {
      response = await transport(endpoint, { ...init, method: 'POST', body: JSON.stringify(outgoing) });
    } catch (error) {
      // Reservation is intentionally retained: a transport failure can still
      // have reached the provider, and automatic retries are forbidden.
      throw error;
    }
    record.httpStatus = response.status;
    try {
      const payload = await response.clone().json() as { usage?: Usage };
      record.usage = payload.usage;
      if (payload.usage && typeof payload.usage.prompt_tokens === 'number' && typeof payload.usage.completion_tokens === 'number') {
        const actual = (payload.usage.prompt_tokens * inputRmbPerMillion + payload.usage.completion_tokens * outputRmbPerMillion) / 1_000_000;
        record.actualRmb = roundRmb(actual);
        this.actualRmb += actual;
      } else {
        record.actualRmb = null;
      }
    } catch {
      record.actualRmb = null;
    }
    return response;
  }
}

function roundRmb(value: number) {
  return Number(value.toFixed(8));
}

function stageBEnv(apiKey: string) {
  return {
    DEEPSEEK_API_KEY: apiKey,
    DEEPSEEK_MODEL: model,
    DEEPSEEK_BASE_URL: 'https://api.deepseek.com',
    PROMPT_VERSION: 'jtbd-05-stage-b-isolated',
    // Deliberately omit all Feishu, appointment and CloudBase variables.
  };
}

async function loadHandler(root: string) {
  const server = await createServer({ root, appType: 'custom', configFile: false, server: { middlewareMode: true, hmr: false } });
  const module = await server.ssrLoadModule('/worker/handler.ts') as { handleApi: HandleApi };
  return { handleApi: module.handleApi, close: () => server.close() };
}

function mockCompletion(content = '我听见你现在被这件事压得很累。我们可以先停在这里，不急着把它解释清楚。') {
  return new Response(JSON.stringify({
    model,
    choices: [{ finish_reason: 'stop', message: { content } }],
    usage: { prompt_tokens: 180, completion_tokens: 32, total_tokens: 212 },
  }), { status: 200, headers: { 'content-type': 'application/json' } });
}

async function invokeHandler(handleApi: HandleApi, env: Record<string, string | undefined>, user: string, sessionId = 'stage-b-dry-run') {
  const issue: IssueState = { issue_id: `${sessionId}-issue`, status: 'ACTIVE', topic_tags: [], handoff_offered: false, handoff_state: 'NOT_READY', booking_case_id: null };
  return handleApi(new Request('https://isolated.invalid/api/chat', {
    method: 'POST', headers: { 'content-type': 'application/json', 'CF-Connecting-IP': 'stage-b-dry-run' },
    body: JSON.stringify({ sessionId, currentIssueId: issue.issue_id, issue, issues: [issue], messages: [{ role: 'user', content: user, issueId: issue.issue_id }] }),
  }), env);
}

function validRequestBody(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({ model, messages: [{ role: 'system', content: 'x' }, { role: 'user', content: '虚构测试' }], max_tokens: maxOutputTokens, ...overrides });
}

async function expectGuardError(expectedCode: string, operation: () => Promise<unknown>) {
  await assert.rejects(operation, (error: unknown) => error instanceof StageBGuardError && error.code === expectedCode);
}

async function runDryRun(root: string) {
  const loaded = await loadHandler(root);
  const originalFetch = globalThis.fetch;
  const sentBodies: Array<Record<string, unknown>> = [];
  const guard = new OutboundGuard();
  const transport: Transport = async (_url, init) => {
    sentBodies.push(JSON.parse(String(init.body)) as Record<string, unknown>);
    return mockCompletion();
  };
  try {
    globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => guard.fetch(input, init, transport)) as typeof fetch;
    const response = await invokeHandler(loaded.handleApi, stageBEnv('stage-b-dry-run-key'), '虚构演练：今天工作压得我很累，我现在只想说说。');
    const body = await response.json() as ChatResult;
    assert.equal(response.status, 200);
    assert.ok(body.reply);
    assert.equal(guard.snapshot().sent, 1);
    assert.equal(sentBodies.length, 1);
    assert.equal(sentBodies[0].model, model);
    assert.deepEqual(sentBodies[0].thinking, { type: 'disabled' });
    assert.equal(sentBodies[0].max_tokens, maxOutputTokens);

    let unexpectedTransportCalls = 0;
    const noTransport: Transport = async () => {
      unexpectedTransportCalls += 1;
      return mockCompletion();
    };
    await expectGuardError('OUTBOUND_URL_BLOCKED', () => guard.fetch('https://example.invalid/chat/completions', { method: 'POST', body: validRequestBody() }, noTransport));
    await expectGuardError('OUTBOUND_MODEL_BLOCKED', () => guard.fetch(endpoint, { method: 'POST', body: validRequestBody({ model: 'deepseek-chat' }) }, noTransport));
    assert.equal(unexpectedTransportCalls, 0);

    const budgetGuard = new OutboundGuard({ maxRequests: 50, budgetRmb: reservationRmb * 2 });
    await budgetGuard.fetch(endpoint, { method: 'POST', body: validRequestBody() }, noTransport);
    await budgetGuard.fetch(endpoint, { method: 'POST', body: validRequestBody() }, noTransport);
    await expectGuardError('OUTBOUND_BUDGET_BLOCKED', () => budgetGuard.fetch(endpoint, { method: 'POST', body: validRequestBody() }, noTransport));

    const requestGuard = new OutboundGuard({ maxRequests: 2, budgetRmb: budgetRmb });
    await requestGuard.fetch(endpoint, { method: 'POST', body: validRequestBody() }, noTransport);
    await requestGuard.fetch(endpoint, { method: 'POST', body: validRequestBody() }, noTransport);
    await expectGuardError('OUTBOUND_REQUEST_LIMIT', () => requestGuard.fetch(endpoint, { method: 'POST', body: validRequestBody() }, noTransport));

    const failureGuard = new OutboundGuard();
    globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => failureGuard.fetch(input, init, async () => new Response(JSON.stringify({ error: { message: 'mock failure' } }), { status: 503, headers: { 'content-type': 'application/json' } }))) as typeof fetch;
    const failed = await invokeHandler(loaded.handleApi, stageBEnv('stage-b-dry-run-key'), '虚构演练：我今天很烦。', 'stage-b-failure');
    assert.equal(failed.status, 502);
    assert.equal(failureGuard.snapshot().sent, 1);
    assert.equal(failureGuard.snapshot().reservedRmb, roundRmb(reservationRmb));

    return {
      status: 'DRY_RUN_PASS',
      noNetwork: true,
      model,
      thinking: { type: 'disabled' },
      endpoint,
      guard: guard.snapshot(),
      checks: ['full-handler-mock', 'outbound-whitelist', 'model-and-thinking', 'budget-pre-reservation', 'request-count-limit', 'failure-no-retry'],
    };
  } finally {
    globalThis.fetch = originalFetch;
    await loaded.close();
  }
}

type ExistingCase = { id: string; description?: string; category?: string; turns: Array<{ role: string; content: string }> };
type PlannedCase = { id: string; description: string; users: string[]; pilot: boolean; safetyFinal?: boolean };

function loadExistingCases(root: string): PlannedCase[] {
  const source = JSON.parse(fs.readFileSync(path.join(root, 'tests/jtbd-05-scenarios.json'), 'utf8')) as { scenarios: ExistingCase[]; multi_turn_sequences: ExistingCase[] };
  const single = new Map(source.scenarios.map((item) => [item.id, item]));
  const multi = new Map(source.multi_turn_sequences.map((item) => [item.id, item]));
  const plans: Array<{ id: string; pilot?: boolean; safetyFinal?: boolean }> = [
    { id: 'MT01-full-venting-to-progress', pilot: true },
    { id: 'MT03-no-help-route-change', pilot: true },
    { id: 'MT05-correction-handoff-recovery', pilot: true },
    { id: 'MT02-pause-resume-resolve' },
    { id: 'MT04-safety-override-resolution', safetyFinal: true },
    { id: 'MT09-new-topic-and-return' },
    { id: 'MT10-safety-overrides-control', safetyFinal: true },
    { id: 'S09-medication-boundary' },
    { id: 'S10-handoff-accept' },
    { id: 'S11-handoff-decline' },
    { id: 'S15-correction-no-repeat-question' },
  ];
  return plans.map((plan) => {
    const sourceCase = multi.get(plan.id) || single.get(plan.id);
    if (!sourceCase) throw new Error(`STAGE_B_CASE_NOT_FOUND:${plan.id}`);
    return {
      id: sourceCase.id,
      description: sourceCase.description || sourceCase.category || sourceCase.id,
      users: sourceCase.turns.filter((turn) => turn.role === 'user').map((turn) => turn.content),
      pilot: plan.pilot === true,
      safetyFinal: plan.safetyFinal,
    };
  });
}

function issueFromResult(analysis: Record<string, unknown>, fallbackIssueId: string): IssueState {
  return {
    issue_id: typeof analysis.current_issue_id === 'string' ? analysis.current_issue_id : fallbackIssueId,
    status: typeof analysis.issue_status === 'string' ? analysis.issue_status : 'ACTIVE',
    topic_tags: Array.isArray(analysis.tags) ? analysis.tags : [],
    handoff_offered: analysis.handoff_offered === true,
    handoff_state: typeof analysis.handoff_state === 'string' ? analysis.handoff_state : 'NOT_READY',
    booking_case_id: null,
  };
}

function retainIssueTransition(issues: Map<string, IssueState>, previousId: string, next: IssueState, analysis: Record<string, unknown>) {
  const previousIssueId = typeof analysis.previous_issue_id === 'string' ? analysis.previous_issue_id : null;
  const pausedId = previousIssueId && previousIssueId !== next.issue_id ? previousIssueId : next.issue_id !== previousId ? previousId : null;
  if (pausedId) {
    const old = issues.get(pausedId);
    if (old && old.status !== 'BOOKING_SUBMITTED') issues.set(pausedId, { ...old, status: 'PAUSED' });
  }
  issues.set(next.issue_id, next);
}

async function runLive(root: string, out: string) {
  if (process.env.DEEPSEEK_API_KEY?.trim().length === 0 || !process.env.DEEPSEEK_API_KEY) throw new Error('BLOCKED_NO_DEEPSEEK_KEY');
  const cases = loadExistingCases(root);
  const loaded = await loadHandler(root);
  const originalFetch = globalThis.fetch;
  const guard = new OutboundGuard();
  const started = new Date().toISOString();
  const results: Array<Record<string, unknown>> = [];
  try {
    globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => guard.fetch(input, init, (url, request) => originalFetch(url, request))) as typeof fetch;
    for (const scenario of cases) {
      let activeIssueId = `stage-b-${scenario.id}`;
      const issues = new Map<string, IssueState>([[activeIssueId, { issue_id: activeIssueId, status: 'ACTIVE', topic_tags: [], handoff_offered: false, handoff_state: 'NOT_READY', booking_case_id: null }]]);
      const messages: ChatMessage[] = [];
      const turns: Array<Record<string, unknown>> = [];
      for (const user of scenario.users) {
        const current = issues.get(activeIssueId)!;
        messages.push({ role: 'user', content: user, issueId: activeIssueId });
        const beforeCalls = guard.snapshot().sent;
        const turnStarted = performance.now();
        const response = await loaded.handleApi(new Request('https://isolated.invalid/api/chat', {
          method: 'POST', headers: { 'content-type': 'application/json', 'CF-Connecting-IP': `stage-b-${scenario.id}-${turns.length}` },
          body: JSON.stringify({ sessionId: `stage-b-${scenario.id}`, currentIssueId: activeIssueId, issue: current, issues: [...issues.values()], messages }),
        }), stageBEnv(process.env.DEEPSEEK_API_KEY));
        const body = await response.json() as ChatResult;
        if (!response.ok || !body.reply || !body.analysis) throw new Error(`STAGE_B_HANDLER_FAILED:${scenario.id}:${response.status}:${body.code || body.error || 'empty reply'}`);
        const next = issueFromResult(body.analysis, activeIssueId);
        if (next.issue_id !== activeIssueId) messages[messages.length - 1] = { ...messages[messages.length - 1], issueId: next.issue_id };
        retainIssueTransition(issues, activeIssueId, next, body.analysis);
        activeIssueId = next.issue_id;
        messages.push({ role: 'assistant', content: body.reply, issueId: activeIssueId });
        turns.push({
          user,
          reply: body.reply,
          reply_parts: body.reply_parts || [body.reply],
          model: body.model,
          diagnostics: body.diagnostics || null,
          analysis: body.analysis,
          latencyMs: Math.round(performance.now() - turnStarted),
          modelOutboundRequests: guard.snapshot().sent - beforeCalls,
        });
      }
      if (scenario.safetyFinal) {
        const final = turns.at(-1) as { analysis?: { safety_status?: unknown }; modelOutboundRequests?: unknown } | undefined;
        if (final?.analysis?.safety_status !== 'URGENT' || final.modelOutboundRequests !== 0) {
          throw new Error(`STAGE_B_SAFETY_GATE_FAILED:${scenario.id}`);
        }
      }
      results.push({ id: scenario.id, description: scenario.description, phase: scenario.pilot ? 'pilot' : 'remaining', turns });
    }
  } finally {
    globalThis.fetch = originalFetch;
    await loaded.close();
  }
  const report = {
    kind: 'JTBD_05_STAGE_B_SINGLE_VERSION',
    mode: 'live',
    generatedAt: started,
    model,
    thinking: { type: 'disabled' },
    endpoint,
    rateAssumptionRmbPerMillion: { inputCacheMiss: inputRmbPerMillion, output: outputRmbPerMillion },
    guard: guard.snapshot(),
    outboundRecords: guard.records,
    cases: results,
    experienceStatus: 'RESPONSES_COLLECTED_AWAITING_HUMAN_REVIEW',
  };
  const resolved = path.resolve(out);
  if (!resolved.startsWith('/private/tmp/')) throw new Error('STAGE_B_REPORT_MUST_BE_PRIVATE_TMP');
  fs.mkdirSync(path.dirname(resolved), { recursive: true, mode: 0o700 });
  fs.chmodSync(path.dirname(resolved), 0o700);
  fs.writeFileSync(resolved, JSON.stringify(report, null, 2), { encoding: 'utf8', mode: 0o600 });
  console.log(JSON.stringify({ status: report.experienceStatus, reportFile: resolved, guard: report.guard, cases: results.length }, null, 2));
}

const args = new Map(process.argv.slice(2).map((value) => {
  const [key, ...rest] = value.split('=');
  return [key, rest.join('=')];
}));
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const live = args.has('--live');

if (live) {
  if (args.get('--confirm-real') !== liveConfirmation) throw new Error('BLOCKED_MODEL_AUTHORIZATION');
  const out = args.get('--out');
  if (!out) throw new Error('STAGE_B_LIVE_REPORT_PATH_REQUIRED');
  await runLive(root, out);
} else {
  console.log(JSON.stringify(await runDryRun(root), null, 2));
}
