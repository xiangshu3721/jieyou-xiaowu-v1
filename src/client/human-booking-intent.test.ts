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
    for (const text of ['我想找真人导师聊聊', '帮我预约真人', '我想找咨询师', '我已经决定要预约真人了', '现在我愿意找真人导师聊聊']) {
      expect(isUndecidedHumanHelpQuestion(text)).toBe(false);
      expect(wantsHumanBooking(text)).toBe(true);
    }
    for (const text of ['我暂时不想找真人', '不需要咨询师，我先自己聊']) {
      expect(wantsHumanBooking(text)).toBe(false);
    }
  });

  it('同一句先否定后明确改口时以最新预约意愿为准', () => {
    expect(wantsHumanBooking('我不是要预约真人，我只是想问问；不过现在想清楚了，我想现在预约真人导师')).toBe(true);
    expect(isUndecidedHumanHelpQuestion('我不是要预约真人，我只是想问问')).toBe(false);
    expect(wantsHumanBooking('我想先把情况讲清楚，不要急着安排真人')).toBe(false);
  });
});
