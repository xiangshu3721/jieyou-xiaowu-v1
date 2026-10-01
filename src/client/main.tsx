import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { ChatResponse } from '../shared.js';
import { addMessage, clearLocalMessages, getOrCreateSession, listMessages, saveSessionProfile, saveSessionUnderstanding, type LocalMessage, type LocalSession } from './storage.js';
import './styles.css';

const apiBaseUrl = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '');
const appBaseUrl = (import.meta.env.BASE_URL || '/').replace(/\/$/, '');

function appPath(path: string) {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${appBaseUrl}${normalizedPath}` || '/';
}

function api<T>(path: string, init?: RequestInit) {
  const headers = new Headers(init?.headers);
  // Keep cross-origin business POSTs as CORS-safelisted requests. The
  // CloudBase HTTP gateway currently rejects OPTIONS preflight with 500;
  // the API parses the body as JSON regardless of this content type.
  if (init?.body && !headers.has('Content-Type')) headers.set('Content-Type', 'text/plain;charset=UTF-8');
  return fetch(`${apiBaseUrl}${path}`, { ...init, headers }).then(async (response) => {
    const payload = await response.json().catch(() => ({})) as { error?: string };
    if (!response.ok) throw new Error(payload.error || '请求失败，请稍后重试');
    return payload as T;
  });
}

function newRequestId() {
  return globalThis.crypto?.randomUUID?.() || `JY-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
}

function Header({ onHome }: { onHome?: () => void }) {
  return <header className="topbar">
    <span className="menu-mark" aria-hidden="true"><i /><i /><i /></span>
    <button className="brand brand-centered" onClick={onHome}>解忧小屋<span>先说说心事</span></button>
    <span className="mini-program-mark" aria-hidden="true"><b>•••</b><i /></span>
  </header>;
}

type SendingPhase = 'listening' | 'replying';

type SpeechRecognitionResultLike = { isFinal: boolean; 0: { transcript: string } };
type SpeechRecognitionEventLike = { results: ArrayLike<SpeechRecognitionResultLike> };
type SpeechRecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onstart: (() => void) | null;
  onend: (() => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  start: () => void;
  stop: () => void;
};
type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

function createSpeechRecognition() {
  if (typeof window === 'undefined') return null;
  const browserWindow = window as Window & { SpeechRecognition?: SpeechRecognitionConstructor; webkitSpeechRecognition?: SpeechRecognitionConstructor };
  const Recognition = browserWindow.SpeechRecognition || browserWindow.webkitSpeechRecognition;
  return Recognition ? new Recognition() : null;
}

function speechUnavailableMessage() {
  if (typeof window !== 'undefined' && !window.isSecureContext && !['localhost', '127.0.0.1'].includes(window.location.hostname)) {
    return '语音输入需要安全连接，请通过 https://littlemo.icu 打开后再点击麦克风。';
  }
  return '当前浏览器暂未开放网页语音识别，请更新 Chrome 或 Safari；也可以点击手机键盘上的麦克风听写。';
}

function LoadingDots() { return <span className="loading-dots" aria-hidden="true"><i /><i /><i /></span>; }

function LoadingStatus({ phase }: { phase: SendingPhase }) {
  return <div className="loading-status" role="status" aria-live="polite">
    <span>{phase === 'listening' ? '正在听…' : '正在回复…'}</span>
    <LoadingDots />
  </div>;
}

function wait(milliseconds: number) {
  return new Promise<void>((resolve) => window.setTimeout(resolve, milliseconds));
}

const quickPrompts = ['最近总是焦虑怎么办', '工作压力很大怎么办', '我想找真人聊聊'];

