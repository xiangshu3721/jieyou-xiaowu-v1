import { access, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');
const apiUrl = process.env.PRODUCTION_API_URL || 'https://root-journey-prod-d4d7pzd0a8f805-1304965105.ap-shanghai.app.tcloudbase.com/jieyou-http-api';

async function required(file) {
  await access(path.join(dist, file));
}

await Promise.all([required('index.html'), required('404.html')]);
const files = await readdir(dist, { recursive: true });
const text = (await Promise.all(files.filter((file) => /\.(html|js|css)$/.test(file)).map((file) => readFile(path.join(dist, file), 'utf8')))).join('\n');
const violations = [];
if (!text.includes(apiUrl)) violations.push('missing-production-api-url');
if (text.includes('/jieyou-v19-staging')) violations.push('staging-api-present');
if (files.includes('CNAME')) violations.push('cname-present');
if (text.includes('www.littlemo.icu')) violations.push('legacy-custom-domain-present');
if (text.includes('看看最近的我')) violations.push('growth-entry-present');
for (const name of ['FEISHU_APP_TOKEN', 'FEISHU_APP_SECRET', 'DEEPSEEK_API_KEY', 'CLOUDBASE_APIKEY']) {
  if (text.includes(name)) violations.push(`secret-name-present:${name}`);
}
if (violations.length) throw new Error(`Production 构建产物检查失败：${violations.join(', ')}`);

console.log(JSON.stringify({
  ok: true,
  filesChecked: files.length,
  productionApiPresent: true,
  stagingApiAbsent: true,
  cnameAbsent: true,
  legacyCustomDomainAbsent: true,
  growthEntryAbsent: true,
  secretNamesAbsent: true,
}, null, 2));
