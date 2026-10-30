import { copyFile, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const functionDir = path.join(root, 'cloudbase/functions/api');

function parseEnv(text) {
  const values = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const equals = line.indexOf('=');
    if (equals < 1) continue;
    const key = line.slice(0, equals).trim();
    const rawValue = line.slice(equals + 1).trim();
    values[key] = rawValue.replace(/^("|')(.*)\1$/, '$2');
  }
  return values;
}

function run(command, args, cwd, environment = process.env) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: 'inherit', env: environment });
    child.on('error', reject);
    child.on('exit', (code) => code === 0 ? resolve() : reject(new Error(`${command} exited with code ${code}`)));
  });
}

function runCapture(command, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env: process.env });
    let output = '';
    child.stdout.on('data', (chunk) => { output += chunk; });
    child.stderr.on('data', (chunk) => { output += chunk; });
    child.on('error', reject);
    child.on('exit', (code) => code === 0 ? resolve(output) : reject(new Error(`${command} exited with code ${code}: ${output.slice(-4000)}`)));
  });
}

const envPath = path.join(root, '.env.local');
const values = parseEnv(await readFile(envPath, 'utf8'));
function value(key, fallback = '') {
  return process.env[key] || values[key] || fallback;
}

const deploymentEnvironment = value('DEPLOY_ENVIRONMENT');
if (!['staging', 'production'].includes(deploymentEnvironment)) {
  throw new Error('必须显式设置 DEPLOY_ENVIRONMENT=staging 或 DEPLOY_ENVIRONMENT=production');
}
const isStaging = deploymentEnvironment === 'staging';
const requiredDeployValue = (key) => {
  const result = value(key);
  if (!result) throw new Error(`${deploymentEnvironment} 部署缺少显式配置：${key}`);
  return result;
};
const sourceKey = (key) => isStaging ? `STAGING_${key}` : key;
const runtimeValue = (key, fallback = '') => value(sourceKey(key), fallback);

const envId = isStaging
  ? requiredDeployValue('DEPLOY_ENV_ID')
  : value('DEPLOY_ENV_ID', value('CLOUDBASE_ENV_ID', 'root-journey-prod-d4d7pzd0a8f805'));
const functionName = isStaging ? requiredDeployValue('DEPLOY_FUNCTION_NAME') : value('DEPLOY_FUNCTION_NAME', 'jieyou-http-api');
const servicePath = isStaging ? requiredDeployValue('DEPLOY_SERVICE_PATH') : value('DEPLOY_SERVICE_PATH', functionName);
const serviceDomain = isStaging
  ? requiredDeployValue('DEPLOY_API_DOMAIN')
  : value('DEPLOY_API_DOMAIN', `${envId}-1304965105.ap-shanghai.app.tcloudbase.com`);
const serviceUrl = isStaging
  ? requiredDeployValue('DEPLOY_API_BASE_URL')
  : value('DEPLOY_API_BASE_URL', `https://${serviceDomain}/${servicePath}`);
const hostingPath = isStaging ? requiredDeployValue('DEPLOY_HOSTING_PATH') : value('DEPLOY_HOSTING_PATH');
const feishuEnabledValue = isStaging ? requiredDeployValue('DEPLOY_ENABLE_FEISHU') : value('DEPLOY_ENABLE_FEISHU', 'true');
const feishuEnabled = feishuEnabledValue !== 'false';
const requiredKeys = [
  'DEEPSEEK_API_KEY',
  'DEEPSEEK_MODEL',
  'DEEPSEEK_BASE_URL',
  'FEISHU_BASE_URL',
  'DEV_TOKEN',
  'CLOUDBASE_APIKEY',
];
if (feishuEnabled) requiredKeys.splice(3, 0, 'FEISHU_APP_ID', 'FEISHU_APP_SECRET', 'FEISHU_APP_TOKEN', 'FEISHU_TABLE_ID');
const missing = requiredKeys.filter((key) => !runtimeValue(key));
if (missing.length) throw new Error(`${deploymentEnvironment} 配置缺少必要变量：${missing.map(sourceKey).join(', ')}`);

