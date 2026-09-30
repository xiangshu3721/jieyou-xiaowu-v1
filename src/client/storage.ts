import type { ConversationAnalysis } from '../shared.js';

export type LocalRole = 'user' | 'assistant';

export interface LocalMessage {
  id: string;
  sessionId: string;
  role: LocalRole;
  content: string;
  createdAt: string;
}

export interface LocalSession {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  profile?: LocalProfile;
  understanding?: ConversationAnalysis;
}

export interface LocalProfile {
  nickname: string;
  contact: string;
}

const DB_NAME = 'jieyou-xiaowu-v1';
const DB_VERSION = 1;
const SINGLE_SESSION_ID = 'jieyou-main-session';

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
  return session || null;
}

export async function getOrCreateSession() {
  const existing = await getSession();
  if (existing) return existing;
  const now = new Date().toISOString();
  const session: LocalSession = { id: SINGLE_SESSION_ID, title: '新的对话', createdAt: now, updatedAt: now };
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
  return messages.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export async function addMessage(sessionId: string, role: LocalRole, content: string) {
  const now = new Date().toISOString();
  const message: LocalMessage = { id: id(), sessionId, role, content, createdAt: now };
  const session = await getSession(sessionId);
  const db = await openDb();
  const transaction = db.transaction(['messages', 'sessions'], 'readwrite');
  transaction.objectStore('messages').put(message);
  if (session) transaction.objectStore('sessions').put({ ...session, title: session.title === '新的对话' && role === 'user' ? content.slice(0, 24) : session.title, updatedAt: now });
  await transactionDone(transaction);
  db.close();
  return message;
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
  transaction.objectStore('sessions').put({ id: SINGLE_SESSION_ID, title: '新的对话', createdAt: now, updatedAt: now, understanding: undefined });
  await transactionDone(transaction);
  db.close();
}
