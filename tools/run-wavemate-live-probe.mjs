import { existsSync, readFileSync } from 'node:fs';
import { createServer, request as httpRequest } from 'node:http';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  outputDirectory,
  parseArgs,
  printResult,
  stableRunId,
  workspaceRoot,
  writeJson,
} from './command-utils.mjs';

const DEFAULT_ARTIFACT_PATH = 'E:/dsh/dshdesktopRelease/artifacts/wavemate-intranet/0.24.1';
const SCOPE = {
  'x-tenant-id': '01HF7YAT000000000000000001',
  'x-workspace-id': '01HF7YAT000000000000000002',
  'x-project-id': '01HF7YAT000000000000000003',
};

export function buildWavemateMcpInput({ url, actor_id = 'wavemate-0.24.1' } = {}) {
  return {
    id: 'planemem',
    serverName: 'planemem',
    transport: 'streamable-http',
    url,
    headers: {
      ...SCOPE,
      'x-actor-id': actor_id,
      'x-client-id': 'wavemate',
      'x-capability': 'context.read context.write',
    },
    disabled: false,
    scope: 'global',
  };
}

export function summarizeMcpTraffic(entries) {
  const requests = entries
    .filter((entry) => entry.phase === 'request')
    .map((entry) => parseJson(entry.body))
    .filter((body) => body !== undefined);
  const responses = entries.filter((entry) => entry.phase === 'response');
  const responseBodies = responses.map((entry) => parseJson(entry.body));
  return {
    requests: requests.length,
    server_discover: requests.filter((body) => body.method === 'server/discover').length,
    initialize: requests.filter((body) => body.method === 'initialize').length,
    initialized_notification: requests.filter((body) => body.method === 'notifications/initialized')
      .length,
    tools_list: requests.filter((body) => body.method === 'tools/list').length,
    tools_call: requests.filter((body) => body.method === 'tools/call').length,
    resources_list: requests.filter((body) => body.method === 'resources/list').length,
    resources_read: requests.filter((body) => body.method === 'resources/read').length,
    successful_responses: responses.filter((entry) => entry.status >= 200 && entry.status < 300)
      .length,
    failed_responses: responses.filter((entry) => entry.status < 200 || entry.status >= 300).length,
    jsonrpc_errors: responseBodies.filter((body) => body?.error !== undefined).length,
  };
}

export async function runLiveWavemateProbe({
  artifact_path = process.env.WAVEMATE_ARTIFACT_PATH ?? DEFAULT_ARTIFACT_PATH,
  wavemate_url = process.env.WAVEMATE_URL ?? 'http://127.0.0.1:3080',
  planemem_url = process.env.WORKCTX_URL ??
    `http://127.0.0.1:${process.env.WORKCTX_PORT ?? '3000'}`,
  trace_id = 'trace-wavemate-live',
  wait_ms = 8000,
} = {}) {
  const artifact = path.resolve(String(artifact_path));
  const executable = path.join(artifact, 'offline-package', 'WaveMate.exe');
  const manifestPath = path.join(artifact, 'release-manifest.json');
  const sourceManifestPath = path.join(
    artifact,
    'source',
    'src-tauri',
    'resources',
    'dshdesktop-release.json',
  );
  const source_refs = [
    { type: 'client-artifact', id: artifact },
    { type: 'runtime-http', id: `${planemem_url}/mcp` },
  ];
  if (!existsSync(executable) || !existsSync(manifestPath)) {
    return {
      status: 'blocked',
      mode: 'live',
      client: 'wavemate',
      client_version: '0.24.1',
      trace_id,
      source_refs,
      error: `WaveMate artifact is incomplete: ${artifact}`,
      external_gates: ['WaveMate 0.24.1 offline artifact'],
    };
  }

  const manifest = readJsonFile(manifestPath);
  const sourceManifest = readJsonFile(sourceManifestPath);
  const health = await requestJson(`${trimSlash(wavemate_url)}/api/tauri/extension/mcp`);
  let spawned = undefined;
  if (!health.ok) {
    spawned = spawn(executable, [], {
      cwd: path.dirname(executable),
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    });
    spawned.unref();
    await waitFor(
      async () => (await requestJson(`${trimSlash(wavemate_url)}/api/tauri/extension/mcp`)).ok,
      wait_ms,
    );
  }
  const available = await requestJson(`${trimSlash(wavemate_url)}/api/tauri/extension/mcp`);
  if (!available.ok) {
    return {
      status: 'blocked',
      mode: 'live',
      client: 'wavemate',
      client_version: manifest?.version ?? sourceManifest?.product?.version ?? '0.24.1',
      trace_id,
      source_refs,
      error: `WaveMate host API unavailable at ${wavemate_url}`,
      external_gates: ['WaveMate desktop process'],
    };
  }

  const proxy = await createForwardProxy(planemem_url, trace_id);
  const proxyUrl = `http://127.0.0.1:${proxy.port}/mcp`;
  const saveUrl = `${trimSlash(wavemate_url)}/api/tauri/extension/mcp`;
  const directUrl = `${trimSlash(planemem_url)}/mcp`;
  let save;
  try {
    save = await requestJson(saveUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(buildWavemateMcpInput({ url: proxyUrl })),
    });
    if (!save.ok) {
      return {
        status: 'blocked',
        mode: 'live',
        client: 'wavemate',
        client_version: manifest?.version ?? sourceManifest?.product?.version ?? '0.24.1',
        trace_id,
        source_refs,
        error: `WaveMate MCP configuration failed with HTTP ${save.status}`,
        external_gates: ['WaveMate MCP configuration API'],
      };
    }
    await waitFor(() => {
      const traffic = summarizeMcpTraffic(proxy.entries);
      return (
        traffic.server_discover > 0 &&
        traffic.initialize > 0 &&
        traffic.initialized_notification > 0
      );
    }, wait_ms);
    const traffic = summarizeMcpTraffic(proxy.entries);
    const handshakePassed =
      traffic.server_discover > 0 &&
      traffic.initialize > 0 &&
      traffic.initialized_notification > 0 &&
      traffic.jsonrpc_errors === 0;
    return {
      status: handshakePassed ? 'passed' : 'blocked',
      mode: 'live',
      client: 'wavemate',
      client_version: manifest?.version ?? sourceManifest?.product?.version ?? '0.24.1',
      trace_id,
      source_refs,
      artifact: {
        path: artifact,
        executable,
        manifest_version: manifest?.version,
        product_version: sourceManifest?.product?.version,
      },
      mcp_configuration: {
        server_name: 'planemem',
        transport: 'streamable-http',
        configured_url: directUrl,
        hot_reload: save.body?.restartNeeded === false,
      },
      traffic,
      captured_entries: proxy.entries,
      external_gates: handshakePassed
        ? traffic.tools_call > 0
          ? []
          : ['WaveMate interactive prompt/tool call']
        : ['WaveMate MCP session startup'],
    };
  } finally {
    await requestJson(saveUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(buildWavemateMcpInput({ url: directUrl })),
    });
    await proxy.close();
    if (spawned?.pid !== undefined) {
      try {
        process.kill(spawned.pid);
      } catch {
        // The desktop may already have exited or handed the service to another process.
      }
    }
  }
}

