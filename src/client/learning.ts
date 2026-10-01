import type { ConversationAnalysis } from '../shared.js';
import type { LocalMessage } from './storage.js';

export interface ClientLearningMetrics {
  turn_count: number;
  question_count: number;
  consecutive_question_max: number;
  problem_clarity_reached: boolean;
  assessment_recommended: boolean;
  assessment_completed: boolean;
  handoff: boolean;
  handoff_turn: number | null;
  booking_button_shown: boolean;
  booking_clicked: boolean;
  user_abandoned: boolean;
  user_correction_count: number;
  summary_modified_ratio: number | null;
  average_response_length: number;
  response_length_variance: number;
  repeated_question_rate: number;
  clarification_efficiency: number | null;
}

const learningIdKey = 'jieyou-learning-session-id';
const learningConsentKey = 'jieyou-learning-consent';

function randomId() {
  return globalThis.crypto?.randomUUID?.() || `learning-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function getLearningSessionId() {
  try {
    const existing = localStorage.getItem(learningIdKey);
    if (existing) return existing;
    const created = randomId();
    localStorage.setItem(learningIdKey, created);
    return created;
  } catch {
    return randomId();
  }
}

export function getLearningConsent() {
  try { return localStorage.getItem(learningConsentKey) === 'true'; } catch { return false; }
}

export function setLearningConsent(value: boolean) {
  try {
    if (value) localStorage.setItem(learningConsentKey, 'true');
    else localStorage.removeItem(learningConsentKey);
  } catch {
    // Private browsing may reject localStorage. Consent still applies to this render.
  }
}

export function rotateLearningSession() {
  try {
    localStorage.removeItem(learningIdKey);
    localStorage.removeItem(learningConsentKey);
  } catch {
    // Nothing else is required when localStorage is unavailable.
  }
}

export function emptyLearningMetrics(): ClientLearningMetrics {
  return {
    turn_count: 0,
    question_count: 0,
    consecutive_question_max: 0,
    problem_clarity_reached: false,
    assessment_recommended: false,
    assessment_completed: false,
    handoff: false,
    handoff_turn: null,
    booking_button_shown: false,
    booking_clicked: false,
    user_abandoned: false,
    user_correction_count: 0,
    summary_modified_ratio: null,
    average_response_length: 0,
    response_length_variance: 0,
    repeated_question_rate: 0,
    clarification_efficiency: null,
  };
}

function isQuestion(text: string) {
  return /[?？]/.test(text);
}

function isCorrection(text: string) {
  return /(?:不是|不对|你理解错|不是这个意思|我不是说|不准确)/.test(text);
}

function normalizeQuestion(text: string) {
  return text.replace(/\s+/g, '').replace(/[，。！？；：,.!?;:]/g, '').slice(0, 160);
}

export class LearningMetricsTracker {
  private metrics = emptyLearningMetrics();
  private responseLengths: number[] = [];
  private questions: string[] = [];
  private currentQuestionRun = 0;

  resetFromMessages(messages: LocalMessage[]) {
    this.metrics = emptyLearningMetrics();
    this.responseLengths = [];
    this.questions = [];
    this.currentQuestionRun = 0;
    for (const message of messages) {
      if (message.role === 'user') this.recordUser(message.content);
      else this.recordAssistant(message.content);
    }
  }

  recordUser(text: string) {
    this.metrics.turn_count += 1;
    this.metrics.user_correction_count += isCorrection(text) ? 1 : 0;
  }

  recordAssistant(text: string) {
    if (isQuestion(text)) {
      this.metrics.question_count += 1;
      this.questions.push(normalizeQuestion(text));
      this.currentQuestionRun += 1;
      this.metrics.consecutive_question_max = Math.max(this.metrics.consecutive_question_max, this.currentQuestionRun);
    } else {
      this.currentQuestionRun = 0;
    }
    this.responseLengths.push(text.length);
    const average = this.responseLengths.reduce((sum, length) => sum + length, 0) / this.responseLengths.length;
    this.metrics.average_response_length = Math.round(average);
    this.metrics.response_length_variance = Math.round(this.responseLengths.reduce((sum, length) => sum + ((length - average) ** 2), 0) / this.responseLengths.length);
    const repeats = this.questions.length - new Set(this.questions).size;
    this.metrics.repeated_question_rate = this.questions.length ? Number((repeats / this.questions.length).toFixed(2)) : 0;
  }

  recordAnalysis(analysis: ConversationAnalysis) {
    this.metrics.problem_clarity_reached ||= analysis.problem_clarity >= 0.6 || analysis.minimum_sufficient_judgment;
    this.metrics.assessment_recommended ||= analysis.assessment.needed;
    if (this.metrics.problem_clarity_reached) this.metrics.clarification_efficiency = this.metrics.question_count ? Number((1 / this.metrics.question_count).toFixed(2)) : 1;
    this.metrics.handoff ||= analysis.handoff_state === 'OFFERED' || analysis.handoff_state === 'ACCEPTED' || analysis.show_booking_button;
    this.metrics.booking_button_shown ||= analysis.show_booking_button;
    if (this.metrics.handoff && this.metrics.handoff_turn === null) this.metrics.handoff_turn = this.metrics.turn_count;
  }

  markBookingClicked() {
    this.metrics.booking_clicked = true;
    this.metrics.handoff = true;
    if (this.metrics.handoff_turn === null) this.metrics.handoff_turn = this.metrics.turn_count;
  }

  markSummaryEdited(ratio: number | null) {
    this.metrics.summary_modified_ratio = ratio === null ? null : Math.max(0, Math.min(1, ratio));
  }

  markAbandoned() {
    this.metrics.user_abandoned = true;
  }

  snapshot() {
    return { ...this.metrics };
  }
}

export function learningEventId() { return `learn-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`; }

export function learningMessages(messages: LocalMessage[]) {
  return messages.slice(-20).map(({ role, content }) => ({ role, content: content.slice(0, 1_000) }));
}

export async function sendLearningEvent(input: {
  baseUrl?: string;
  eventType: string;
  sessionId: string;
  metrics: ClientLearningMetrics;
  metadata?: Record<string, string | number | boolean | null>;
  keepalive?: boolean;
}) {
  try {
    await fetch(`${input.baseUrl || ''}/api/learning/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
      body: JSON.stringify({ eventId: learningEventId(), eventType: input.eventType, sessionId: input.sessionId, metrics: input.metrics, metadata: input.metadata || {} }),
      keepalive: input.keepalive,
    });
  } catch {
    // Learning telemetry must never interrupt the chat or show an error to users.
  }
}

export async function sendLearningReview(input: { baseUrl?: string; sessionId: string; messages: LocalMessage[]; keepalive?: boolean }) {
  try {
    await fetch(`${input.baseUrl || ''}/api/learning/review`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
      body: JSON.stringify({ consent: true, sessionId: input.sessionId, messages: learningMessages(input.messages) }),
      keepalive: input.keepalive,
    });
  } catch {
    // The review is best effort; structured metrics remain the primary signal.
  }
}

export async function deleteLearningSession(sessionId: string, baseUrl = '') {
  try {
    await fetch(`${baseUrl}/api/learning/session/delete`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
      body: JSON.stringify({ sessionId }),
    });
  } catch {
    // Local deletion still proceeds if the network is unavailable.
  }
}
