import { afterEach, describe, expect, it, vi } from 'vitest';
import { readPendingBooking, savePendingBooking } from './storage.js';

describe('pending booking requestId', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('按 Issue 复用 requestId，并允许状态从待确认变为已提交', () => {
    const values = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values.get(key) || null,
      setItem: (key: string, value: string) => values.set(key, value),
    });

    savePendingBooking({ issueId: 'issue-a', requestId: 'JY-same-001', status: 'pending' });
    expect(readPendingBooking('issue-a')).toEqual({ issueId: 'issue-a', requestId: 'JY-same-001', status: 'pending' });
    expect(readPendingBooking('issue-b')).toBeNull();

    savePendingBooking({ issueId: 'issue-a', requestId: 'JY-same-001', status: 'submitted' });
    expect(readPendingBooking('issue-a')).toEqual({ issueId: 'issue-a', requestId: 'JY-same-001', status: 'submitted' });
  });

  it('localStorage 不可用时不阻断预约页面', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => { throw new Error('blocked'); },
      setItem: () => { throw new Error('blocked'); },
    });

    expect(() => savePendingBooking({ issueId: 'issue-a', requestId: 'JY-same-002', status: 'unknown' })).not.toThrow();
    expect(readPendingBooking('issue-a')).toBeNull();
  });
});