function wantsHumanBooking(text: string) {
  if (/(不想|不用|不需要|先不|拒绝).{0,8}(真人|预约|导师|老师|咨询师|人工)/.test(text)) return false;
  return /(?:想|希望|需要|我要|帮我|可以).{0,8}(?:找真人|真人聊|真人导师|预约真人|找个人聊|找老师|找咨询师|心理咨询师|专业的人|一对一|1\s*v\s*1)/i.test(text)
    || /(?:预约|找|有没有|能不能).{0,8}(?:真人|导师|老师|咨询师|专业的人|一对一|1\s*v\s*1)/i.test(text)
    || /(?:有|有没有).{0,8}咨询服务/.test(text)
    || /(?:有|有没有|能不能|可以).{0,8}(?:老师|导师).{0,8}(?:聊|咨询|沟通|安排)/.test(text)
    || /(?:不想|不愿意).{0,4}(?:和|跟)\s*AI聊/i.test(text)
    || /(?:AI|人工智能).{0,8}(?:没用|不行|聊不下去|不想聊)/i.test(text);
}

function hasHumanServiceCta(text: string) {
  if (/(不(?:建议|适合|需要|推荐)|不要).{0,8}(真人|预约|导师)/.test(text)) return false;
  return /将会有专门的导师好好倾听|真人服务|真人导师聊聊|预约真人|预约入口|找真人聊|免费预约真人聊聊/.test(text);
}

