import { describe, expect, it } from 'vitest';
import { isUndecidedHumanHelpQuestion, wantsHumanBooking } from '../shared.js';

describe('求助犹豫与明确预约意图区分', () => {
  it('不把要不要找咨询师/真人的疑问当成已确认预约', () => {
    for (const text of [
      '要不要找咨询师啊',
      '要不要找咨询师啊？',
      '我是不是该找真人聊聊？',
      '我需要找心理咨询师吗',
      '找咨询师有必要吗？',
      '有没有真人可以聊聊？',
      '有咨询服务吗',
      '我想找真人聊聊，可以吗？',
    ]) {
      expect(isUndecidedHumanHelpQuestion(text)).toBe(true);
      expect(wantsHumanBooking(text)).toBe(false);
    }
  });

  it('已经确定预约时保留直接预约通道，拒绝真人时不自动跳转', () => {
    for (const text of ['我想找真人导师聊聊', '帮我预约真人', '我想找咨询师', '我已经决定要预约真人了']) {
      expect(isUndecidedHumanHelpQuestion(text)).toBe(false);
      expect(wantsHumanBooking(text)).toBe(true);
    }
    for (const text of ['我暂时不想找真人', '不需要咨询师，我先自己聊']) {
      expect(wantsHumanBooking(text)).toBe(false);
    }
  });
});
