import type { ChatMessage, SafetyStatus } from '../shared.js';

export interface SafetyGateResponse {
  allowed: boolean;
  safety_status: SafetyStatus;
  reply: string | null;
}

/** The server is authoritative; the client only submits the current Issue's messages. */
export async function requestSafetyGate(baseUrl: string, messages: ChatMessage[], currentIssueId?: string): Promise<SafetyGateResponse> {
  const response = await fetch(`${baseUrl}/api/safety-gate`, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
    body: JSON.stringify({ messages, currentIssueId }),
  });
  const payload = await response.json().catch(() => ({})) as Partial<SafetyGateResponse> & { error?: string };
  if (!response.ok) throw new Error(payload.error || '安全检查暂时不可用，请稍后重试');
  if (typeof payload.allowed !== 'boolean' || !payload.safety_status) throw new Error('安全检查返回格式不正确，请稍后重试');
  return payload as SafetyGateResponse;
}
