import React, { useEffect, useState } from 'react';
import type { GrowthEvent, GrowthPeriod, GrowthSnapshot, GrowthWatchItem } from '../shared.js';
import { clearGrowthIdentity, getGrowthConsent, getGrowthId, setGrowthConsent } from './growth.js';

const apiBaseUrl = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '');
const appBaseUrl = (import.meta.env.BASE_URL || '/').replace(/\/$/, '');
const appPath = (path: string) => `${appBaseUrl}${path.startsWith('/') ? path : `/${path}`}` || '/';

type GrowthPayload = { events: GrowthEvent[]; snapshot: GrowthSnapshot | null; watch: GrowthWatchItem | null; ready?: boolean; reason?: string };

async function api<T>(path: string, init?: RequestInit) {
  const headers = new Headers(init?.headers);
  if (init?.body && !headers.has('Content-Type')) headers.set('Content-Type', 'text/plain;charset=UTF-8');
  const response = await fetch(`${apiBaseUrl}${path}`, { ...init, headers });
  const payload = await response.json().catch(() => ({})) as { error?: string } & T;
  if (!response.ok) throw new Error(payload.error || '请求失败，请稍后重试');
  return payload;
}

export function GrowthPage() {
  const growthId = getGrowthId();
  const [consent, setConsent] = useState(getGrowthConsent());
  const [period, setPeriod] = useState<GrowthPeriod>('30d');
  const [payload, setPayload] = useState<GrowthPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [feedback, setFeedback] = useState<Record<string, string>>({});

  async function loadSnapshot(nextPeriod = period) {
    setError(''); setMessage(''); setLoading(true);
    try {
      const recent = await api<GrowthPayload>(`/api/growth/recent?growthId=${encodeURIComponent(growthId)}&consent=true`);
      const generated = await api<GrowthPayload & { stable?: boolean }>(`/api/growth/generate`, { method: 'POST', body: JSON.stringify({ growthId, consent: true, period: nextPeriod }) });
      setPayload({ ...recent, ...generated, events: generated.events || recent.events });
    } catch (err) { setError(err instanceof Error ? err.message : '最近的我暂时无法打开'); }
    finally { setLoading(false); }
  }

  useEffect(() => { if (consent) void loadSnapshot(); }, [consent]);

  function enableGrowth() {
    setGrowthConsent(true);
    setConsent(true);
  }

  async function submitFeedback(cardKey: GrowthSnapshot['cards'][number]['key'], value: 'ACCURATE' | 'INACCURATE') {
    if (!payload?.snapshot) return;
    try {
      await api(`/api/growth/insights/${encodeURIComponent(payload.snapshot.snapshot_id)}/feedback`, { method: 'POST', body: JSON.stringify({ growthId, consent: true, snapshotId: payload.snapshot.snapshot_id, cardKey, feedback: value }) });
      setFeedback((current) => ({ ...current, [cardKey]: value }));
      setMessage(value === 'ACCURATE' ? '好，我会记住这份回看对你有帮助。' : '收到，我会降低类似理解在之后回看的权重。');
    } catch (err) { setError(err instanceof Error ? err.message : '反馈暂时没有保存'); }
  }

  async function addWatch() {
    const snapshot = payload?.snapshot;
    const card = snapshot?.cards.find((item) => item.key === 'NEXT_FOCUS');
    const description = snapshot?.watch_recommendation || card?.content;
    if (!snapshot || !description) return;
    try {
      const result = await api<{ watch: GrowthWatchItem }>('/api/growth/watch', { method: 'POST', body: JSON.stringify({ growthId, consent: true, snapshotId: snapshot.snapshot_id, title: '这周一起留意', description }) });
      setPayload((current) => current ? { ...current, watch: result.watch } : current);
      setMessage('好，这周我们一起轻轻留意它，不需要每天打卡。');
    } catch (err) { setError(err instanceof Error ? err.message : '观察项暂时没有保存'); }
  }

  async function clearMemory() {
    if (!confirm('确定清空“最近的我”吗？这会删除已保存的成长事件、回看和观察项，聊天记录不受影响。')) return;
    try {
      await api('/api/growth/memory', { method: 'DELETE', body: JSON.stringify({ growthId }) });
      clearGrowthIdentity();
      setGrowthConsent(false); setConsent(false); setPayload(null); setMessage('“最近的我”已经清空，聊天记录没有受到影响。');
    } catch (err) { setError(err instanceof Error ? err.message : '成长记忆暂时无法清空'); }
  }

  return <div className="app-shell growth-shell">
    <main className="growth-page">
      <header className="growth-header"><a className="growth-back" href={appPath('/chat')}>← 回到解忧小屋</a><span className="growth-brand"><span>解<br />忧</span><strong>最近的我</strong></span><a className="growth-home" href={appPath('/')}>首页</a></header>
      <section className="growth-intro"><p className="eyebrow">给自己留一面温和的镜子</p><h1>最近的我，<em>慢慢看见。</em></h1><p>这里不是测评，也不会给你贴标签。它只把你愿意留下的几个片段，整理成一份可以回头看的温柔提醒。</p></section>
      {!consent ? <section className="growth-consent-card"><div><h2>要不要开启长期成长记录？</h2><p>默认关闭。开启后，解忧小屋只会保存经过整理的成长片段，不保存完整聊天记录。你可以随时关闭或一键清空。</p></div><button className="primary-button" type="button" onClick={enableGrowth}>开启“最近的我”</button></section> : <>
        <section className="growth-toolbar"><div><span className="growth-count">已经留下 {payload?.events.length || 0} 个成长片段</span><p>回看只基于你明确说过、并同意留下的内容。</p></div><div className="period-switch" role="group" aria-label="选择回看时间"><button className={period === '30d' ? 'is-active' : ''} onClick={() => { setPeriod('30d'); void loadSnapshot('30d'); }}>最近 30 天</button><button className={period === '90d' ? 'is-active' : ''} onClick={() => { setPeriod('90d'); void loadSnapshot('90d'); }}>最近 3 个月</button></div></section>
        {loading && <section className="growth-loading" aria-live="polite"><span /><span /><span /></section>}
        {!loading && !payload?.snapshot && <section className="growth-empty"><span className="growth-empty-mark">·</span><h2>{payload?.reason || '我们还没聊够久，暂时看不出真正有价值的变化。'}</h2><p>不用为了生成一份回看而刻意聊天。等你愿意再来时，我们继续从最近的一件小事说起。</p><a className="secondary-button" href={appPath('/chat')}>最近想聊点什么</a></section>}
        {!loading && payload?.snapshot && <>
          <section className="growth-card-grid">{payload.snapshot.cards.map((card) => <article className="growth-card" key={card.key}><div className="growth-card-top"><span>{card.title}</span><span className="growth-confidence">{card.confidence === 'HIGH' ? '较清晰' : card.confidence === 'LOW' ? '还在形成' : '可以回看'}</span></div><p>{card.content}</p><div className="growth-feedback"><button className={feedback[card.key] === 'ACCURATE' ? 'is-selected' : ''} onClick={() => void submitFeedback(card.key, 'ACCURATE')}>有点像我</button><button className={feedback[card.key] === 'INACCURATE' ? 'is-selected is-negative' : ''} onClick={() => void submitFeedback(card.key, 'INACCURATE')}>不太像我</button></div></article>)}</section>
          <section className="growth-watch-card">{payload.watch ? <><div><span className="watch-label">本周一起留意</span><h2>{payload.watch.title}</h2><p>{payload.watch.description}</p><small>不需要打卡，聊天里遇到相关时再想起它就好。</small></div><button className="text-button" onClick={() => void api('/api/growth/watch', { method: 'DELETE', body: JSON.stringify({ growthId }) }).then(() => setPayload((current) => current ? { ...current, watch: null } : current))}>结束观察</button></> : <><div><span className="watch-label">给这一周留一个小方向</span><h2>{payload.snapshot.watch_recommendation || '想一起留意点什么吗？'}</h2><p>如果这句话对你有帮助，可以让它在接下来的聊天里偶尔陪着你。</p></div><button className="secondary-button" onClick={() => void addWatch()}>这周帮我观察</button></>}</section>
        </>}
        <section className="growth-footer"><button className="text-button danger-text" onClick={() => void clearMemory()}>清空“最近的我”</button><span>长期成长记录与聊天记录分开保存</span></section>
      </>}
      {message && <div className="growth-toast" role="status">{message}</div>}{error && <div className="inline-error" role="alert">{error}</div>}
    </main>
  </div>;
}

