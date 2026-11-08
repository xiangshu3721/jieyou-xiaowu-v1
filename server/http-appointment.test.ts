import { describe, expect, it } from 'vitest';
import { isValidAppointmentRequest } from './http.js';

describe('local Node appointment API', () => {
  it('允许省略 desiredHelp，并保持其他必要字段校验', async () => {
    expect(isValidAppointmentRequest({ requestId: 'node-optional-help-001', nickname: 'Node Mock User', contact: 'mock@example.invalid', concern: '验证本地接口选填字段。', desiredHelp: '', consent: true })).toBe(true);
    expect(isValidAppointmentRequest({ requestId: 'node-invalid-001', nickname: 'Node Mock User', contact: 'mock@example.invalid', concern: '', desiredHelp: '', consent: true })).toBe(false);
  });
});