function ChatPage() {
  const [session, setSession] = useState<LocalSession | null>(null);
  const [messages, setMessages] = useState<LocalMessage[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [sendingPhase, setSendingPhase] = useState<SendingPhase>('listening');
  const [error, setError] = useState('');
  const [scrolled, setScrolled] = useState(false);
  const [recording, setRecording] = useState(false);
  const chatScrollRef = useRef<HTMLDivElement>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);

  useEffect(() => {
    history.replaceState(null, '', appPath('/'));
    (async () => {
      const mainSession = await getOrCreateSession();
      setSession(mainSession);
      setMessages(await listMessages(mainSession.id));
    })().catch(() => setError('本地记录暂时无法打开，请检查浏览器存储权限。'));
  }, []);

  useEffect(() => {
    const element = chatScrollRef.current;
    if (!element) return;
    const frame = window.requestAnimationFrame(() => element.scrollTo({ top: element.scrollHeight, behavior: 'auto' }));
    return () => window.cancelAnimationFrame(frame);
  }, [messages.length, sending]);

  useEffect(() => () => {
    recognitionRef.current?.stop();
  }, []);

  function toggleVoiceInput() {
    if (sending) return;
    if (recording) {
      recognitionRef.current?.stop();
      return;
    }
    const recognition = createSpeechRecognition();
    if (!recognition) {
      setError(speechUnavailableMessage());
      return;
    }
    const baseText = input.trim();
    const separator = baseText && !/[，。！？；：,.!?;:\s]$/.test(baseText) ? ' ' : '';
    recognition.lang = 'zh-CN';
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.onstart = () => { setError(''); setRecording(true); };
    recognition.onresult = (event) => {
      let finalText = '';
      let interimText = '';
      for (let index = 0; index < event.results.length; index += 1) {
        const result = event.results[index];
        if (!result) continue;
        if (result.isFinal) finalText += result[0].transcript;
        else interimText += result[0].transcript;
      }
      const transcript = `${finalText}${interimText}`;
      if (transcript) setInput(`${baseText}${separator}${transcript}`);
    };
    recognition.onerror = (event) => {
      if (event.error !== 'aborted') setError(event.error === 'not-allowed' || event.error === 'service-not-allowed' ? (window.isSecureContext ? '麦克风或语音识别权限未开启，请在浏览器设置中允许本网站使用麦克风。' : speechUnavailableMessage()) : '语音识别暂时不可用，请重试或直接使用手机键盘听写。');
      setRecording(false);
      recognitionRef.current = null;
    };
    recognition.onend = () => {
      setRecording(false);
      recognitionRef.current = null;
    };
    recognitionRef.current = recognition;
    try {
      recognition.start();
    } catch {
      setRecording(false);
      recognitionRef.current = null;
      setError(speechUnavailableMessage());
    }
  }

  async function send() {
    const content = input.trim();
    if (!content || !session || sending) return;
    recognitionRef.current?.stop();
    recognitionRef.current = null;
    setRecording(false);
    if (wantsHumanBooking(content)) {
      setInput('');
      const userMessage = await addMessage(session.id, 'user', content);
      setMessages((current) => [...current, userMessage]);
      location.href = appPath('/booking');
      return;
    }
    if (/清除|删除|清空.*(?:聊天|记录)|聊天记录.*清除/.test(content)) {
      await clearLocalMessages();
      setInput('');
      setMessages([]);
      setError('这次聊天记录和对应的本地导诊状态已清除。');
      return;
    }
    setInput(''); setError(''); setSending(true); setSendingPhase('listening');
    const userMessage = await addMessage(session.id, 'user', content);
    setMessages((current) => [...current, userMessage]);
    try {
      const listeningDuration = Math.min(1_300, 700 + content.length * 24);
      await wait(listeningDuration);
      setSendingPhase('replying');
      const replyingStartedAt = performance.now();
      const result = await api<ChatResponse>('/api/chat', { method: 'POST', body: JSON.stringify({ sessionId: session.id, messages: [...messages, userMessage].map(({ role, content: text }) => ({ role, content: text })) }) });
      const remainingReplyingTime = 900 - (performance.now() - replyingStartedAt);
      if (remainingReplyingTime > 0) await wait(remainingReplyingTime);
      await saveSessionUnderstanding(session.id, result.analysis);
      setSession((current) => current ? { ...current, understanding: result.analysis } : current);
      const assistant = await addMessage(session.id, 'assistant', result.reply);
      setMessages((current) => [...current, assistant]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'AI 暂时没有回应，请稍后重试');
    } finally { setSending(false); setSendingPhase('listening'); }
  }

  async function clearCurrentConversation() {
    if (!confirm('确定清空这一次对话吗？清空后无法恢复。')) return;
    await clearLocalMessages();
    setMessages([]);
    setError('');
  }

  function useQuickPrompt(prompt: string) { setInput(prompt); }

  return <div className="app-shell">
    <main className={`chat-page ${scrolled ? 'is-scrolled' : ''}`}>
      <div ref={chatScrollRef} className={`chat-scroll ${messages.length ? 'has-messages' : ''}`} onScroll={(event) => setScrolled(event.currentTarget.scrollTop > 48)}>
        <div className="compact-header" aria-hidden={!scrolled}><div className="compact-avatar">解<br />忧</div><strong>解忧小屋</strong></div>
        <section className="welcome-card">
          <div className="avatar-badge"><div className="avatar-core">解<br />忧</div><span>·</span></div>
          <h1>Hi，我是解忧小屋</h1>
          <div className="welcome-tags"><span>AI 倾听</span><span>温和陪伴</span></div>
          <p>情绪、情感、工作、家庭等困扰，都可以问我，我会陪着你一起</p>
        </section>
        {messages.length > 0 && <section className="message-stream" aria-live="polite">
          {messages.map((message) => <div key={message.id} className={`message-row ${message.role}`}><div className="message-bubble">{message.content}{message.role === 'assistant' && hasHumanServiceCta(message.content) && <button className="message-cta" type="button" onClick={() => { location.href = appPath('/booking'); }}>免费预约真人聊聊</button>}</div></div>)}
          {sending && <div className="message-row assistant"><div className="message-bubble loading-bubble"><LoadingStatus phase={sendingPhase} /></div></div>}
        </section>}
        {error && <div className="inline-error" role="alert">{error}</div>}
      </div>
      <div className="chat-dock">
        <div className="chat-options">
          <div className="quick-prompts-heading"><p>大家都在问 <span>→</span></p><button className="human-entry" onClick={() => { location.href = appPath('/booking'); }}>免费预约真人聊聊</button></div>
          <div className="quick-prompt-list">{quickPrompts.map((prompt) => <button key={prompt} onClick={() => useQuickPrompt(prompt)}>{prompt}</button>)}</div>
        </div>
        <section className="composer-card">
          <textarea id="chat-input" value={input} onChange={(event) => setInput(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void send(); } }} placeholder="自由表达你的困惑，别有压力" rows={3} />
          <div className="composer-bottom"><span className="composer-plus" aria-hidden="true">+</span><div className="composer-actions"><button type="button" className={`voice-button ${recording ? 'is-recording' : ''}`} disabled={sending} onClick={toggleVoiceInput} aria-label={recording ? '停止语音输入' : '开始语音输入'} title={recording ? '停止语音输入' : '语音转文字'}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 14a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v5a3 3 0 0 0 3 3Zm5-3a5 5 0 0 1-10 0M12 19v3M8 22h8" /></svg></button><button type="button" className="send-circle" disabled={!input.trim() || sending} onClick={() => void send()} aria-label="发送">↑</button></div></div>
        </section>
        <div className="chat-footer"><button onClick={() => void clearCurrentConversation()}>清空本次对话</button><span>对话仅保存在当前浏览器</span></div>
      </div>
    </main>
  </div>;
}

