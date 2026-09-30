import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { analyzeConversation } from './rules.js';

type Case = { id: string; turns: string[]; expect: Record<string, unknown> };
const cases = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), 'ai/test-cases.json'), 'utf8')) as Case[];

describe('PRD 固定测试案例清单', () => {
  it('维护完整的 T01-T15 案例', () => {
    expect(cases.map((item) => item.id)).toEqual(Array.from({ length: 15 }, (_, index) => `T${String(index + 1).padStart(2, '0')}`));
    expect(cases.filter((item) => item.turns.length >= 2).length).toBeGreaterThanOrEqual(8);
  });

  it('规则层覆盖关键多轮案例', () => {
    const byId = (id: string) => cases.find((item) => item.id === id)!;
    const analyzeCase = (id: string) => {
      const current = byId(id);
      return analyzeConversation(current.turns.at(-1) || '', current.turns.slice(0, -1).join('\n'));
    };
    expect(analyzeCase('T01').conversation_state).toBe('EMOTIONAL_SUPPORT');
    expect(analyzeCase('T02').safety_status).toBe('NO_SIGNAL_DETECTED');
    expect(analyzeCase('T03').conversation_state).toBe('PROBLEM_SOLVING');
    expect(analyzeCase('T07').routing_state).toBe('HUMAN_SUPPORT');
    expect(analyzeCase('T08').booking_preference).toBe('DECLINED');
    expect(analyzeCase('T10').routing_state).toBe('HUMAN_SUPPORT');
    expect(analyzeCase('T11').routing_state).toBe('PROFESSIONAL_REFERRAL');
    expect(analyzeCase('T12').safety_status).toBe('URGENT');
  });
});
