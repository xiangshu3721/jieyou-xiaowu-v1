import type {
  CandidateRule,
  ConversationReview,
  LearningEventRecord,
  LearningInsight,
  LearningStore,
  MentorFeedbackInput,
} from '../server/learning.js';

export interface CloudBaseLearningEnv {
  CLOUDBASE_APIKEY?: string;
  CLOUDBASE_ENV_ID?: string;
  CLOUDBASE_API_ENDPOINT?: string;
}

type SqlRow = Record<string, unknown>;

const tableNames = {
  events: 'jieyou_learning_events',
  metrics: 'jieyou_conversation_metrics',
  reviews: 'jieyou_conversation_reviews',
  feedback: 'jieyou_mentor_feedback',
  insights: 'jieyou_learning_insights',
  candidates: 'jieyou_candidate_rules',
} as const;

const schemaSql = Object.values(tableNames).map((table) => `CREATE TABLE IF NOT EXISTS public.${table} (\n  _id TEXT PRIMARY KEY,\n  created_at TEXT NOT NULL,\n  session_hash TEXT NOT NULL DEFAULT '',\n  document JSONB NOT NULL\n)`);

function sqlString(value: string) {
  return `'${value.replaceAll("'", "''")}'`;
}

function jsonText(value: unknown) {
  return `${sqlString(JSON.stringify(value))}::jsonb`;
}

function documentId(prefix: string, value: unknown) {
  const text = `${prefix}:${JSON.stringify(value)}`;
  let hash = 2_166_136_261;
  for (const character of text) {
    hash ^= character.codePointAt(0) || 0;
    hash = Math.imul(hash, 16_777_619);
  }
  return `${prefix}_${(hash >>> 0).toString(16)}`;
}

function rowsFromResult(result: unknown) {
  return Array.isArray(result) ? result as SqlRow[] : [];
}

export class CloudBaseLearningStore implements LearningStore {
  mode = 'CLOUDBASE' as const;
  private schemaReady: Promise<void> | null = null;

  constructor(private readonly env: CloudBaseLearningEnv) {
    if (!env.CLOUDBASE_APIKEY || !env.CLOUDBASE_ENV_ID) throw new Error('CloudBase API Key 或环境 ID 未配置');
  }

  private async execute(sql: string, role = 'cloudbase_postgres') {
    const envId = this.env.CLOUDBASE_ENV_ID?.trim();
    const apiKey = this.env.CLOUDBASE_APIKEY?.trim();
    if (!envId || !apiKey) throw new Error('CloudBase API Key 或环境 ID 未配置');
    const endpoint = this.env.CLOUDBASE_API_ENDPOINT || `https://${envId}.api.tcloudbasegateway.com/v1/rdb/exec-pgsql`;
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ sql, role }),
    });
    const payload = await response.json().catch(() => null) as unknown;
    if (!response.ok || (payload && !Array.isArray(payload) && typeof payload === 'object' && 'code' in payload)) {
      const error = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {};
      throw new Error(String(error.message || error.error || `CloudBase PostgreSQL 请求失败 HTTP ${response.status}`));
    }
    return payload;
  }

  private async ensureSchema() {
    if (!this.schemaReady) {
      this.schemaReady = (async () => {
        for (const sql of schemaSql) await this.execute(sql);
      })();
    }
    await this.schemaReady;
  }

  private async add(table: keyof typeof tableNames, id: string, createdAt: string, sessionHash: string, value: unknown) {
    await this.ensureSchema();
    await this.execute(`INSERT INTO public.${tableNames[table]} (_id, created_at, session_hash, document) VALUES (${sqlString(id)}, ${sqlString(createdAt)}, ${sqlString(sessionHash)}, ${jsonText(value)}) ON CONFLICT (_id) DO NOTHING`);
  }

  private async list<T>(table: keyof typeof tableNames, limit = 200): Promise<T[]> {
    await this.ensureSchema();
    const safeLimit = Math.max(1, Math.min(1_000, Math.round(limit)));
    const result = rowsFromResult(await this.execute(`SELECT document::text AS document FROM public.${tableNames[table]} ORDER BY created_at DESC LIMIT ${safeLimit}`));
    return result.map((row) => {
      if (typeof row.document === 'string') return JSON.parse(row.document) as T;
      return row.document as T;
    });
  }

  addEvent(event: LearningEventRecord) {
    return this.add('events', event.event_id, event.occurred_at, event.session_hash, event);
  }

  saveMetrics(metrics: LearningEventRecord) {
    return this.add('metrics', metrics.event_id, metrics.occurred_at, metrics.session_hash, metrics);
  }

  saveReview(review: ConversationReview) {
    return this.add('reviews', review.review_id, review.created_at, review.session_hash, review);
  }

  saveMentorFeedback(feedback: MentorFeedbackInput & { created_at: string }) {
    return this.add('feedback', documentId('feedback', feedback), feedback.created_at, '', feedback);
  }

  listEvents(limit = 500) { return this.list<LearningEventRecord>('events', limit); }
  listReviews(limit = 100) { return this.list<ConversationReview>('reviews', limit); }
  listMentorFeedback(limit = 100) { return this.list<MentorFeedbackInput & { created_at: string }>('feedback', limit); }
  listInsights(limit = 50) { return this.list<LearningInsight>('insights', limit); }

  saveInsight(insight: LearningInsight) {
    return this.add('insights', insight.insight_id, insight.created_at, '', insight);
  }

  listCandidateRules(limit = 50) { return this.list<CandidateRule>('candidates', limit); }

  saveCandidateRule(rule: CandidateRule) {
    return this.add('candidates', rule.candidate_id, rule.created_at, '', rule);
  }

  async deleteBySession(sessionHash: string) {
    await this.ensureSchema();
    let deleted = 0;
    for (const table of ['events', 'metrics', 'reviews'] as const) {
      const rows = rowsFromResult(await this.execute(`DELETE FROM public.${tableNames[table]} WHERE session_hash = ${sqlString(sessionHash)} RETURNING _id`));
      deleted += rows.length;
    }
    return deleted;
  }
}

export function createCloudBaseLearningStore(env: CloudBaseLearningEnv) {
  return env.CLOUDBASE_APIKEY && env.CLOUDBASE_ENV_ID ? new CloudBaseLearningStore(env) : null;
}
