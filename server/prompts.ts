import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';

const aiDir = fileURLToPath(new URL('../ai/', import.meta.url));

function readRuleFile(name: string) {
  return fs.readFileSync(path.join(aiDir, name), 'utf8').trim();
}

const files = {
  system: 'system-prompt.md',
  conversation: 'conversation-rules.md',
  taxonomy: 'issue-taxonomy.md',
  routing: 'routing-rules.md',
  safety: 'safety-rules.md',
  assessment: 'assessment-rules.md',
  naturalness: 'naturalness-rules.md',
  summary: 'booking-summary.md',
};

export const prompts = {
  chat: [files.system, files.conversation, files.naturalness, files.taxonomy, files.routing, files.safety, files.assessment].map(readRuleFile).join('\n\n'),
  classifier: readRuleFile(files.taxonomy),
  router: readRuleFile(files.routing),
  safety: readRuleFile(files.safety),
  summary: readRuleFile(files.summary),
};

export const promptMetadata = {
  version: config.promptVersion,
  files: [...Object.values(files).map((name) => path.join('ai', name)), path.join('ai', 'test-cases.json'), path.join('ai', 'changelog.md')],
};
