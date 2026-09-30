import { handleApi, type WorkerEnv } from '../../worker/handler.ts';

interface CloudBaseHttpEvent {
  httpMethod?: string;
  path?: string;
  body?: string | null;
  isBase64Encoded?: boolean;
  headers?: Record<string, string | string[] | undefined>;
  multiValueHeaders?: Record<string, string[] | undefined>;
  queryStringParameters?: Record<string, string | undefined>;
  requestContext?: {
    path?: string;
    http?: { method?: string; path?: string };
  };
}

function firstHeaderValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function toRequest(event: CloudBaseHttpEvent) {
  const method = (event.httpMethod || event.requestContext?.http?.method || 'GET').toUpperCase();
  const path = event.path || event.requestContext?.http?.path || event.requestContext?.path || '/';
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(event.queryStringParameters || {})) {
    if (value !== undefined) query.set(key, value);
  }
  const headers = new Headers();
  for (const [key, value] of Object.entries(event.headers || {})) {
    const normalized = firstHeaderValue(value);
    if (normalized !== undefined) headers.set(key, normalized);
  }
  for (const [key, values] of Object.entries(event.multiValueHeaders || {})) {
    if (values?.length && !headers.has(key)) headers.set(key, values.join(','));
  }
  const body = event.body && event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf8') : event.body || undefined;
  return new Request(`https://littlemo-cloudbase.local${path}${query.size ? `?${query}` : ''}`, { method, headers, body: method === 'GET' || method === 'HEAD' ? undefined : body });
}

export async function main(event: CloudBaseHttpEvent) {
  const request = toRequest(event || {});
  const response = await handleApi(request, process.env as WorkerEnv);
  const body = await response.text();
  const headers: Record<string, string> = {};
  response.headers.forEach((value, key) => { headers[key] = value; });
  return { statusCode: response.status, headers, body, isBase64Encoded: false };
}
