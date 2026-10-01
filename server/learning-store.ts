import fs from 'node:fs/promises';
import path from 'node:path';
import type {
  CandidateRule,
  ConversationReview,
  LearningEventRecord,
  LearningInsight,
  LearningStore,
  MentorFeedbackInput,
} from './learning.js';
import { config } from './config.js';

type Storable = LearningEventRecord | ConversationReview | LearningInsight | CandidateRule | (MentorFeedbackInput & { created_at: string });

const files = {
  events: 'learning-events.jsonl',
  metrics: 'conversation-metrics.jsonl',
  reviews: 'conversation-reviews.jsonl',
  feedback: 'mentor-feedback.jsonl',
  insights: 'learning-insights.jsonl',
  candidates: 'candidate-rules.jsonl',
} as const;

async function ensureDirectory() {
  await fs.mkdir(path.resolve(config.rootDir, 'data/learning'), { recursive: true });
}

async function append(name: keyof typeof files, value: Storable) {
  await ensureDirectory();
  await fs.appendFile(path.resolve(config.rootDir, 'data/learning', files[name]), `${JSON.stringify(value)}\n`, 'utf8');
}

async function readAll<T>(name: keyof typeof files, limit = 200): Promise<T[]> {
  try {
    const text = await fs.readFile(path.resolve(config.rootDir, 'data/learning', files[name]), 'utf8');
    return text.split(/\r?\n/).filter(Boolean).slice(-limit).reverse().flatMap((line) => {
      try { return [JSON.parse(line) as T]; } catch { return []; }
    });
  } catch {
    return [];
  }
}

export class FileLearningStore implements LearningStore {
  mode = 'LOCAL_FILE' as const;
  addEvent(event: LearningEventRecord) { return append('events', event); }
  saveMetrics(metrics: LearningEventRecord) { return append('metrics', metrics); }
  saveReview(review: ConversationReview) { return append('reviews', review); }
  saveMentorFeedback(feedback: MentorFeedbackInput & { created_at: string }) { return append('feedback', feedback); }
  listEvents(limit = 500) { return readAll<LearningEventRecord>('events', limit); }
  listReviews(limit = 100) { return readAll<ConversationReview>('reviews', limit); }
  listMentorFeedback(limit = 100) { return readAll<MentorFeedbackInput & { created_at: string }>('feedback', limit); }
  listInsights(limit = 50) { return readAll<LearningInsight>('insights', limit); }
  saveInsight(insight: LearningInsight) { return append('insights', insight); }
  listCandidateRules(limit = 50) { return readAll<CandidateRule>('candidates', limit); }
  saveCandidateRule(rule: CandidateRule) { return append('candidates', rule); }
  async deleteBySession(sessionHash: string) {
    const targets: Array<keyof typeof files> = ['events', 'metrics', 'reviews'];
    let deleted = 0;
    await ensureDirectory();
    for (const name of targets) {
      const filePath = path.resolve(config.rootDir, 'data/learning', files[name]);
      let text = '';
      try { text = await fs.readFile(filePath, 'utf8'); } catch { continue; }
      const kept = text.split(/\r?\n/).filter(Boolean).filter((line) => {
        try {
          const value = JSON.parse(line) as { session_hash?: string };
          const match = value.session_hash === sessionHash;
          if (match) deleted += 1;
          return !match;
        } catch { return true; }
      });
      await fs.writeFile(filePath, kept.length ? `${kept.join('\n')}\n` : '', 'utf8');
    }
    return deleted;
  }
}
