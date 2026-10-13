import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

type GrowthCase = { id: string; turns: string[]; expect: Record<string, unknown> };
const cases = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), 'ai/growth-test-cases.json'), 'utf8')) as GrowthCase[];

describe('V1.9 最近的我固定测试案例', () => {
  it('维护 TEST01-TEST10 多轮案例，覆盖同意、镜像、反馈、观察和删除', () => {
    expect(cases.map((item) => item.id)).toEqual(Array.from({ length: 10 }, (_, index) => `TEST${String(index + 1).padStart(2, '0')}`));
    expect(cases.every((item) => item.turns.length >= 2)).toBe(true);
    expect(new Set(cases.map((item) => Object.keys(item.expect)[0]))).toContain('cards');
    expect(new Set(cases.map((item) => Object.keys(item.expect)[0]))).toContain('watch');
  });
});