const envVariables = Object.fromEntries(requiredKeys.map((key) => [key, runtimeValue(key)]));
envVariables.CLOUDBASE_ENV_ID = envId;
const learningEnabledValue = value('DEPLOY_ENABLE_LEARNING', isStaging ? '' : 'true');
const growthEnabledValue = value('DEPLOY_ENABLE_GROWTH', isStaging ? '' : 'true');
envVariables.LEARNING_ENABLED = learningEnabledValue === 'false' ? 'false' : 'true';
envVariables.GROWTH_ENABLED = growthEnabledValue === 'false' ? 'false' : 'true';
if (value('DEPLOY_GROWTH_TABLE_PREFIX')) envVariables.GROWTH_TABLE_PREFIX = value('DEPLOY_GROWTH_TABLE_PREFIX');
if (value('DEPLOY_APPOINTMENT_INCLUDE_METADATA')) envVariables.APPOINTMENT_INCLUDE_METADATA = value('DEPLOY_APPOINTMENT_INCLUDE_METADATA');
if (value('DEPLOY_APPOINTMENT_SOURCE_ENVIRONMENT')) envVariables.APPOINTMENT_SOURCE_ENVIRONMENT = value('DEPLOY_APPOINTMENT_SOURCE_ENVIRONMENT');
if (value('PROMPT_VERSION')) envVariables.PROMPT_VERSION = value('PROMPT_VERSION');

function tokenAudience(token) {
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
    return payload.aud || payload.project_id || '';
  } catch {
    return '';
  }
}

const audience = tokenAudience(envVariables.CLOUDBASE_APIKEY);
if (audience && audience !== envId) throw new Error(`CLOUDBASE_APIKEY 不属于目标环境 ${envId}`);

if (isStaging) {
  if (feishuEnabledValue !== 'true') throw new Error('staging 必须显式设置 DEPLOY_ENABLE_FEISHU=true');
  if (functionName !== 'jieyou-v19-staging' || servicePath !== 'jieyou-v19-staging') throw new Error('staging 必须使用 jieyou-v19-staging 函数和 service path');
  if (serviceUrl !== `https://${serviceDomain}/${servicePath}` || serviceUrl.includes('/jieyou-http-api')) throw new Error('staging API URL 必须精确绑定 staging service path');
  if (hostingPath !== 'v19-staging') throw new Error('staging 必须使用 DEPLOY_HOSTING_PATH=v19-staging');
  if (value('DEPLOY_PAGES_BASE') !== '/v19-staging/') throw new Error('staging 必须使用 DEPLOY_PAGES_BASE=/v19-staging/');
  if (value('DEPLOY_ENABLE_LEARNING') !== 'false') throw new Error('staging 必须显式设置 DEPLOY_ENABLE_LEARNING=false');
  if (value('DEPLOY_ENABLE_GROWTH') !== 'false') throw new Error('staging 必须显式设置 DEPLOY_ENABLE_GROWTH=false');
  if (value('DEPLOY_GROWTH_NAMESPACE') !== 'staging') throw new Error('staging 必须显式设置 DEPLOY_GROWTH_NAMESPACE=staging');
  if (value('DEPLOY_GROWTH_TABLE_PREFIX') !== 'stg_jieyou_v19_growth_') throw new Error('staging 必须显式设置 DEPLOY_GROWTH_TABLE_PREFIX=stg_jieyou_v19_growth_');
  if (value('DEPLOY_APPOINTMENT_SOURCE_ENVIRONMENT') !== 'staging') throw new Error('staging 必须显式设置 DEPLOY_APPOINTMENT_SOURCE_ENVIRONMENT=staging');
  if (value('DEPLOY_APPOINTMENT_INCLUDE_METADATA') !== 'true') throw new Error('staging 必须显式设置 DEPLOY_APPOINTMENT_INCLUDE_METADATA=true');
  if (runtimeValue('FEISHU_APP_TOKEN') === requiredDeployValue('PRODUCTION_FEISHU_APP_TOKEN')) throw new Error('staging 飞书 Base 不得与 production 相同');
}

