import { config } from './config.js';

export class DeepSeekUnavailableError extends Error {
  code = 'DEEPSEEK_UNAVAILABLE';
}

type DeepSeekMessage = { role: 'system' | 'user' | 'assistant'; content: string };

export async function callDeepSeek(messages: DeepSeekMessage[], temperature = 0.4) {
  if (!config.deepseek.apiKey) throw new DeepSeekUnavailableError('DeepSeek 尚未配置');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 35_000);
  try {
    const response = await fetch(`${config.deepseek.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.deepseek.apiKey}`,
      },
      body: JSON.stringify({ model: config.deepseek.model, messages, temperature, stream: false }),
      signal: controller.signal,
    });
    const payload = await response.json().catch(() => null) as { choices?: Array<{ message?: { content?: string } }>; error?: { message?: string } } | null;
    if (!response.ok) throw new DeepSeekUnavailableError(payload?.error?.message || `DeepSeek HTTP ${response.status}`);
    const content = payload?.choices?.[0]?.message?.content?.trim();
    if (!content) throw new DeepSeekUnavailableError('DeepSeek 返回内容为空');
    return content;
  } catch (error) {
    if (error instanceof DeepSeekUnavailableError) throw error;
    throw new DeepSeekUnavailableError(error instanceof Error ? error.message : 'DeepSeek 请求失败');
  } finally {
    clearTimeout(timeout);
  }
}
