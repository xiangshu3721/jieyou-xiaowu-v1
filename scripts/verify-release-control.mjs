import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const releaseWorkflow = await readFile(path.join(root, '.github/workflows/deploy-pages.yml'), 'utf8');
const qualityWorkflow = await readFile(path.join(root, '.github/workflows/quality-gate.yml'), 'utf8');
const runbook = await readFile(path.join(root, 'docs/release/t02-b1-release-control.md'), 'utf8').catch(() => '');

const requiredReleaseControls = [
  'workflow_dispatch:',
  'release_sha:',
  'backend_version:',
  'backend_smoke_confirmed:',
  'ref: ${{ inputs.release_sha }}',
  'EXPECTED_SHA:',
  'git rev-parse HEAD',
  'cancel-in-progress: false',
  'npm ci',
  'npm run typecheck',
  'npm test -- --reporter=dot',
  'npm run build',
  'npm run build:cloudbase',
  'curl --fail --silent --show-error "$PRODUCTION_HEALTH_URL"',
  'promptVersion',
  'npm run build:pages',
  'npm run verify:production-build',
  'actions/deploy-pages@v4',
  'VITE_API_BASE_URL: https://root-journey-prod-d4d7pzd0a8f805-1304965105.ap-shanghai.app.tcloudbase.com/jieyou-http-api',
  'VITE_PAGES_BASE: /jieyou-xiaowu-v1/',
  "VITE_ENABLE_GROWTH: 'false'",
  "VITE_INCLUDE_CNAME: 'false'",
];
const missingReleaseControls = requiredReleaseControls.filter((value) => !releaseWorkflow.includes(value));
const hasPushTrigger = /\n\s+push:\s*/.test(releaseWorkflow);
const requiredQualityControls = ['pull_request:', 'npm ci', 'npm run typecheck', 'npm test', 'npm run build:cloudbase'];
const missingQualityControls = requiredQualityControls.filter((value) => !qualityWorkflow.includes(value));
const requiredRunbookControls = ['通过受控 CloudBase CLI 部署', 'GitHub Pages', 'CloudBase', '回滚', '不删除数据库表'];
const missingRunbookControls = requiredRunbookControls.filter((value) => !runbook.includes(value));

if (hasPushTrigger || missingReleaseControls.length || missingQualityControls.length || missingRunbookControls.length) {
  throw new Error(JSON.stringify({ hasPushTrigger, missingReleaseControls, missingQualityControls, missingRunbookControls }, null, 2));
}

const order = [
  'npm ci',
  'npm run typecheck',
  'npm test -- --reporter=dot',
  'npm run build',
  'npm run build:cloudbase',
  'curl --fail --silent --show-error "$PRODUCTION_HEALTH_URL"',
  'npm run build:pages',
  'actions/deploy-pages@v4',
].map((value) => releaseWorkflow.indexOf(value));
if (order.some((value) => value < 0) || order.some((value, index) => index > 0 && value <= order[index - 1])) {
  throw new Error('正式发布 Workflow 的质量检查、构建、部署顺序不正确');
}

console.log(JSON.stringify({
  ok: true,
  pushMainTriggerRemoved: true,
  manualShaRequired: true,
  qualityGateRunsBeforeDeploy: true,
  productionApiExplicit: true,
  concurrencyQueuesReleases: true,
  backendDeploymentExcluded: true,
}, null, 2));