console.log(JSON.stringify({
  deploymentEnvironment,
  envId,
  functionName,
  servicePath,
  serviceDomain,
  serviceUrl,
  hostingPath: hostingPath || '/',
  feishuEnabled,
  feishuCredentialsConfigured: Boolean(runtimeValue('FEISHU_APP_ID') && runtimeValue('FEISHU_APP_SECRET') && runtimeValue('FEISHU_APP_TOKEN') && runtimeValue('FEISHU_TABLE_ID')),
  learningEnabled: envVariables.LEARNING_ENABLED === 'true',
  growthEnabled: envVariables.GROWTH_ENABLED === 'true',
  growthNamespace: value('DEPLOY_GROWTH_NAMESPACE', isStaging ? 'staging' : 'prod'),
  growthTablePrefix: value('DEPLOY_GROWTH_TABLE_PREFIX', '(default)'),
}, null, 2));

const tempDir = await mkdtemp(path.join(os.tmpdir(), 'jieyou-cloudbase-'));
try {
  await writeFile(path.join(tempDir, 'cloudbaserc.json'), JSON.stringify({
    envId,
    functionRoot: functionDir,
    functions: [{
      name: functionName,
      type: 'HTTP',
      handler: 'index.main',
      runtime: 'Nodejs20.19',
      timeout: 60,
      memorySize: 256,
      envVariables,
    }],
  }, null, 2));

  const tcb = process.env.TCB_BIN || 'tcb';
  const functionsOutput = await runCapture(tcb, ['fn', 'list', '--env-id', envId, '--json'], root);
  const functionsJsonStart = functionsOutput.indexOf('{');
  const functions = functionsJsonStart >= 0 ? JSON.parse(functionsOutput.slice(functionsJsonStart)) : { data: [] };
  const hasExistingTarget = (functions.data || []).some((item) => item.name === functionName);
  // The HTTP access service is managed separately because this environment's
  // old /api service belongs to an earlier failed Event-function deployment.
  const functionArgs = ['fn', 'deploy', functionName, '--dir', functionDir, '--httpFn', '--runtime', 'Nodejs20.19', '--install-dependency', 'false', '--yes'];
  if (hasExistingTarget) functionArgs.push('--force');
  functionArgs.push('--json');
  const deployOutput = await runCapture(tcb, functionArgs, tempDir);
  process.stdout.write(deployOutput);
  const servicesOutput = await runCapture(tcb, ['service', 'list', '--env-id', envId, '--json'], root);
  const servicesJsonStart = servicesOutput.indexOf('{');
  const services = servicesJsonStart >= 0 ? JSON.parse(servicesOutput.slice(servicesJsonStart)) : { data: [] };
  const hasService = (services.data || []).some((item) => item.path === `/${servicePath}` && item.name === functionName);
  if (!hasService) {
    await run(tcb, ['service', 'create', '--env-id', envId, '--service-path', servicePath, '--function', functionName, '--json'], root);
  }
  const apiBase = serviceUrl;
  await run('npm', ['run', 'build:pages'], root, {
    ...process.env,
    VITE_API_BASE_URL: apiBase,
    VITE_PAGES_BASE: value('DEPLOY_PAGES_BASE', '/'),
    VITE_GROWTH_NAMESPACE: value('DEPLOY_GROWTH_NAMESPACE', 'prod'),
    VITE_ENABLE_GROWTH: growthEnabledValue === 'false' ? 'false' : 'true',
    VITE_INCLUDE_CNAME: isStaging ? 'false' : 'true',
  });
  // CloudBase static hosting needs a fallback document for direct SPA routes.
  // Keep this as a generated artifact; never commit it as a second app entry.
  await copyFile(path.join(root, 'dist/index.html'), path.join(root, 'dist/404.html'));
  const hostingArgs = ['hosting', 'deploy', path.join(root, 'dist')];
  if (hostingPath) hostingArgs.push(hostingPath);
  hostingArgs.push('--env-id', envId, '--verify', '--safe', '--json');
  await run(tcb, hostingArgs, root);
  console.log(`CloudBase API base: ${apiBase}`);
} finally {
  await rm(tempDir, { recursive: true, force: true });
}
