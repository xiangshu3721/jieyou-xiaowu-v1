import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { prompts as serverPrompts, promptMetadata as serverMetadata } from './prompts.js';
import { prompts as workerPrompts, promptMetadata as workerMetadata } from '../worker/prompts.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const examplePath = 'ai/examples/candidate-prompt-v1.md';
const examples = fs.readFileSync(path.join(root, examplePath), 'utf8').trim();
const pinnedBaseline = fs.readFileSync(path.join(root, 'ai/baselines/chat-main-883d85f.md'), 'utf8').trim();

describe('中国本土对话示范（仅候选分支）', () => {
  it('Node 与 Worker 的实时 chat Prompt 内容相同且含有 7 条精简示范', () => {
    expect(serverPrompts.chat).toBe(workerPrompts.chat);
    expect(serverPrompts.chat).toContain('CN_DIALOGUE_EXPERIMENT_V1');
    expect([...examples.matchAll(/^### \d+\./gm)]).toHaveLength(7);
    expect(serverMetadata.files).toContain(examplePath);
    expect(workerMetadata.files).toContain(examplePath);
  });

  it('候选只进入对话回复，不改安全/转介/分类器 Prompt', () => {
    for (const p of [serverPrompts, workerPrompts]) {
      expect(p.router).not.toContain('CN_DIALOGUE_EXPERIMENT_V1');
      expect(p.safety).not.toContain('CN_DIALOGUE_EXPERIMENT_V1');
      expect(p.classifier).not.toContain('CN_DIALOGUE_EXPERIMENT_V1');
      expect(p.chat).toContain('即时安全风险优先');
      expect(p.chat).toContain('真人预约按钮只跟随');
    }
  });

  it('倾诉时允许自然留白，需要澄清时限制为单一关键信息', () => {
    expect(examples).toContain('不要用问句、选择题或“从哪说起”收尾');
    expect(examples).toContain('只问一个会改变下一步的关键信息');
    expect(examples).toContain('今天就先说说，不急着解决。');
  });

  it('隐私承诺禁止位于最高优先级，纠错与行动数量规则明确', () => {
    expect(serverPrompts.chat).toContain('不得对隐私作绝对保证');
    expect(serverPrompts.chat).toContain('纠正 AI 理解时，本轮直接承认误解并更新事实，停止追问');
    expect(serverPrompts.chat).toContain('整轮回复合计最多三项优先行动');
    expect(examples).toContain('关心家人和能负担多少是两回事');
  });

  it('三条失败点在优先规则中明确，而非依赖示范数量', () => {
    expect(serverPrompts.chat).toContain('变相求证');
    expect(serverPrompts.chat).toContain('只承接已经说出的具体事实');
    expect(serverPrompts.chat).toContain('可持续上限');
    expect(serverPrompts.chat).toContain('给一句可用的边界表达');
    expect(serverPrompts.chat).toContain('整轮回复合计最多三项优先行动');
    expect(serverPrompts.chat).toContain('子任务也计入总数');
  });

  it('旧版基线由 main 原提交固定，不混入候选实验规则', () => {
    expect(pinnedBaseline).toContain('# 解忧小屋 V1.4');
    expect(pinnedBaseline).not.toContain('CN_DIALOGUE_EXPERIMENT_V1');
    expect(pinnedBaseline).not.toContain('不得对隐私作绝对保证');
    expect(pinnedBaseline).not.toBe(serverPrompts.chat);
  });

  it('不把盲测样本、整套训练数据、敏感客户记录导入实时 Prompt', () => {
    expect(examples.length).toBeLessThan(2600);
    expect(examples).not.toMatch(/CN-EVAL-\d+/);
    expect(examples).not.toMatch(/CN-TRAIN-\d+/);
    expect(examples).toContain('虚构中文示范');
    expect(examples).toContain('待审核');
    expect(examples).toContain('先给可直接尝试的 1～3 步');
    expect(examples).toContain('财务及过渡安排');
    expect(examples).toContain('禁说“我不会告诉你爸妈”');
    expect(examples.length).toBeLessThan(1300);

  });
});
