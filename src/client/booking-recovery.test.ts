import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, isConfirmedAppointmentResponse, submitAppointmentWithRecovery } from './main.js';

describe('appointment submission recovery', () => {
  afterEach(() => vi.restoreAllMocks());

  it('远端成功但本地保存失败，仍认定为已提交', async () => {
    const submit = vi.fn().mockResolvedValue({ ok: true, status: 'submitted', recordId: 'rec-001' });
    const query = vi.fn();
    const localSave = vi.fn().mockRejectedValue(new Error('local IndexedDB write failed'));
    let resultPage = false;
    const onSubmitted = vi.fn(async () => {
      try { await localSave(); } catch { /* local repair is separate from remote success */ }
      resultPage = true;
    });

    const result = await submitAppointmentWithRecovery(submit, query, onSubmitted);

    expect(result).toBe('submitted');
    expect(submit).toHaveBeenCalledTimes(1);
    expect(query).not.toHaveBeenCalled();
    expect(onSubmitted).toHaveBeenCalledWith(expect.objectContaining({ recordId: 'rec-001' }));
    expect(localSave).toHaveBeenCalledTimes(1);
    expect(resultPage).toBe(true);
  });

  it('网络响应丢失后用同一 requestId 查询成功，不重复 POST', async () => {
    const requestId = 'JY-recovery-001';
    const submit = vi.fn().mockRejectedValue(new TypeError('network response lost'));
    const query = vi.fn(async () => ({ requestId, status: '待分配', recordId: 'rec-002' }));
    const onSubmitted = vi.fn();

    const result = await submitAppointmentWithRecovery(submit, query, onSubmitted);

    expect(result).toBe('submitted');
    expect(submit).toHaveBeenCalledTimes(1);
    expect(query).toHaveBeenCalledTimes(1);
    expect(onSubmitted).toHaveBeenCalledTimes(1);
  });

  it('回查 404 或超时时保持非成功状态，不自动重复提交', async () => {
    const submit = vi.fn().mockRejectedValue(new TypeError('network response lost'));
    const onSubmitted = vi.fn();

    const notFound = await submitAppointmentWithRecovery(submit, vi.fn().mockRejectedValue(new ApiError('not found', 404)), onSubmitted);
    expect(notFound).toBe('pending');
    expect(submit).toHaveBeenCalledTimes(1);
    expect(onSubmitted).not.toHaveBeenCalled();

    const unknown = await submitAppointmentWithRecovery(submit, vi.fn().mockRejectedValue(new Error('status timeout')), onSubmitted);
    expect(unknown).toBe('unknown');
    expect(submit).toHaveBeenCalledTimes(2);
    expect(onSubmitted).not.toHaveBeenCalled();
  });

  it('HTTP 200 但缺少明确成功字段时不标记成功，改为回查', async () => {
    const submit = vi.fn().mockResolvedValue({ ok: true, status: 'submitted' });
    const query = vi.fn().mockResolvedValue({ requestId: 'JY-incomplete-001', status: 'processing' });
    const onSubmitted = vi.fn();

    expect(isConfirmedAppointmentResponse({ ok: true, status: 'submitted' })).toBe(false);
    const result = await submitAppointmentWithRecovery(submit, query, onSubmitted);

    expect(result).toBe('unknown');
    expect(submit).toHaveBeenCalledTimes(1);
    expect(query).toHaveBeenCalledTimes(1);
    expect(onSubmitted).not.toHaveBeenCalled();
  });
});
