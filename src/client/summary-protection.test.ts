import { describe, expect, it } from 'vitest';
import { guardedSummaryResult } from './main.js';

describe('booking summary user-edit protection', () => {
  it('迟到的自动摘要不会覆盖请求期间的手动编辑', async () => {
    let resolveSummary!: (value: { summary: string }) => void;
    let userEdited = false;
    const pending = new Promise<{ summary: string }>((resolve) => { resolveSummary = resolve; });
    const result = guardedSummaryResult(() => pending, () => !userEdited);

    userEdited = true;
    resolveSummary({ summary: 'AI 整理的内容' });

    expect(await result).toBeNull();
  });

  it('当前请求且用户未编辑时才应用摘要，空摘要和失败均可继续手填', async () => {
    let current = true;
    expect(await guardedSummaryResult(async () => ({ summary: '  可用摘要  ' }), () => current)).toBe('可用摘要');

    current = false;
    expect(await guardedSummaryResult(async () => ({ summary: '过期摘要' }), () => current)).toBeNull();
    expect(await guardedSummaryResult(async () => ({ summary: '   ' }), () => true)).toBeNull();
    expect(await guardedSummaryResult(async () => { throw new Error('summary unavailable'); }, () => true)).toBeNull();
  });
});
