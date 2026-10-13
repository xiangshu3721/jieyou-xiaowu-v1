import { describe, expect, it } from 'vitest';
import type { GrowthEvent, GrowthFeedback, GrowthSnapshot, GrowthWatchItem } from '../src/shared.js';
import { generateGrowthSnapshot, recordGrowthEvent, saveGrowthWatch, watchIsRelevant } from './growth-service.js';
import type { GrowthStore } from './growth-store.js';

class MemoryGrowthStore implements GrowthStore {
  mode = 'LOCAL_FILE' as const;
  events: GrowthEvent[] = [];
  snapshots: GrowthSnapshot[] = [];
  watches: GrowthWatchItem[] = [];
  feedback: GrowthFeedback[] = [];
  async listEvents(id: string) { return this.events.filter((item) => item.growth_id === id); }
  async saveEvent(value: GrowthEvent) { this.events = [...this.events.filter((item) => item.event_id !== value.event_id), value]; }
  async listSnapshots(id: string) { return this.snapshots.filter((item) => item.growth_id === id); }
  async saveSnapshot(value: GrowthSnapshot) { this.snapshots = [...this.snapshots.filter((item) => item.snapshot_id !== value.snapshot_id), value]; }
  async getActiveWatch(id: string) { return this.watches.find((item) => item.growth_id === id && item.status === 'ACTIVE') || null; }
  async saveWatch(value: GrowthWatchItem) { this.watches = [...this.watches.filter((item) => item.growth_id !== value.growth_id || item.status !== 'ACTIVE'), value]; }
  async clearWatch(id: string) { const count = this.watches.filter((item) => item.growth_id === id && item.status === 'ACTIVE').length; this.watches = this.watches.map((item) => item.growth_id === id && item.status === 'ACTIVE' ? { ...item, status: 'COMPLETED' as const } : item); return count; }
  async saveFeedback(value: GrowthFeedback) { this.feedback.push(value); }
  async deleteMemory(id: string) { const before = this.events.length + this.snapshots.length + this.watches.length + this.feedback.length; this.events = this.events.filter((item) => item.growth_id !== id); this.snapshots = this.snapshots.filter((item) => item.growth_id !== id); this.watches = this.watches.filter((item) => item.growth_id !== id); this.feedback = this.feedback.filter((item) => item.growth_id !== id); return before - (this.events.length + this.snapshots.length + this.watches.length + this.feedback.length); }
}

const prompt = 'return structured JSON';
const analysis = { minimum_sufficient_judgment: true, problem_clarity: 0.8, confirmed_goal: '想把工作和休息重新安排得清楚一点', tags: ['CAREER'], problem_map: { main_issue: '工作压力', scene_summary: '工作后仍然停不下来', user_goal: '安排边界' } };
const messages = [{ role: 'user' as const, content: '最近下班后还是一直想着工作' }, { role: 'assistant' as const, content: '听起来你很难真正停下来。' }];

describe('V1.9 最近的我', () => {
  it('长期记忆默认拒绝，开启后只保存结构化事件且相同主线合并', async () => {
    const store = new MemoryGrowthStore();
    const model = async () => JSON.stringify({ category: 'PATTERN', topic: 'CAREER', title: '下班后仍被工作牵着走', summary: '你开始注意到工作和休息之间的边界变得模糊。', user_words: '下班后还是一直想着工作', evidence: ['下班后仍想着工作'], change_direction: 'NEEDS_SUPPORT', strength: '愿意停下来观察', next_step: '留意什么时候最难停下', impact: 'MEDIUM' });
    const refused = await recordGrowthEvent({ growthId: 'growth-test-user', consent: false, messages, analysis }, store, model, prompt);
    expect(refused.status).toBe(403);
    await recordGrowthEvent({ growthId: 'growth-test-user', consent: true, messages, analysis, issueId: 'issue-1' }, store, model, prompt);
    await recordGrowthEvent({ growthId: 'growth-test-user', consent: true, messages, analysis, issueId: 'issue-2' }, store, model, prompt);
    expect(store.events).toHaveLength(1);
    expect(JSON.stringify(store.events[0])).not.toContain('最近下班后还是一直想着工作');
    expect(store.events[0].seen_count).toBe(2);
  });

  it('事件不足时不生成快照，事件足够后同一证据返回稳定快照', async () => {
    const store = new MemoryGrowthStore();
    for (const [index, topic] of (['CAREER', 'EMOTION', 'FAMILY'] as const).entries()) {
      store.events.push({ event_id: `event-${index}`, growth_id: 'growth-test-user', created_at: new Date().toISOString(), observed_at: new Date().toISOString(), issue_id: `issue-${index}`, category: 'THEME', topic, title: topic, summary: `${topic} 的结构化片段`, user_words: null, evidence: ['用户明确表达'], change_direction: 'STABLE', strength: '愿意继续看见自己', next_step: '留意下一次出现的时刻', impact: 'MEDIUM', stable_key: `${topic}:main`, seen_count: 1, last_seen_at: new Date().toISOString() });
    }
    const first = await generateGrowthSnapshot({ growthId: 'growth-test-user', consent: true, period: '30d' }, store, async () => '{"invalid":true}', prompt);
    expect(first.status).toBe(200);
    expect((first.body as { ready: boolean }).ready).toBe(true);
    const snapshotId = (first.body as { snapshot: GrowthSnapshot }).snapshot.snapshot_id;
    const second = await generateGrowthSnapshot({ growthId: 'growth-test-user', consent: true, period: '30d' }, store, async () => { throw new Error('should not call again'); }, prompt);
    expect((second.body as { stable: boolean }).stable).toBe(true);
    expect((second.body as { snapshot: GrowthSnapshot }).snapshot.snapshot_id).toBe(snapshotId);
  });

  it('观察项只在相关聊天里有资格被自然带到', async () => {
    const store = new MemoryGrowthStore();
    const result = await saveGrowthWatch({ growthId: 'growth-test-user', consent: true, title: '留意下班后的停不下来', description: '这周看看什么时候又开始反复想着工作' }, store);
    expect(result.status).toBe(201);
    const watch = store.watches[0];
    expect(watchIsRelevant(watch, '今天下班后又开始担心工作了')).toBe(true);
    expect(watchIsRelevant(watch, '周末想看一部电影')).toBe(false);
  });
});
