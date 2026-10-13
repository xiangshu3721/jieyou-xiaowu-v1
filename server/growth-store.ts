import fs from 'node:fs/promises';
import path from 'node:path';
import type { GrowthEvent, GrowthFeedback, GrowthSnapshot, GrowthWatchItem } from '../src/shared.js';
import { config } from './config.js';

export interface GrowthStore {
  mode: 'LOCAL_FILE' | 'CLOUDBASE';
  listEvents(growthId: string, limit?: number): Promise<GrowthEvent[]>;
  saveEvent(event: GrowthEvent): Promise<void>;
  listSnapshots(growthId: string, limit?: number): Promise<GrowthSnapshot[]>;
  saveSnapshot(snapshot: GrowthSnapshot): Promise<void>;
  getActiveWatch(growthId: string): Promise<GrowthWatchItem | null>;
  saveWatch(watch: GrowthWatchItem): Promise<void>;
  clearWatch(growthId: string): Promise<number>;
  saveFeedback(feedback: GrowthFeedback): Promise<void>;
  deleteMemory(growthId: string): Promise<number>;
}

interface GrowthData {
  events: GrowthEvent[];
  snapshots: GrowthSnapshot[];
  watches: GrowthWatchItem[];
  feedback: GrowthFeedback[];
}

const emptyData = (): GrowthData => ({ events: [], snapshots: [], watches: [], feedback: [] });
const filePath = path.resolve(config.rootDir, 'data/growth/growth-memory.json');

async function readData(): Promise<GrowthData> {
  try {
    const parsed = JSON.parse(await fs.readFile(filePath, 'utf8')) as Partial<GrowthData>;
    return {
      events: Array.isArray(parsed.events) ? parsed.events : [],
      snapshots: Array.isArray(parsed.snapshots) ? parsed.snapshots : [],
      watches: Array.isArray(parsed.watches) ? parsed.watches : [],
      feedback: Array.isArray(parsed.feedback) ? parsed.feedback : [],
    };
  } catch {
    return emptyData();
  }
}

export class FileGrowthStore implements GrowthStore {
  mode = 'LOCAL_FILE' as const;
  private queue: Promise<void> = Promise.resolve();

  private async mutate<T>(fn: (data: GrowthData) => T | Promise<T>): Promise<T> {
    const previous = this.queue;
    let release!: () => void;
    this.queue = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    try {
      const data = await readData();
      const result = await fn(data);
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf8');
      return result;
    } finally {
      release();
    }
  }

  async listEvents(growthId: string, limit = 100) {
    const data = await readData();
    return data.events.filter((item) => item.growth_id === growthId).sort((a, b) => b.last_seen_at.localeCompare(a.last_seen_at)).slice(0, limit);
  }

  saveEvent(event: GrowthEvent) {
    return this.mutate((data) => {
      const index = data.events.findIndex((item) => item.event_id === event.event_id);
      if (index >= 0) data.events[index] = event;
      else data.events.push(event);
    });
  }

  async listSnapshots(growthId: string, limit = 20) {
    const data = await readData();
    return data.snapshots.filter((item) => item.growth_id === growthId).sort((a, b) => b.generated_at.localeCompare(a.generated_at)).slice(0, limit);
  }

  saveSnapshot(snapshot: GrowthSnapshot) {
    return this.mutate((data) => {
      const index = data.snapshots.findIndex((item) => item.snapshot_id === snapshot.snapshot_id);
      if (index >= 0) data.snapshots[index] = snapshot;
      else data.snapshots.push(snapshot);
    });
  }

  async getActiveWatch(growthId: string) {
    const data = await readData();
    const now = Date.now();
    return data.watches
      .filter((item) => item.growth_id === growthId && item.status === 'ACTIVE' && Date.parse(item.expires_at) > now)
      .sort((a, b) => b.created_at.localeCompare(a.created_at))[0] || null;
  }

  saveWatch(watch: GrowthWatchItem) {
    return this.mutate((data) => {
      data.watches = data.watches.filter((item) => item.growth_id !== watch.growth_id || item.status !== 'ACTIVE');
      data.watches.push(watch);
    });
  }

  clearWatch(growthId: string) {
    return this.mutate((data) => {
      const active = data.watches.filter((item) => item.growth_id === growthId && item.status === 'ACTIVE').length;
      data.watches = data.watches.map((item) => item.growth_id === growthId && item.status === 'ACTIVE' ? { ...item, status: 'COMPLETED' as const } : item);
      return active;
    });
  }

  saveFeedback(feedback: GrowthFeedback) {
    return this.mutate((data) => { data.feedback.push(feedback); });
  }

  deleteMemory(growthId: string) {
    return this.mutate((data) => {
      const before = data.events.length + data.snapshots.length + data.watches.length + data.feedback.length;
      data.events = data.events.filter((item) => item.growth_id !== growthId);
      data.snapshots = data.snapshots.filter((item) => item.growth_id !== growthId);
      data.watches = data.watches.filter((item) => item.growth_id !== growthId);
      data.feedback = data.feedback.filter((item) => item.growth_id !== growthId);
      return before - (data.events.length + data.snapshots.length + data.watches.length + data.feedback.length);
    });
  }
}
