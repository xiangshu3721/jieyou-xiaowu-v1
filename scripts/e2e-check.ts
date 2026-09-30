const baseUrl = process.env.API_BASE_URL || 'http://127.0.0.1:8787';

const response = await fetch(`${baseUrl}/api/health`);
if (!response.ok) throw new Error(`health failed: ${response.status}`);
const health = await response.json() as { ok: boolean; deepseekConfigured: boolean; feishuConfigured: boolean };
console.log(JSON.stringify({ health, next: health.deepseekConfigured && health.feishuConfigured ? 'ready-for-real-e2e' : 'blocked-by-external-config' }, null, 2));
if (!health.deepseekConfigured || !health.feishuConfigured) process.exitCode = 2;

export {};
