import type { GrowthEvent, GrowthFeedback, GrowthSnapshot, GrowthWatchItem } from '../src/shared.js';
import type { GrowthStore } from '../server/growth-store.js';

export interface CloudBaseGrowthEnv {
  CLOUDBASE_APIKEY?: string;
  CLOUDBASE_ENV_ID?: string;
  CLOUDBASE_API_ENDPOINT?: string;
  GROWTH_TABLE_PREFIX?: string;
}

type SqlRow = Record<string, unknown>;
const tableSuffixes = {
  events: 'events',
  snapshots: 'snapshots',
  watches: 'watches',
  feedback: 'feedback',
} as const;

function tableNames(prefix = 'jieyou_growth_') {
  const normalizedPrefix = prefix.replace(/[^a-zA-Z0-9_]/g, '') || 'jieyou_growth_';
  return Object.fromEntries(Object.entries(tableSuffixes).map(([key, suffix]) => [key, `${normalizedPrefix}${suffix}`])) as Record<keyof typeof tableSuffixes, string>;
}

function sqlString(value: string) { return `'${value.replaceAll("'", "''")}'`; }
function jsonText(value: unknown) { return `${sqlString(JSON.stringify(value))}::jsonb`; }
function rowsFromResult(result: unknown) { return Array.isArray(result) ? result as SqlRow[] : []; }

export class CloudBaseGrowthStore implements GrowthStore {
  mode = 'CLOUDBASE' as const;
  private schemaReady: Promise<void> | null = null;
  private readonly tables;

  constructor(private readonly env: CloudBaseGrowthEnv) {
    if (!env.CLOUDBASE_APIKEY || !env.CLOUDBASE_ENV_ID) throw new Error('CloudBase API Key 或环境 ID 未配置');
    this.tables = tableNames(env.GROWTH_TABLE_PREFIX);
  }

  private async execute(sql: string) {
    const envId = this.env.CLOUDBASE_ENV_ID?.trim();
    const apiKey = this.env.CLOUDBASE_APIKEY?.trim();
    if (!envId || !apiKey) throw new Error('CloudBase API Key 或环境 ID 未配置');
    const endpoint = this.env.CLOUDBASE_API_ENDPOINT || `https://${envId}.api.tcloudbasegateway.com/v1/rdb/exec-pgsql`;
    const response = await fetch(endpoint, { method: 'POST', headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ sql, role: 'cloudbase_postgres' }) });
    const payload = await response.json().catch(() => null) as unknown;
    if (!response.ok || (payload && !Array.isArray(payload) && typeof payload === 'object' && 'code' in payload)) {
      const error = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {};
      throw new Error(String(error.message || error.error || `CloudBase PostgreSQL 请求失败 HTTP ${response.status}`));
    }
    return payload;
  }

  private async ensureSchema() {
    // CloudBase PostgreSQL DDL is applied by the versioned migration before
    // deployment. Runtime requests must never attempt schema changes.
    if (!this.schemaReady) this.schemaReady = Promise.resolve();
    await this.schemaReady;
  }

  private async save(table: keyof typeof tableSuffixes, id: string, growthId: string, createdAt: string, value: unknown) {
    await this.ensureSchema();
    await this.execute(`INSERT INTO public.${this.tables[table]} (_id, growth_id, created_at, document) VALUES (${sqlString(id)}, ${sqlString(growthId)}, ${sqlString(createdAt)}, ${jsonText(value)}) ON CONFLICT (_id) DO UPDATE SET growth_id = EXCLUDED.growth_id, created_at = EXCLUDED.created_at, document = EXCLUDED.document`);
  }

  private async list<T>(table: keyof typeof tableSuffixes, growthId: string, limit = 100) {
    await this.ensureSchema();
    const safeLimit = Math.max(1, Math.min(1_000, Math.round(limit)));
    const result = rowsFromResult(await this.execute(`SELECT document::text AS document FROM public.${this.tables[table]} WHERE growth_id = ${sqlString(growthId)} ORDER BY created_at DESC LIMIT ${safeLimit}`));
    return result.map((row) => typeof row.document === 'string' ? JSON.parse(row.document) as T : row.document as T);
  }

  listEvents(growthId: string, limit = 100) { return this.list<GrowthEvent>('events', growthId, limit); }
  saveEvent(event: GrowthEvent) { return this.save('events', event.event_id, event.growth_id, event.last_seen_at, event); }
  listSnapshots(growthId: string, limit = 20) { return this.list<GrowthSnapshot>('snapshots', growthId, limit); }
  saveSnapshot(snapshot: GrowthSnapshot) { return this.save('snapshots', snapshot.snapshot_id, snapshot.growth_id, snapshot.generated_at, snapshot); }

  async getActiveWatch(growthId: string) {
    const watches = await this.list<GrowthWatchItem>('watches', growthId, 20);
    return watches.find((item) => item.status === 'ACTIVE' && Date.parse(item.expires_at) > Date.now()) || null;
  }

  async saveWatch(watch: GrowthWatchItem) {
    await this.ensureSchema();
    await this.execute(`UPDATE public.${this.tables.watches} SET document = jsonb_set(document, '{status}', '"COMPLETED"') WHERE growth_id = ${sqlString(watch.growth_id)} AND document->>'status' = 'ACTIVE'`);
    await this.save('watches', watch.watch_id, watch.growth_id, watch.created_at, watch);
  }
  async clearWatch(growthId: string) {
    await this.ensureSchema();
    const result = rowsFromResult(await this.execute(`UPDATE public.${this.tables.watches} SET document = jsonb_set(document, '{status}', '"COMPLETED"'), created_at = created_at WHERE growth_id = ${sqlString(growthId)} AND document->>'status' = 'ACTIVE' RETURNING _id`));
    return result.length;
  }
  saveFeedback(feedback: GrowthFeedback) { return this.save('feedback', feedback.feedback_id, feedback.growth_id, feedback.created_at, feedback); }

  async deleteMemory(growthId: string) {
    await this.ensureSchema();
    let deleted = 0;
    for (const table of Object.keys(tableSuffixes) as Array<keyof typeof tableSuffixes>) {
      const rows = rowsFromResult(await this.execute(`DELETE FROM public.${this.tables[table]} WHERE growth_id = ${sqlString(growthId)} RETURNING _id`));
      deleted += rows.length;
    }
    return deleted;
  }
}

export function createCloudBaseGrowthStore(env: CloudBaseGrowthEnv) {
  return env.CLOUDBASE_APIKEY && env.CLOUDBASE_ENV_ID ? new CloudBaseGrowthStore(env) : null;
}
