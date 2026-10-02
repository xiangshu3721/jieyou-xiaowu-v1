import type { BookingCaseSnapshot, ConversationAnalysis, IssueLifecycle, TopicCode } from '../shared.js';

export type LocalRole = 'user' | 'assistant';

export interface LocalMessage {
  id: string;
  sessionId: string;
  role: LocalRole;
  content: string;
  createdAt: string;
  issueId: string;
  bookingCta?: boolean;
}

export interface LocalSession {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  profile?: LocalProfile;
  understanding?: ConversationAnalysis;
  currentIssueId: string;
  issues: Record<string, IssueLifecycle>;
  bookingCases: Record<string, BookingCaseSnapshot>;
}

export interface LocalProfile {
  nickname: string;
  contact: string;
}

const DB_NAME = 'jieyou-xiaowu-v1';
const DB_VERSION = 2;
const SINGLE_SESSION_ID = 'jieyou-main-session';

function newIssueId() {
  return globalThis.crypto?.randomUUID?.() || `issue-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
}

function newIssue(startedAt = new Date().toISOString(), issueId: string = newIssueId()): IssueLifecycle {
  return {
    issue_id: issueId,
    status: 'ACTIVE',
    started_at: startedAt,
    main_issue: null,
    topic_tags: [],
    user_turn_count: 0,
    problem_clarity: 0,
    minimum_sufficient_judgment: false,
    handoff_ready: false,
    handoff_offered: false,
    handoff_state: 'NOT_READY',
    booking_case_id: null,
    booking_submitted_at: null,
  };
}

function normalizeSession(session: LocalSession): LocalSession {
  const issueId = session.currentIssueId || Object.keys(session.issues || {})[0] || newIssue(new Date(session.createdAt).toISOString()).issue_id;
  const existingIssues = session.issues || {};
  const issue = existingIssues[issueId] || newIssue(session.createdAt, issueId);
  const normalizedIssues = Object.fromEntries(Object.entries({ ...existingIssues, [issueId]: issue }).map(([id, item]) => [id, {
    ...item,
    handoff_state: item.handoff_state || (item.handoff_offered ? 'OFFERED' : 'NOT_READY'),
  }])) as Record<string, IssueLifecycle>;
  return { ...session, currentIssueId: issueId, issues: normalizedIssues, bookingCases: session.bookingCases || {} };
}

function id() {
  return globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function request<T>(value: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    value.onsuccess = () => resolve(value.result);
    value.onerror = () => reject(value.error || new Error('本地记录读取失败'));
  });
}

function transactionDone(transaction: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error || new Error('本地记录写入失败'));
    transaction.onabort = () => reject(transaction.error || new Error('本地记录写入已取消'));
  });
}

function openDb() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const opening = indexedDB.open(DB_NAME, DB_VERSION);
    opening.onupgradeneeded = () => {
      const db = opening.result;
      if (!db.objectStoreNames.contains('sessions')) db.createObjectStore('sessions', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('messages')) {
        const store = db.createObjectStore('messages', { keyPath: 'id' });
        store.createIndex('sessionId', 'sessionId', { unique: false });
      }
    };
    opening.onsuccess = () => resolve(opening.result);
    opening.onerror = () => reject(opening.error || new Error('浏览器不支持本地记录'));
  });
}

export async function getSession(sessionId = SINGLE_SESSION_ID) {
  const db = await openDb();
  const session = await request(db.transaction('sessions', 'readonly').objectStore('sessions').get(sessionId)) as LocalSession | undefined;
  db.close();
  return session ? normalizeSession(session) : null;
}

export async function getOrCreateSession() {
  const existing = await getSession();
  if (existing) return existing;
  const now = new Date().toISOString();
  const issue = newIssue(now);
  const session: LocalSession = { id: SINGLE_SESSION_ID, title: '新的对话', createdAt: now, updatedAt: now, currentIssueId: issue.issue_id, issues: { [issue.issue_id]: issue }, bookingCases: {} };
  const db = await openDb();
  const transaction = db.transaction('sessions', 'readwrite');
  transaction.objectStore('sessions').put(session);
  await transactionDone(transaction);
  db.close();
  return session;
}

export async function listMessages(sessionId = SINGLE_SESSION_ID) {
  const db = await openDb();
  const messages = await request(db.transaction('messages', 'readonly').objectStore('messages').index('sessionId').getAll(sessionId)) as LocalMessage[];
  db.close();
  const session = await getSession(sessionId);
  const currentIssueId = session?.currentIssueId || 'issue-legacy';
  const normalized = messages.map((message) => ({ ...message, issueId: message.issueId || currentIssueId }));
  const legacyMessages = normalized.filter((message, index) => !messages[index]?.issueId);
  if (legacyMessages.length) {
    const migrationDb = await openDb();
    const migration = migrationDb.transaction('messages', 'readwrite');
    for (const message of legacyMessages) migration.objectStore('messages').put(message);
    await transactionDone(migration);
    migrationDb.close();
  }
  return normalized.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export async function addMessage(sessionId: string, role: LocalRole, content: string, issueId?: string, options: { bookingCta?: boolean } = {}) {
  const now = new Date().toISOString();
  const session = await getSession(sessionId);
  const message: LocalMessage = { id: id(), sessionId, role, content, createdAt: now, issueId: issueId || session?.currentIssueId || 'issue-legacy', ...(options.bookingCta === undefined ? {} : { bookingCta: options.bookingCta }) };
  const db = await openDb();
  const transaction = db.transaction(['messages', 'sessions'], 'readwrite');
  transaction.objectStore('messages').put(message);
  if (session) transaction.objectStore('sessions').put({ ...session, title: session.title === '新的对话' && role === 'user' ? content.slice(0, 24) : session.title, updatedAt: now });
  await transactionDone(transaction);
  db.close();
  return message;
}

export async function moveMessageToIssue(sessionId: string, messageId: string, issueId: string) {
  const db = await openDb();
  const transaction = db.transaction('messages', 'readwrite');
  const store = transaction.objectStore('messages');
  const message = await request(store.get(messageId)) as LocalMessage | undefined;
  if (message && message.sessionId === sessionId) store.put({ ...message, issueId });
  await transactionDone(transaction);
  db.close();
}

export async function saveSessionLifecycle(sessionId: string, lifecycle: { currentIssueId: string; issues: Record<string, IssueLifecycle> }) {
  const session = await getSession(sessionId);
  if (!session) return;
  const db = await openDb();
  const transaction = db.transaction('sessions', 'readwrite');
  transaction.objectStore('sessions').put({ ...session, ...lifecycle, updatedAt: new Date().toISOString() });
  await transactionDone(transaction);
  db.close();
}

export function issueFromAnalysis(analysis: ConversationAnalysis, startedAt = new Date().toISOString()): IssueLifecycle {
  return {
    issue_id: analysis.current_issue_id,
    status: analysis.issue_status,
    started_at: startedAt,
    main_issue: analysis.problem_map.main_issue,
    topic_tags: analysis.tags as TopicCode[],
    user_turn_count: analysis.user_turn_count,
    problem_clarity: analysis.problem_clarity,
    minimum_sufficient_judgment: analysis.minimum_sufficient_judgment,
    handoff_ready: analysis.handoff_ready,
    handoff_offered: analysis.handoff_offered,
    handoff_state: analysis.handoff_state,
    booking_case_id: null,
    booking_submitted_at: null,
  };
}

export async function markIssueBookingSubmitted(sessionId: string, issueId: string, snapshot: BookingCaseSnapshot) {
  const session = await getSession(sessionId);
  if (!session) return;
  const existing = session.issues[issueId] || newIssue(snapshot.submitted_at, issueId);
  const issue: IssueLifecycle = { ...existing, status: 'BOOKING_SUBMITTED', booking_case_id: snapshot.booking_case_id, booking_submitted_at: snapshot.submitted_at, handoff_offered: true, handoff_state: 'ACCEPTED' };
  await saveSessionLifecycle(sessionId, { currentIssueId: issueId, issues: { ...session.issues, [issueId]: issue } });
  const updated = await getSession(sessionId);
  if (!updated) return;
  const db = await openDb();
  const transaction = db.transaction('sessions', 'readwrite');
  transaction.objectStore('sessions').put({ ...updated, bookingCases: { ...updated.bookingCases, [snapshot.booking_case_id]: snapshot }, updatedAt: new Date().toISOString() });
  await transactionDone(transaction);
  db.close();
}

export async function createFreshIssue(sessionId: string, startedAt = new Date().toISOString()) {
  const session = await getSession(sessionId);
  if (!session) return null;
  const issue = newIssue(startedAt);
  await saveSessionLifecycle(sessionId, { currentIssueId: issue.issue_id, issues: { ...session.issues, [issue.issue_id]: issue } });
  return issue;
}

export async function saveSessionUnderstanding(sessionId: string, understanding: ConversationAnalysis) {
  const session = await getSession(sessionId);
  if (!session) return;
  const db = await openDb();
  const transaction = db.transaction('sessions', 'readwrite');
  transaction.objectStore('sessions').put({ ...session, understanding, updatedAt: new Date().toISOString() });
  await transactionDone(transaction);
  db.close();
}

export async function saveSessionProfile(sessionId: string, profile: LocalProfile) {
  const session = await getSession(sessionId);
  if (!session) return;
  const db = await openDb();
  const transaction = db.transaction('sessions', 'readwrite');
  transaction.objectStore('sessions').put({ ...session, profile, updatedAt: new Date().toISOString() });
  await transactionDone(transaction);
  db.close();
}

export async function clearLocalMessages() {
  const now = new Date().toISOString();
  const db = await openDb();
  const transaction = db.transaction(['messages', 'sessions'], 'readwrite');
  transaction.objectStore('messages').clear();
  const issue = newIssue(now);
  transaction.objectStore('sessions').put({ id: SINGLE_SESSION_ID, title: '新的对话', createdAt: now, updatedAt: now, understanding: undefined, currentIssueId: issue.issue_id, issues: { [issue.issue_id]: issue }, bookingCases: {} });
  await transactionDone(transaction);
  db.close();
}
