import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function loadEnvFile(filePath: string) {
  if (!fs.existsSync(filePath)) return;
  const text = fs.readFileSync(filePath, 'utf8');
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const equals = line.indexOf('=');
    if (equals < 1) continue;
    const key = line.slice(0, equals).trim();
    const value = line.slice(equals + 1).trim().replace(/^(['"])(.*)\1$/, '$2');
    if (!process.env[key]) process.env[key] = value;
  }
}

loadEnvFile(path.join(rootDir, '.env'));
loadEnvFile(path.join(rootDir, '.env.local'));

const value = (key: string, fallback = '') => process.env[key] || fallback;

export const config = {
  rootDir,
  port: Number(value('PORT', '8787')),
  promptVersion: value('PROMPT_VERSION', 'v1.2.0'),
  deepseek: {
    apiKey: value('DEEPSEEK_API_KEY'),
    model: value('DEEPSEEK_MODEL', 'deepseek-chat'),
    baseUrl: value('DEEPSEEK_BASE_URL', 'https://api.deepseek.com').replace(/\/$/, ''),
  },
  feishu: {
    appId: value('FEISHU_APP_ID'),
    appSecret: value('FEISHU_APP_SECRET'),
    appToken: value('FEISHU_APP_TOKEN'),
    tableId: value('FEISHU_TABLE_ID'),
    baseUrl: value('FEISHU_BASE_URL', 'https://open.feishu.cn').replace(/\/$/, ''),
  },
  devToken: value('DEV_TOKEN'),
  appointmentStateFile: path.resolve(rootDir, value('APPOINTMENT_STATE_FILE', './data/appointment-state.json')),
};

export const configurationStatus = () => ({
  deepseekConfigured: Boolean(config.deepseek.apiKey),
  feishuConfigured: Boolean(config.feishu.appId && config.feishu.appSecret && config.feishu.appToken && config.feishu.tableId),
  devConfigured: Boolean(config.devToken),
});
