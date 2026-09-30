import http from 'node:http';
import { handleApi, type WorkerEnv } from '../../worker/handler.ts';

const maxBodyBytes = 1_500_000;

function readBody(request: http.IncomingMessage) {
  return new Promise<Buffer>((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer | string) => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += buffer.length;
      if (size > maxBodyBytes) {
        reject(new Error('请求体过大'));
        request.destroy();
        return;
      }
      chunks.push(buffer);
    });
    request.on('end', () => resolve(Buffer.concat(chunks)));
    request.on('error', reject);
  });
}

function requestFromIncoming(request: http.IncomingMessage, body: Buffer) {
  const url = new URL(request.url || '/', 'http://127.0.0.1:9000');
  if (!url.pathname.startsWith('/api/')) url.pathname = `/api${url.pathname === '/' ? '' : url.pathname}`;
  const headers = new Headers();
  for (const [key, value] of Object.entries(request.headers)) {
    if (typeof value === 'string') headers.set(key, value);
    else if (Array.isArray(value)) headers.set(key, value.join(','));
  }
  const method = (request.method || 'GET').toUpperCase();
  return new Request(url, { method, headers, body: method === 'GET' || method === 'HEAD' ? undefined : body.toString() });
}

const server = http.createServer(async (incoming, outgoing) => {
  try {
    const body = await readBody(incoming);
    const response = await handleApi(requestFromIncoming(incoming, body), process.env as WorkerEnv);
    outgoing.writeHead(response.status, Object.fromEntries(response.headers.entries()));
    // Node's HTTP server rejects a body on 204 responses. OPTIONS is used for
    // browser CORS preflight and intentionally returns 204 from handleApi.
    outgoing.end(response.status === 204 || response.status === 304 ? undefined : await response.text());
  } catch (error) {
    outgoing.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    outgoing.end(JSON.stringify({ error: error instanceof Error ? error.message : '服务器错误' }));
  }
});

server.listen(Number(process.env.PORT || 9000), '0.0.0.0');