function BookingPage() {
  const [session, setSession] = useState<LocalSession | null>(null);
  const [messages, setMessages] = useState<LocalMessage[]>([]);
  const [summary, setSummary] = useState('');
  const [nickname, setNickname] = useState('');
  const [contact, setContact] = useState('');
  const [desiredHelp, setDesiredHelp] = useState('');
  const [consent, setConsent] = useState(false);
  const [loadingSummary, setLoadingSummary] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [requestId] = useState(newRequestId);
  const summaryRequestedRef = useRef(false);

  useEffect(() => {
    void getOrCreateSession().then(async (mainSession) => {
      setSession(mainSession);
      setNickname(mainSession.profile?.nickname || '');
      setContact(mainSession.profile?.contact || '');
      const storedMessages = await listMessages(mainSession.id);
      setMessages(storedMessages);
      if (storedMessages.length && !summaryRequestedRef.current) {
        summaryRequestedRef.current = true;
        setLoadingSummary(true);
        try {
          const result = await api<{ summary: string }>('/api/booking-summary', { method: 'POST', body: JSON.stringify({ sessionId: mainSession.id, messages: storedMessages.map(({ role, content }) => ({ role, content })) }) });
          setSummary(result.summary);
        } catch (err) {
          setError(err instanceof Error ? `${err.message} 你仍然可以直接手动填写。` : '摘要生成失败，你仍然可以直接手动填写。');
        } finally {
          setLoadingSummary(false);
        }
      }
    }).catch(() => setError('本地对话暂时无法打开。'));
  }, []);
  function rememberProfile() {
    if (session) void saveSessionProfile(session.id, { nickname: nickname.trim(), contact: contact.trim() });
  }
  async function generateSummary() {
    if (!messages.length) return setError('当前对话还没有可整理的内容。');
    setError(''); setLoadingSummary(true);
    try { const result = await api<{ summary: string }>('/api/booking-summary', { method: 'POST', body: JSON.stringify({ sessionId: session?.id, messages: messages.map(({ role, content }) => ({ role, content })) }) }); setSummary(result.summary); }
    catch (err) { setError(err instanceof Error ? `${err.message} 你仍然可以直接手动填写。` : '摘要生成失败，你仍然可以直接手动填写。'); }
    finally { setLoadingSummary(false); }
  }
  async function submit() {
    if (!nickname.trim() || !contact.trim() || !summary.trim() || !desiredHelp.trim() || !consent || submitting) return;
    setError(''); setSubmitting(true);
    try { if (session) await saveSessionProfile(session.id, { nickname: nickname.trim(), contact: contact.trim() }); await api('/api/appointments', { method: 'POST', body: JSON.stringify({ requestId, nickname, contact, concern: summary, desiredHelp, consent }) }); location.href = appPath(`/booking/result?requestId=${encodeURIComponent(requestId)}`); }
    catch (err) { setError(err instanceof Error ? err.message : '预约提交失败，请稍后重试。'); setSubmitting(false); }
  }
  function goBack() { location.href = appPath('/'); }

  return <div className="app-shell"><main className="form-page"><div className="page-heading booking-heading"><div className="form-page-top"><button className="back-button" type="button" onClick={goBack}>返回上一页</button></div><p className="eyebrow">免费真人预约</p><h1>把想获得的帮助<br /><em>说得更清楚一点。</em></h1><p>我们会把你确认后的信息交给运营人员，由人工在飞书中分配合适的导师并联系你。</p></div><section className="form-card"><div className="summary-block"><div className="field-head"><label htmlFor="concern">当前困扰描述</label><button className="text-button" onClick={() => void generateSummary()} disabled={loadingSummary}>{loadingSummary ? '整理中…' : '重新生成摘要'}</button></div><textarea id="concern" value={summary} onChange={(event) => setSummary(event.target.value)} placeholder="请写下最近困扰你的事情、感受，以及你最想先解决的部分。" rows={7} /><p className="helper">AI 会根据你明确说过的内容自动整理，你可以直接修改、删除或重新填写。</p></div><Field label="昵称" value={nickname} onChange={setNickname} onBlur={rememberProfile} placeholder="怎么称呼你" /><Field label="微信 / 联系方式" value={contact} onChange={setContact} onBlur={rememberProfile} placeholder="方便联系你的方式" /><div className="field"><label htmlFor="desiredHelp">希望获得什么帮助</label><textarea id="desiredHelp" value={desiredHelp} onChange={(event) => setDesiredHelp(event.target.value)} placeholder="例如：希望有人帮我一起理清下一步" rows={4} /></div><label className="consent"><input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} /><span>我确认以上信息可以用于本次预约联系和人工分配，不提交完整聊天记录。</span></label>{error && <div className="inline-error" role="alert">{error}</div>}<button className="primary-button large full" disabled={!nickname.trim() || !contact.trim() || !summary.trim() || !desiredHelp.trim() || !consent || submitting} onClick={() => void submit()}>{submitting ? '正在提交…' : '确认提交预约'}</button><p className="form-footnote">提交后只显示真实写入结果；如果网络中断，可以用同一次请求继续重试。</p></section></main></div>;
}