async function createForwardProxy(targetUrl, trace_id) {
  const target = new URL(targetUrl);
  const entries = [];
  const server = createServer((request, response) => {
    const chunks = [];
    request.on('data', (chunk) => chunks.push(chunk));
    request.on('end', () => {
      const body = Buffer.concat(chunks).toString('utf8');
      entries.push({
        phase: 'request',
        trace_id,
        method: request.method,
        url: request.url,
        headers: request.headers,
        body,
      });
      const forward = httpRequest(
        {
          hostname: target.hostname,
          port: Number(target.port || 80),
          path: request.url,
          method: request.method,
          headers: { ...request.headers, host: target.host },
        },
        (upstream) => {
          const output = [];
          upstream.on('data', (chunk) => output.push(chunk));
          upstream.on('end', () => {
            const data = Buffer.concat(output);
            entries.push({
              phase: 'response',
              trace_id,
              status: upstream.statusCode ?? 502,
              body: data.toString('utf8'),
            });
            response.writeHead(upstream.statusCode ?? 502, upstream.headers);
            response.end(data);
          });
        },
      );
      forward.on('error', (error) => {
        entries.push({ phase: 'error', trace_id, error: String(error) });
        response.writeHead(502, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ error: 'proxy-failed' }));
      });
      forward.end(Buffer.concat(chunks));
    });
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  return {
    port: typeof address === 'object' && address !== null ? address.port : 0,
    entries,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

async function requestJson(url, options = {}) {
  try {
    const response = await fetch(url, options);
    const text = await response.text();
    return { ok: response.ok, status: response.status, body: parseJson(text), text };
  } catch (error) {
    return { ok: false, status: undefined, error: String(error) };
  }
}

async function waitFor(predicate, timeout) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await predicate()) return true;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  return false;
}

function readJsonFile(file) {
  if (!existsSync(file)) return undefined;
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return undefined;
  }
}

function parseJson(value) {
  try {
    return typeof value === 'string' ? JSON.parse(value) : value;
  } catch {
    return undefined;
  }
}

function trimSlash(value) {
  return String(value).replace(/\/$/, '');
}

const isMain =
  process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const args = parseArgs(process.argv.slice(2));
  const output = outputDirectory(args);
  const run_id = stableRunId(args, 'wavemate-live');
  const result =
    args.live === true
      ? await runLiveWavemateProbe({
          artifact_path: args.artifact_path,
          wavemate_url: args.wavemate_url,
          planemem_url: args.planemem_url,
          trace_id: `trace-${run_id}`,
        })
      : {
          status: 'blocked',
          mode: 'offline-fixture',
          run_id,
          external_gates: ['WaveMate live process and MCP session'],
        };
  writeJson(output, `${run_id}-wavemate.json`, result);
  printResult({ ...result, run_id, report: `${output}/${run_id}-wavemate.json` });
  process.exitCode = result.status === 'passed' ? 0 : 2;
}
