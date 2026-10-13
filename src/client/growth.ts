const namespace = (import.meta.env.VITE_GROWTH_NAMESPACE || 'prod').replace(/[^a-zA-Z0-9_-]/g, '') || 'prod';
const consentKey = `jieyou-growth-consent:${namespace}`;
const idKey = `jieyou-growth-id:${namespace}`;

function newId() {
  return `${namespace}_${globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2, 10)}`}`;
}

export function getGrowthConsent() {
  try { return localStorage.getItem(consentKey) === 'true'; } catch { return false; }
}

export function setGrowthConsent(value: boolean) {
  try { localStorage.setItem(consentKey, String(value)); } catch { /* private browsing may block localStorage */ }
}

export function getGrowthId() {
  try {
    const existing = localStorage.getItem(idKey);
    if (existing) return existing;
    const created = newId();
    localStorage.setItem(idKey, created);
    return created;
  } catch {
    return newId();
  }
}

export function clearGrowthIdentity() {
  try {
    localStorage.removeItem(consentKey);
    localStorage.removeItem(idKey);
  } catch { /* best effort */ }
}

export async function sendGrowthEvent(input: { baseUrl: string; growthId: string; sessionId: string; issueId?: string; messages: unknown[]; analysis: unknown; keepalive?: boolean }) {
  try {
    await fetch(`${input.baseUrl}/api/growth/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
      body: JSON.stringify({ growthId: input.growthId, consent: true, sessionId: input.sessionId, issueId: input.issueId, messages: input.messages, analysis: input.analysis }),
      keepalive: input.keepalive,
    });
  } catch { /* Growth memory must never interrupt the active conversation. */ }
}
