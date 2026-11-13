import { afterEach, describe, expect, it, vi } from 'vitest';
import { readPendingBooking, savePendingBooking, sealConfirmedBookingIssue, shouldStartFreshIssueAfterBooking } from './storage.js';

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

  it('已预约的 Issue 与未预约的 Issue 具有不同的新消息边界', () => {
    expect(shouldStartFreshIssueAfterBooking({ currentIssueId: 'a', issues: { a: { status: 'BOOKING_SUBMITTED' } } })).toBe(true);
    expect(shouldStartFreshIssueAfterBooking({ currentIssueId: 'b', issues: { b: { status: 'PAUSED' } } })).toBe(false);
    expect(shouldStartFreshIssueAfterBooking({ currentIssueId: 'c', issues: { c: { status: 'ACTIVE' } } })).toBe(false);
  });

  it('远端已成功但本地生命周期写入失败时，pending booking 仍防止继续污染旧 Issue', () => {
    const saved = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => saved.get(key) || null,
      setItem: (key: string, value: string) => saved.set(key, value),
    });
    savePendingBooking({ issueId: 'old', requestId: 'req-old', status: 'submitted' });
    expect(shouldStartFreshIssueAfterBooking({ currentIssueId: 'old', issues: { old: { status: 'ACTIVE' } } })).toBe(true);
  });

  it('本地持久化异常时只恢复提交状态，不伪造飞书 recordId 或预约详情', () => {
    const original = { status: 'ACTIVE' as const, handoff_offered: false, handoff_state: 'NOT_READY' as const, booking_case_id: null };
    expect(sealConfirmedBookingIssue(original, 'submitted')).toEqual({
      ...original, status: 'BOOKING_SUBMITTED', handoff_offered: true, handoff_state: 'ACCEPTED',
    });
    expect(sealConfirmedBookingIssue(original, 'pending')).toEqual(original);
    expect(sealConfirmedBookingIssue(original, 'unknown')).toEqual(original);
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