function Field({ label, value, onChange, onBlur, placeholder }: { label: string; value: string; onChange: (value: string) => void; onBlur?: () => void; placeholder: string }) { return <div className="field"><label>{label}</label><input value={value} onChange={(event) => onChange(event.target.value)} onBlur={onBlur} placeholder={placeholder} /></div>; }

function ResultPage() {
  const requestId = new URLSearchParams(location.search).get('requestId') || '';
  const [status, setStatus] = useState<{ status: string; recordId?: string; assignedMentor?: string; result?: string; updatedAt?: string } | null>(null);
  const [error, setError] = useState('');
  useEffect(() => { if (!requestId) return; void api<typeof status>(`/api/appointments/${encodeURIComponent(requestId)}/status`).then(setStatus).catch((err) => setError(err instanceof Error ? err.message : '暂时无法查询状态')); }, [requestId]);
  const submitted = status?.status === 'submitted' || status?.status === '待分配' || status?.status === 'assigned' || status?.status === 'contacted' || status?.status === 'received';
  return <div className="app-shell"><main className="result-page"><div className={`result-icon ${submitted ? 'ok' : 'pending'}`}>{submitted ? '✓' : '…'}</div><p className="eyebrow">预约状态</p><h1>{submitted ? '预约信息已真实提交。' : '正在确认提交状态。'}</h1><p className="result-copy">{submitted ? '后续由运营人员在飞书中人工分配导师并联系你。这里不会自动匹配，也不会要求你重复描述。' : '系统正在确认飞书写入结果，请保留下面的预约编号。'}</p>{requestId && <div className="request-number"><span>预约编号</span><strong>{requestId}</strong></div>}{status?.assignedMentor && <p className="status-detail">已分配导师：{status.assignedMentor}</p>}{status?.result && <p className="status-detail">接待信息：{status.result}</p>}{error && <div className="inline-error" role="alert">{error}</div>}<div className="result-actions"><button className="primary-button" onClick={() => { location.href = appPath('/'); }}>回到解忧小屋</button></div></main></div>;
}

