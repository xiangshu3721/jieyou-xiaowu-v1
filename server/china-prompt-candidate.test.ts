import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { prompts as serverPrompts, promptMetadata as serverMetadata } from './prompts.js';
import { prompts as workerPrompts, promptMetadata as workerMetadata } from '../worker/prompts.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const examplePath = 'ai/examples/candidate-prompt-v1.md';
const examples = fs.readFileSync(path.join(root, examplePath), 'utf8').trim();

describe('中国本土对话示范（仅候选分支）', () => {
  it('Node 与 Worker 的实时 chat Prompt 内容相同且含有 10 条示范', () => {
    expect(serverPrompts.chat).toBe(workerPrompts.chat);
    expect(serverPrompts.chat).toContain('CN_DIALOGUE_EXPERIMENT_V1');
    expect([...examples.matchAll(/^### \d+\./gm)]).toHaveLength(10);
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
    expect(examples).toContain('可以只承接、不问句收尾');
    expect(examples).toContain('一次只问一个最关键的信息点');
    expect(examples).toContain('好，那我先听着，不急着帮你想办法。');
  });

  it('不把盲测样本、整套训练数据、敏感客户记录导入实时 Prompt', () => {
    expect(examples.length).toBeLessThan(2600);
    expect(examples).not.toMatch(/CN-EVAL-\d+/);
    expect(examples).not.toMatch(/CN-TRAIN-\d+/);
    expect(examples).toContain('原创虚构情境');
    expect(examples).toContain('未经导师审核');
  });
});