export function GrowthAdminPage() {
  const [token, setToken] = useState('');
  const [growthId, setGrowthId] = useState('');
  const [payload, setPayload] = useState<GrowthPayload | null>(null);
  const [error, setError] = useState('');
  async function load() {
    setError('');
    try { setPayload(await api<GrowthPayload>(`/api/growth/admin?growthId=${encodeURIComponent(growthId)}`, { headers: { 'X-Dev-Token': token } })); }
    catch (err) { setError(err instanceof Error ? err.message : '成长调试数据暂时无法读取'); }
  }
  return <div className="app-shell growth-shell"><main className="growth-page"><header className="growth-header"><a className="growth-back" href={appPath('/dev')}>← 返回调试中心</a><span className="growth-brand"><span>解<br />忧</span><strong>成长记忆调试</strong></span><a className="growth-home" href={appPath('/')}>首页</a></header><section className="growth-intro"><p className="eyebrow">内部调试</p><h1>看见结构，<em>不看原话。</em></h1><p>仅用于核对 Growth Event、快照和观察项是否按规则保存。这里不展示完整聊天记录。</p></section><section className="dev-card growth-admin-card"><label>内部调试口令<input type="password" value={token} onChange={(event) => setToken(event.target.value)} placeholder="DEV_TOKEN" /></label><label>匿名成长标识<input value={growthId} onChange={(event) => setGrowthId(event.target.value)} placeholder="growth-…" /></label><button className="primary-button" type="button" disabled={!token.trim() || !growthId.trim()} onClick={() => void load()}>读取结构化记录</button>{payload && <div className="growth-admin-output"><p>事件：{payload.events.length} 条 · 当前观察项：{payload.watch ? '1 条' : '无'} · 快照：{payload.snapshot ? '已生成' : '无'}</p>{payload.events.map((event) => <article key={event.event_id}><strong>{event.title}</strong><span>{event.topic} · {event.category} · 出现 {event.seen_count} 次</span><p>{event.summary}</p></article>)}</div>}{error && <div className="inline-error" role="alert">{error}</div>}</section></main></div>;
}
