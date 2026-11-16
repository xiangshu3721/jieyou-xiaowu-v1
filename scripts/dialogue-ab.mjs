import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { prompts } from '../server/prompts.ts';
import { config } from '../server/config.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const all = args.includes('--all');
const limitArg = args.find((value) => value.startsWith('--limit='));
const requestedLimit = limitArg ? Number(limitArg.slice('--limit='.length)) : (all ? 15 : 6);
if (args.some((value) => value !== '--dry-run' && value !== '--all' && !value.startsWith('--limit=')) || !Number.isInteger(requestedLimit) || requestedLimit < 1 || requestedLimit > 15) {
  console.error('用法：npm run eval:dialogue -- --dry-run | --limit=6 | --all');
  process.exit(2);
}

const examples = fs.readFileSync(path.join(root, 'ai/examples/candidate-prompt-v1.md'), 'utf8').trim();
const needle = '\n\n' + examples + '\n\n';
if (prompts.chat.split(needle).length !== 2 || !examples.includes('CN_DIALOGUE_EXPERIMENT_V1')) {
  throw new Error('候选示范必须在 chat Prompt 中恰好出现一次，且有实验标记');
}
const candidatePrompt = prompts.chat;
const baselinePrompt = candidatePrompt.replace(needle, '\n\n');
if (baselinePrompt.includes('CN_DIALOGUE_EXPERIMENT_V1') || candidatePrompt.includes('CN-EVAL-')) {
  throw new Error('基线构造失败或盲测集进入实时 Prompt');
}

function parseCsv(text) {
  const rows = [];
  let row = [], cell = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      if (quoted && text[i + 1] === '"') { cell += '"'; i++; }
      else quoted = !quoted;
    } else if (c === ',' && !quoted) {
      row.push(cell); cell = '';
    } else if ((c === '\n' || c === '\r') && !quoted) {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); if (row.some(Boolean)) rows.push(row);
      row = []; cell = '';
    } else cell += c;
  }
  if (quoted) throw new Error('CSV 引号未闭合');
  row.push(cell); if (row.some(Boolean)) rows.push(row);
  const [header, ...records] = rows;
  return records.map((values) => Object.fromEntries(header.map((key, i) => [key.replace(/^\uFEFF/, ''), values[i] || ''])));
}

const cases = parseCsv(fs.readFileSync(path.join(root, 'ai/datasets/china-holdout-15-v1.csv'), 'utf8'));
if (cases.length !== 15 || new Set(cases.map((item) => item['编号'])).size !== 15 || cases.some((item) => !item['编号']?.startsWith('CN-EVAL-') || !item['用户输入'] || !item['必须做到'])) {
  throw new Error('需要 15 条完整、唯一的 CN-EVAL 盲测案例');
}
const selected = cases.slice(0, requestedLimit);
console.log(JSON.stringify({
  phase: dryRun ? 'DRY_RUN_VALIDATED' : 'REAL_DEEPSEEK_PROMPT_AB',
  model: config.deepseek.model,
  selectedCases: selected.map((item) => item['编号']),
  totalApiCalls: dryRun ? 0 : selected.length * 2,
  baselineChars: baselinePrompt.length,
  candidateChars: candidatePrompt.length,
  note: '只测系统 Prompt 的直接回答，不等于 /api/chat 完整 Issue、导诊和安全端到端验收',
}, null, 2));
if (dryRun) process.exit(0);
if (!config.deepseek.apiKey) {
  console.error('BLOCKED_NO_DEEPSEEK_KEY：请在已有 .env.local 设置 DEEPSEEK_API_KEY；没有调用模型，不得标记效果 PASS。');
  process.exit(2);
}

const output = path.join(root, 'data/dialogue-ab-reports');
fs.mkdirSync(output, { recursive: true });
const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
const reportFile = path.join(output, 'dialogue-ab-' + timestamp + '.json');
const report = {
  experiment: 'CN_DIALOGUE_EXPERIMENT_V1',
  status: 'RUNNING',
  kind: 'PROMPT_ONLY_NOT_FULL_PRODUCT',
  model: config.deepseek.model,
  temperature: 0.4,
  max_tokens: 500,
  totalPlannedCalls: selected.length * 2,
  cases: [],
};
function save() { fs.writeFileSync(reportFile, JSON.stringify(report, null, 2), 'utf8'); }

async function complete(systemPrompt, userText) {
  const controller = new AbortController();
  const abortAfter = setTimeout(() => controller.abort(), 45000);
  const started = performance.now();
  try {
    const response = await fetch(config.deepseek.baseUrl + '/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + config.deepseek.apiKey },
      body: JSON.stringify({
        model: config.deepseek.model,
        messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userText }],
        temperature: 0.4, max_tokens: 500, stream: false,
      }),
      signal: controller.signal,
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error('DeepSeek HTTP ' + response.status + ': ' + (payload.error?.message || '请求失败'));
    const reply = payload.choices?.[0]?.message?.content?.trim();
    if (!reply) throw new Error('模型回复为空');
    return {
      reply,
      ms: Math.round(performance.now() - started),
      totalTokens: payload.usage?.total_tokens ?? null,
      finishReason: payload.choices?.[0]?.finish_reason ?? null,
    };
  } finally { clearTimeout(abortAfter); }
}

save();
for (const [index, item] of selected.entries()) {
  const result = {
    id: item['编号'],
    category: item['分类'],
    scene: item['场景'],
    userText: item['用户输入'],
    expected: item['必须做到'],
    forbidden: item['不得发生'],
    baseline: null,
    candidate: null,
    humanReview: { baselineScore: null, candidateScore: null, safetyPass: null, notes: '' },
  };
  const order = index % 2 === 0 ? ['baseline', 'candidate'] : ['candidate', 'baseline'];
  try {
    for (const variant of order) {
      result[variant] = await complete(variant === 'baseline' ? baselinePrompt : candidatePrompt, result.userText);
    }
  } catch (error) {
    result.error = error instanceof Error ? error.message : String(error);
    report.status = 'PARTIAL_ERROR';
    console.error(item['编号'] + ': ' + result.error);
  }
  report.cases.push(result);
  save();
  console.log(item['编号'] + ': ' + (result.error ? 'ERROR' : '2 RESPONSES SAVED (unscored)'));
  if (result.error) break;
}
if (report.status !== 'PARTIAL_ERROR') report.status = 'RESPONSES_COLLECTED_AWAITING_HUMAN_REVIEW';
save();
console.log(JSON.stringify({ status: report.status, casesWithBothResponses: report.cases.filter((item) => item.baseline && item.candidate).length, reportFile }, null, 2));
if (report.status === 'PARTIAL_ERROR') process.exitCode = 1;
