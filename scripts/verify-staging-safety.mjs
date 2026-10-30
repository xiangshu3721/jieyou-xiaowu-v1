import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [example, deployScript] = await Promise.all([
  readFile(path.join(root, '.env.staging.example'), 'utf8'),
  readFile(path.join(root, 'scripts/deploy-cloudbase.mjs'), 'utf8'),
]);

const requiredExampleLines = [
  'DEPLOY_ENVIRONMENT=staging',
  'DEPLOY_FUNCTION_NAME=jieyou-v19-staging',
  'DEPLOY_SERVICE_PATH=jieyou-v19-staging',
  'DEPLOY_HOSTING_PATH=v19-staging',
  'DEPLOY_PAGES_BASE=/v19-staging/',
  'DEPLOY_ENABLE_FEISHU=true',
  'DEPLOY_ENABLE_LEARNING=false',
  'DEPLOY_ENABLE_GROWTH=false',
  'DEPLOY_GROWTH_NAMESPACE=staging',
  'DEPLOY_GROWTH_TABLE_PREFIX=stg_jieyou_v19_growth_',
  'DEPLOY_APPOINTMENT_SOURCE_ENVIRONMENT=staging',
  'DEPLOY_APPOINTMENT_INCLUDE_METADATA=true',
];

const requiredGuards = [
  "const isStaging = deploymentEnvironment === 'staging'",
  "functionName !== 'jieyou-v19-staging'",
  "servicePath !== 'jieyou-v19-staging'",
  "serviceUrl.includes('/jieyou-http-api')",
  "hostingPath !== 'v19-staging'",
  "value('DEPLOY_ENABLE_LEARNING') !== 'false'",
  "value('DEPLOY_ENABLE_GROWTH') !== 'false'",
  "runtimeValue('FEISHU_APP_TOKEN') === requiredDeployValue('PRODUCTION_FEISHU_APP_TOKEN')",
  "VITE_INCLUDE_CNAME: isStaging ? 'false' : 'true'",
];

const missingExample = requiredExampleLines.filter((line) => !example.includes(line));
const missingGuards = requiredGuards.filter((line) => !deployScript.includes(line));
if (missingExample.length || missingGuards.length) {
  throw new Error(JSON.stringify({ missingExample, missingGuards }, null, 2));
}

console.log(JSON.stringify({
  ok: true,
  deploymentEnvironmentExplicit: true,
  targetFunction: 'jieyou-v19-staging',
  hostingPath: 'v19-staging',
  learningEnabled: false,
  growthEnabled: false,
  productionFunctionRejected: true,
  productionFeishuRejected: true,
  stagingCnameDisabled: true,
}, null, 2));