function DevPage() {
  const [token, setToken] = useState(''); const [rules, setRules] = useState<{ promptMetadata?: { version: string; files: string[] }; promptTexts?: Record<string, string>; deepseekConfigured?: boolean; feishuConfigured?: boolean } | null>(null); const [caseText, setCaseText] = useState('最近工作压力很大，也不知道要不要继续这份工作。'); const [testResult, setTestResult] = useState<ChatResponse | null>(null); const [error, setError] = useState('');
  async function loadRules() { setError(''); try { setRules(await api('/api/dev/rules', { headers: { 'X-Dev-Token': token } })); } catch (err) { setError(err instanceof Error ? err.message : '调试接口不可用'); } }
  async function runCase() { setError(''); try { setTestResult(await api<ChatResponse>('/api/chat', { method: 'POST', body: JSON.stringify({ sessionId: 'dev-case', messages: [{ role: 'user', content: caseText }] }) })); } catch (err) { setError(err instanceof Error ? err.message : '真实模型测试失败'); } }
  const analysis = testResult?.analysis;
  return <div className="app-shell"><Header onHome={() => { location.href = appPath('/'); }} /><main className="dev-page"><div className="page-heading"><p className="eyebrow">内部调试</p><h1>规则、真实模型与<br /><em>外部配置状态。</em></h1><p>此页面只提供服务端口令保护的调试数据，不对普通用户开放业务结果。</p></div><section className="dev-card"><label>内部调试口令<input type="password" value={token} onChange={(event) => setToken(event.target.value)} placeholder="DEV_TOKEN" /></label><button className="primary-button" onClick={() => void loadRules()}>读取调试配置</button>{rules && <div className="dev-grid"><div><span>Prompt 版本</span><strong>{rules.promptMetadata?.version}</strong></div><div><span>DeepSeek</span><strong>{rules.deepseekConfigured ? '已配置' : '未配置'}</strong></div><div><span>飞书</span><strong>{rules.feishuConfigured ? '已配置' : '未配置'}</strong></div></div>}</section><section className="dev-card"><div className="field"><label htmlFor="case">真实模型固定案例</label><textarea id="case" value={caseText} onChange={(event) => setCaseText(event.target.value)} rows={4} /></div><button className="secondary-button" onClick={() => void runCase()}>调用真实 DeepSeek 测试</button>{testResult && analysis && <div className="test-result"><p>{testResult.reply}</p><small>标签：{analysis.tags.join('、')} · 导诊：{analysis.route} · 模型：{testResult.model}</small><div className="triage-debug"><h3>V1.2 导诊内部结果</h3><div className="triage-debug-grid"><div><span>主诉</span><strong>{analysis.problem_map.main_issue || '未知'}</strong></div><div><span>问题类型</span><strong>{analysis.problem_map.issue_types.join('、')}</strong></div><div><span>复杂度</span><strong>{analysis.complexity}</strong></div><div><span>诊断充分度</span><strong>{analysis.diagnostic_sufficiency}</strong></div><div><span>服务路径</span><strong>{analysis.routing}</strong></div><div><span>深度层级</span><strong>{analysis.depth_level}</strong></div></div><p><b>场景摘要：</b>{analysis.problem_map.scene_summary || '未知'}</p><p><b>信息缺口：</b>{analysis.information_gaps.length ? analysis.information_gaps.join('、') : '暂无'}</p><p><b>测评：</b>{analysis.assessment.needed ? `${analysis.assessment.recommended_tool || '辅助测评'}（${analysis.assessment.reason || '用于降低不确定性'}）` : '当前不需要'}</p><p><b>分流依据：</b>{analysis.routing_reason}</p><p><b>下一问：</b>{analysis.next_question || '暂不追问'}</p></div></div>}</section>{error && <div className="inline-error" role="alert">{error}</div>}</main></div>;
}

function App() { const path = location.pathname; if (path === '/booking') return <BookingPage />; if (path === '/booking/result') return <ResultPage />; if (path === '/dev') return <DevPage />; return <ChatPage />; }

createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>);
