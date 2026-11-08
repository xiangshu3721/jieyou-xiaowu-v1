import { describe, expect, it } from 'vitest';
import { hasRequiredBookingFields } from './main.js';

describe('optional booking help field', () => {
  it('只填写其他必要字段时也允许提交', () => {
    expect(hasRequiredBookingFields({ nickname: '小雨', contact: 'mock@example.invalid', summary: '最近工作压力很大。', consent: true })).toBe(true);
  });

  it('昵称、联系方式、困扰摘要和授权仍然必填', () => {
    expect(hasRequiredBookingFields({ nickname: '', contact: 'mock@example.invalid', summary: '困扰', consent: true })).toBe(false);
    expect(hasRequiredBookingFields({ nickname: '小雨', contact: '', summary: '困扰', consent: true })).toBe(false);
    expect(hasRequiredBookingFields({ nickname: '小雨', contact: 'mock@example.invalid', summary: '', consent: true })).toBe(false);
    expect(hasRequiredBookingFields({ nickname: '小雨', contact: 'mock@example.invalid', summary: '困扰', consent: false })).toBe(false);
  });
});
