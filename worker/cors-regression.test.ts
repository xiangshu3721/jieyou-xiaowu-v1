import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { handleApi, type WorkerEnv } from './handler.ts';

const env: WorkerEnv = {
  DEEPSEEK_API_KEY: 'mock',
  DEEPSEEK_MODEL: 'deepseek-chat',
  DEEPSEEK_BASE_URL: 'https://deepseek.invalid',
  FEISHU_APP_ID: 'a',
  FEISHU_APP_SECRET: 'b',
  FEISHU_APP_TOKEN: 'c',
  FEISHU_TABLE_ID: 'd',
  FEISHU_BASE_URL: 'https://feishu.invalid',
  PROMPT_VERSION: 'v1.9.0',
  LEARNING_ENABLED: 'false',
  GROWTH_ENABLED: 'false',
};

const allowedOrigin = 'https://xiangshu3721.github.io';
const deniedOrigin = 'https://evil.example';

function request(path: string, method = 'GET', origin = allowedOrigin, body?: unknown) {
  return new Request(`https://api.example${path}`, {
    method,
    headers: { Origin: origin, 'Content-Type': 'text/plain;charset=UTF-8' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

describe('CORS regression contract', () => {
  afterEach(() => vi.restoreAllMocks());

  it('covers OPTIONS, health, validation errors, and DeepSeek errors for the allowed Origin', async () => {
    const preflight = await handleApi(request('/api/chat', 'OPTIONS'), env);
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get('Access-Control-Allow-Origin')).toBe(allowedOrigin);

    const health = await handleApi(request('/api/health'), env);
    expect(health.status).toBe(200);
    expect(health.headers.get('Access-Control-Allow-Origin')).toBe(allowedOrigin);

    const invalid = await handleApi(request('/api/chat', 'POST', allowedOrigin, {}), env);
    expect(invalid.status).toBe(400);
    expect(invalid.headers.get('Access-Control-Allow-Origin')).toBe(allowedOrigin);

    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('mock DeepSeek failure')));
    const failed = await handleApi(request('/api/chat', 'POST', allowedOrigin, { messages: [{ role: 'user', content: '测试业务异常' }] }), env);
    expect(failed.status).toBe(502);
    expect(failed.headers.get('Access-Control-Allow-Origin')).toBe(allowedOrigin);
  });

  it('does not return ACAO for a non-whitelisted Origin', async () => {
    const health = await handleApi(request('/api/health', 'GET', deniedOrigin), env);
    expect(health.headers.has('Access-Control-Allow-Origin')).toBe(false);

    const preflight = await handleApi(request('/api/chat', 'OPTIONS', deniedOrigin), env);
    expect(preflight.headers.has('Access-Control-Allow-Origin')).toBe(false);
  });

  it('keeps the web-entry outer 500 catch CORS policy persistent', () => {
    const source = readFileSync(new URL('../cloudbase/functions/web-entry.ts', import.meta.url), 'utf8');
    const catchStart = source.lastIndexOf('} catch (error) {');
    const catchBody = source.slice(catchStart);
    expect(catchBody).toContain("typeof incoming.headers.origin === 'string'");
    expect(catchBody).toContain('origin === productionOrigin');
    expect(catchBody).toContain("'Access-Control-Allow-Origin': productionOrigin");
    expect(catchBody).toContain(': {}');
    expect(catchBody).toContain('outgoing.writeHead(500');
  });
});
