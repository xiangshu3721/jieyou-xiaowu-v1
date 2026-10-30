import { access, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');
const apiUrl = process.env.STAGING_API_URL || 'https://root-journey-prod-d4d7pzd0a8f805-1304965105.ap-shanghai.app.tcloudbase.com/jieyou-v19-staging';

async function required(file) {
  await access(path.join(dist, file));
}

await Promise.all([
  required('index.html'),
  required('404.html'),
  access(path.join(root, 'cloudbase/functions/api/index.js')),
]);

const files = await readdir(dist, { recursive: true });
const text = (await Promise.all(files.filter((file) => /\.(html|js|css)$/.test(file)).map((file) => readFile(path.join(dist, file), 'utf8')))).join('\n');
const forbidden = [
  'CNAME',
  'jieyou-http-api',
  'FEISHU_APP_TOKEN',
  'FEISHU_APP_SECRET',
  'DEEPSEEK_API_KEY',
  'CLOUDBASE_APIKEY',
  '看看最近的我',
];
const violations = forbidden.filter((value) => text.includes(value));
if (!text.includes(apiUrl)) violations.push('missing-staging-api-url');
if (violations.length) throw new Error(`Staging 构建产物检查失败：${violations.join(', ')}`);

console.log(JSON.stringify({
  ok: true,
  filesChecked: files.length,
  stagingApiPresent: true,
  productionApiAbsent: true,
  cnameAbsent: true,
  secretNamesAbsent: true,
  growthEntryAbsent: true,
  cloudbaseBundlePresent: true,
}, null, 2));
