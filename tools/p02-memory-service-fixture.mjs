// Remote acceptance controller. All memory effects and recovery go through the actual Rust server.
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';

if (
  process.env.FACTORY_VALIDATION_ENVIRONMENT !== 'remote-k3s-contract-fixture' ||
  !['192.168.1.231', '192.168.1.232', '192.168.1.233'].includes(
    process.env.FACTORY_VALIDATION_NODE_IP,
  )
)
  throw new Error('Remote k3s acceptance only');
const rootToken = process.env.P02_FIXTURE_SIGNING_KEY;
if (!rootToken) throw new Error('Missing fixture credential');
const proxyToken = createHash('sha256').update(`p02-memory-proxy:${rootToken}`).digest('hex');
await mkdir('/memory', { recursive: true });
await writeFile(
  '/memory/config.toml',
  `embedding_provider = "none"\n[auth]\nbearer_token = ${JSON.stringify(rootToken)}\nactor_proxy_bearer_token = ${JSON.stringify(proxyToken)}\n`,
);
const calls = [],
  processes = [],
  logs = [];
let child, loseKey;
async function start() {
  const entries = [];
  logs.push(entries);
  child = spawn(
    'ai-memory',
    [
      '--data-dir',
      '/memory',
      '--config',
      '/memory/config.toml',
      'serve',
      '--transport',
      'http',
      '--bind',
      '127.0.0.1:6085',
      '--workspace',
      'p02-w',
      '--project',
      'p02-p',
      '--enable-api',
      '--no-watcher',
    ],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  );
  processes.push({ pid: child.pid, startedAt: new Date().toISOString() });
  child.stdout.on('data', (bytes) => entries.push(bytes.toString()));
  child.stderr.on('data', (bytes) => entries.push(bytes.toString()));
  for (let i = 0; i < 150; i++) {
    if (child.exitCode !== null) throw new Error(`ai-memory exited: ${entries.join('')}`);
    try {
      const response = await fetch('http://127.0.0.1:6085/api/v1/projects', {
        headers: { authorization: `Bearer ${rootToken}` },
      });
      if (response.ok) return;
    } catch {}
    await delay(100);
  }
  throw new Error('ai-memory startup timed out');
}
async function stop() {
  if (child?.exitCode === null) {
    const exited = new Promise((resolve) => child.once('exit', resolve));
    child.kill('SIGTERM');
    await exited;
  }
}
function rpcResult(text) {
  try {
    const frame =
      text
        .split(/\r?\n/)
        .filter((line) => line.startsWith('data:'))
        .at(-1)
        ?.slice(5)
        .trim() ?? text;
    const rpc = JSON.parse(frame),
      content = rpc.result?.content?.find((item) => item.type === 'text')?.text;
    return content ? JSON.parse(content) : rpc;
  } catch {
    return { undecoded: true };
  }
}
const proxy = createServer(async (request, response) => {
  try {
    let body = '';
    for await (const bytes of request) body += bytes;
    const rpc = body ? JSON.parse(body) : null;
    const name = rpc?.method === 'tools/call' ? rpc.params?.name : undefined;
    const stamp = rpc?.params?.arguments?.operation;
    const headers = { ...request.headers };
    delete headers.host;
    delete headers.connection;
    delete headers['content-length'];
    const upstream = await fetch(`http://127.0.0.1:6085${request.url}`, {
      method: request.method,
      headers,
      ...(body ? { body } : {}),
    });
    const text = await upstream.text();
    if (rpc && !name)
      console.error(
        JSON.stringify({ rpc: rpc.method, status: upstream.status, result: rpcResult(text) }),
      );
    if (name)
      calls.push({
        name,
        operationKey:
          stamp?.operation_key ?? rpc.params?.arguments?.arguments?.operation?.operation_key,
        attempt: stamp?.attempt,
        trace: request.headers['x-trace-id'],
        status: upstream.status,
        result: rpcResult(text),
      });
    if (
      stamp?.operation_key === loseKey &&
      ['memory_write_page', 'memory_handoff_begin', 'memory_handoff_accept'].includes(name)
    ) {
      response.destroy();
      return;
    }
    const outputHeaders = {};
    for (const name of ['content-type', 'mcp-session-id'])
      if (upstream.headers.has(name)) outputHeaders[name] = upstream.headers.get(name);
    response.writeHead(upstream.status, outputHeaders);
    response.end(text);
  } catch (error) {
    response.writeHead(503, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ error: String(error) }));
  }
});
const control = createServer(async (request, response) => {
  try {
    let body = '';
    for await (const bytes of request) body += bytes;
    const input = body ? JSON.parse(body) : {};
    let result;
    if (request.method === 'GET' && request.url === '/health') result = { ready: true };
    else if (request.method === 'GET' && request.url === '/stats') result = { calls, processes };
    else if (request.method === 'POST' && request.url === '/fault') {
      if (!['lose-reply', 'none'].includes(input.mode)) throw new Error('Unsupported memory fault');
      loseKey = input.mode === 'lose-reply' ? input.key : undefined;
      result = { configured: true };
    } else if (request.method === 'POST' && request.url === '/restart') {
      await stop();
      await start();
      result = { restarted: true, processes };
    } else if (request.method === 'POST' && request.url === '/export') {
      for (let i = 0; i < logs.length; i++)
        await writeFile(`/data/memory-host-${i}.log`, logs[i].join(''));
      await writeFile(
        '/data/memory-observations.json',
        JSON.stringify({ calls, processes }, null, 2),
      );
      result = { exported: true, processes };
    }
    response.writeHead(result ? 200 : 404, { 'content-type': 'application/json' });
    response.end(JSON.stringify(result ?? {}));
  } catch (error) {
    response.writeHead(500, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ error: String(error) }));
  }
});
await start();
proxy.listen(6086, '127.0.0.1');
control.listen(6087, '127.0.0.1');
process.on('SIGTERM', async () => {
  await stop();
  proxy.close();
  control.close();
});
