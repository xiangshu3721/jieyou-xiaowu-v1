import { copyFile, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const envId = 'littlemo-d2gy2ecx0dd102163';
const functionName = 'jieyou-http-api';
const servicePath = 'jieyou-http-api';
const serviceUrl = 'https://littlemo-d2gy2ecx0dd102163-1304965105.ap-shanghai.app.tcloudbase.com/jieyou-http-api';
const functionDir = path.join(root, 'cloudbase/functions/api');
const requiredKeys = [
  'DEEPSEEK_API_KEY',
  'DEEPSEEK_MODEL',
  'DEEPSEEK_BASE_URL',
  'FEISHU_APP_ID',
  'FEISHU_APP_SECRET',
  'FEISHU_APP_TOKEN',
  'FEISHU_TABLE_ID',
  'FEISHU_BASE_URL',
  'CLOUDBASE_APIKEY',
  'DEV_TOKEN',
];

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
const missing = requiredKeys.filter((key) => !values[key]);
if (missing.length) throw new Error(`.env.local 缺少 CloudBase 生产变量：${missing.join(', ')}`);

const envVariables = Object.fromEntries(requiredKeys.map((key) => [key, values[key]]));
envVariables.CLOUDBASE_ENV_ID = values.CLOUDBASE_ENV_ID || envId;
if (values.PROMPT_VERSION) envVariables.PROMPT_VERSION = values.PROMPT_VERSION;

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
  const servicesOutput = await runCapture(tcb, ['service', 'list', '--json'], root);
  const servicesJsonStart = servicesOutput.indexOf('{');
  const services = servicesJsonStart >= 0 ? JSON.parse(servicesOutput.slice(servicesJsonStart)) : { data: [] };
  const hasService = (services.data || []).some((item) => item.path === `/${servicePath}` && item.name === functionName);
  if (!hasService) {
    await run(tcb, ['service', 'create', '--service-path', servicePath, '--function', functionName, '--json'], root);
  }
  const apiBase = serviceUrl;
  await run('npm', ['exec', '--', 'vite', 'build'], root, { ...process.env, VITE_API_BASE_URL: apiBase });
  // CloudBase static hosting needs a fallback document for direct SPA routes.
  // Keep this as a generated artifact; never commit it as a second app entry.
  await copyFile(path.join(root, 'dist/index.html'), path.join(root, 'dist/404.html'));
  await run(tcb, ['hosting', 'deploy', path.join(root, 'dist'), '--env-id', envId, '--verify', '--safe', '--json'], root);
  console.log(`CloudBase API base: ${apiBase}`);
} finally {
  await rm(tempDir, { recursive: true, force: true });
}
