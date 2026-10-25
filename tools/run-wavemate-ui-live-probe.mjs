import { createServer, request as httpRequest } from 'node:http';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { spawn } from 'node:child_process';
import {
  outputDirectory,
  parseArgs,
  printResult,
  stableRunId,
  writeJson,
} from './command-utils.mjs';

const DEFAULT_ARTIFACT_PATH = 'E:/dsh/dshdesktopRelease/artifacts/wavemate-intranet/0.24.1';
const DEFAULT_WAVEMATE_URL = 'http://127.0.0.1:3080';
const DEFAULT_WEBDRIVER_URL = 'http://127.0.0.1:4445';
const DEFAULT_RESTORE_URL = 'http://127.0.0.1:3000/mcp';
const DEFAULT_PROMPT =
  '请使用已配置的 planemem MCP，调用 context_search 搜索当前项目上下文中“Live Plane Webhook Probe”，只报告搜索结果和 trace_id，不要修改任何数据。';
const SCOPE = {
  'x-tenant-id': '01HF7YAT000000000000000001',
  'x-workspace-id': '01HF7YAT000000000000000002',
  'x-project-id': '01HF7YAT000000000000000003',
};
const ELEMENT_KEY = 'element-6066-11e4-a52e-4f735466cecf';

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

export async function runLiveWavemateUiProbe({
  artifact_path = process.env.WAVEMATE_ARTIFACT_PATH ?? DEFAULT_ARTIFACT_PATH,
  wavemate_url = process.env.WAVEMATE_URL ?? DEFAULT_WAVEMATE_URL,
  planemem_url = process.env.WORKCTX_URL ??
    `http://127.0.0.1:${process.env.WORKCTX_PORT ?? '3000'}`,
  restore_url = process.env.WAVEMATE_RESTORE_URL ?? DEFAULT_RESTORE_URL,
  webdriver_url = process.env.WAVEMATE_WEBDRIVER_URL ?? DEFAULT_WEBDRIVER_URL,
  prompt = DEFAULT_PROMPT,
  trace_id = 'trace-wavemate-ui-live',
  wait_ms = 60_000,
  output = undefined,
} = {}) {
  const artifact = path.resolve(String(artifact_path));
  const executable = path.join(artifact, 'offline-package', 'WaveMate.exe');
  const source_refs = [
    { type: 'client-artifact', id: artifact },
    { type: 'runtime-http', id: `${planemem_url}/mcp` },
  ];
  if (!existsSync(executable)) {
    return blockedResult('WaveMate artifact is incomplete', source_refs, {
      external_gates: ['WaveMate 0.24.1 offline artifact'],
    });
  }

  const healthUrl = `${trimSlash(wavemate_url)}/api/tauri/extension/mcp`;
  const health = await requestJson(healthUrl);
  if (!health.ok) {
    return blockedResult(`WaveMate host API unavailable at ${wavemate_url}`, source_refs, {
      external_gates: ['WaveMate desktop process'],
    });
  }

  const webdriver = await requestJson(`${trimSlash(webdriver_url)}/status`);
  if (!webdriver.ok || webdriver.body?.value?.ready !== true) {
    return blockedResult(`WaveMate WebDriver unavailable at ${webdriver_url}`, source_refs, {
      external_gates: ['WaveMate 0.24.1 WebDriver session'],
    });
  }

  const proxy = await createForwardProxy(planemem_url, trace_id);
  const proxyUrl = `http://127.0.0.1:${proxy.port}/mcp`;
  const directUrl = `${trimSlash(planemem_url)}/mcp`;
  const restoreUrl = `${trimSlash(restore_url)}`;
  const saveUrl = healthUrl;
  let sessionId;
  let savedProxy = false;
  let probeResult;
  try {
    const save = await requestJson(saveUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(buildWavemateMcpInput({ url: proxyUrl })),
    });
    if (!save.ok) {
      return blockedResult(
        `WaveMate MCP configuration failed with HTTP ${save.status}`,
        source_refs,
        {
          external_gates: ['WaveMate MCP configuration API'],
        },
      );
    }
    savedProxy = true;

    const session = await webdriverRequest(webdriver_url, '/session', 'POST', { capabilities: {} });
    sessionId = session.body?.value?.sessionId;
    if (session.status !== 200 || !sessionId) {
      return blockedResult('WaveMate WebDriver session was not created', source_refs, {
        external_gates: ['WaveMate 0.24.1 WebDriver session'],
        webdriver_response: session.body,
      });
    }

    const iframe = await findElement(webdriver_url, sessionId, 'iframe');
    if (!iframe) throw new Error('WaveMate conversation iframe not found');
    await webdriverRequest(webdriver_url, `/session/${sessionId}/frame`, 'POST', {
      id: { [ELEMENT_KEY]: iframe },
    });

    const newSession = await findElement(webdriver_url, sessionId, 'button.hHd-Xa_newSession');
    if (newSession) {
      await webdriverRequest(
        webdriver_url,
        `/session/${sessionId}/element/${newSession}/click`,
        'POST',
      );
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    const editor = await findElement(webdriver_url, sessionId, '[contenteditable="true"]');
    const send = await findElement(webdriver_url, sessionId, 'button[aria-label="发送消息"]');
    if (!editor || !send) throw new Error('WaveMate composer controls not found');
    await webdriverRequest(webdriver_url, `/session/${sessionId}/element/${editor}/click`, 'POST');
    await webdriverRequest(webdriver_url, `/session/${sessionId}/element/${editor}/clear`, 'POST');
    await webdriverRequest(webdriver_url, `/session/${sessionId}/element/${editor}/value`, 'POST', {
      text: prompt,
    });
    const baselineUi = await readWaveMateUi(webdriver_url, sessionId);
    await webdriverRequest(webdriver_url, `/session/${sessionId}/element/${send}/click`, 'POST');

    const completed = await waitFor(async () => {
      const traffic = summarizeMcpTraffic(proxy.entries);
      return traffic.tools_call > 0;
    }, wait_ms);
    const uiCompleted = await waitFor(async () => {
      const current = await readWaveMateUi(webdriver_url, sessionId);
      return (
        current.text.includes('已完成') &&
        current.text.lastIndexOf('已完成') > baselineUi.text.lastIndexOf('已完成')
      );
    }, wait_ms);
    const ui = await readWaveMateUi(webdriver_url, sessionId);
    const traffic = summarizeMcpTraffic(proxy.entries);
    const matchedResult = ui.text.includes('Live Plane Webhook Probe');
    const matchedTrace = ui.text.includes('trace_id');
    const passed =
      completed &&
      traffic.tools_call > 0 &&
      traffic.jsonrpc_errors === 0 &&
      uiCompleted &&
      matchedResult &&
      matchedTrace;
    probeResult = {
      status: passed ? 'passed' : 'blocked',
      mode: 'live',
      client: 'wavemate',
      client_version: '0.24.1',
      trace_id,
      source_refs,
      artifact: { path: artifact, executable },
      mcp_configuration: {
        server_name: 'planemem',
        transport: 'streamable-http',
        configured_url: directUrl,
        restore_url: restoreUrl,
        proxy_url: proxyUrl,
      },
      webdriver: { url: webdriver_url, session_id: sessionId },
      traffic,
      captured_entries: proxy.entries,
      ui: {
        title: ui.title,
        text: ui.text,
        prompt_visible: ui.text.includes(prompt),
        completed_visible: uiCompleted,
        matched_result: matchedResult,
        matched_trace: matchedTrace,
        baseline_text_length: baselineUi.text.length,
      },
      external_gates: passed ? [] : ['WaveMate interactive prompt/tool call completion'],
    };
    return probeResult;
  } catch (error) {
    return blockedResult(String(error), source_refs, {
      external_gates: ['WaveMate interactive prompt/tool call'],
      captured_entries: proxy.entries,
    });
  } finally {
    if (sessionId) await webdriverRequest(webdriver_url, `/session/${sessionId}`, 'DELETE');
    if (savedProxy) {
      const restore = await requestJson(saveUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(buildWavemateMcpInput({ url: restoreUrl })),
      });
      const verification = {
        status: restore.ok ? 'passed' : 'failed',
        client: 'wavemate',
        client_version: '0.24.1',
        server_name: 'planemem',
        configured_url: restoreUrl,
        transport: 'streamable-http',
        scope: 'global',
        restart_needed: restore.body?.restartNeeded ?? null,
        response_status: restore.status ?? null,
        response: restore.body ?? null,
      };
      if (output) writeJson(output, 'restore-verification.json', verification);
      if (!restore.ok && probeResult) {
        probeResult.status = 'blocked';
        probeResult.external_gates = ['WaveMate MCP configuration restore'];
      }
    }
    await proxy.close();
    if (output) writeJson(output, 'traffic.json', proxy.entries);
  }
}

async function createForwardProxy(targetUrl, trace_id) {
  const target = new URL(targetUrl);
  const entries = [];
  const server = createServer((request, response) => {
    const chunks = [];
    request.on('data', (chunk) => chunks.push(chunk));
    request.on('end', () => {
      const data = Buffer.concat(chunks);
      entries.push({
        phase: 'request',
        trace_id,
        method: request.method,
        url: request.url,
        headers: request.headers,
        body: data.toString('utf8'),
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
            const body = Buffer.concat(output);
            entries.push({
              phase: 'response',
              trace_id,
              status: upstream.statusCode ?? 502,
              body: body.toString('utf8'),
            });
            response.writeHead(upstream.statusCode ?? 502, upstream.headers);
            response.end(body);
          });
        },
      );
      forward.on('error', (error) => {
        entries.push({ phase: 'error', trace_id, error: String(error) });
        response.writeHead(502, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ error: 'proxy-failed' }));
      });
      forward.end(data);
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

async function findElement(base, sessionId, selector) {
  const result = await webdriverRequest(base, `/session/${sessionId}/elements`, 'POST', {
    using: 'css selector',
    value: selector,
  });
  return result.body?.value?.[0]?.[ELEMENT_KEY];
}

async function readWaveMateUi(base, sessionId) {
  const title = await webdriverRequest(base, `/session/${sessionId}/title`);
  const text = await webdriverRequest(base, `/session/${sessionId}/execute/sync`, 'POST', {
    script: 'return document.body.innerText;',
    args: [],
  });
  return { title: title.body?.value ?? '', text: text.body?.value ?? '' };
}

async function webdriverRequest(base, route, method = 'GET', body) {
  return requestJson(`${trimSlash(base)}${route}`, {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
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
  const deadline = Date.now() + Number(timeout);
  while (Date.now() < deadline) {
    if (await predicate()) return true;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return false;
}

function blockedResult(error, source_refs, details = {}) {
  return {
    status: 'blocked',
    mode: 'live',
    client: 'wavemate',
    client_version: '0.24.1',
    error,
    source_refs,
    ...details,
  };
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
  const run_id = stableRunId(args, 'wavemate-ui-live');
  const result =
    args.live === true
      ? await runLiveWavemateUiProbe({
          artifact_path: args.artifact_path,
          wavemate_url: args.wavemate_url,
          planemem_url: args.planemem_url,
          restore_url: args.restore_url,
          webdriver_url: args.webdriver_url,
          prompt: args.prompt,
          trace_id: `trace-${run_id}`,
          wait_ms: Number(args.wait_ms ?? 60_000),
          output,
        })
      : blockedResult('WaveMate UI probe requires --live', [], {
          external_gates: ['WaveMate interactive prompt/tool call'],
        });
  writeJson(output, `${run_id}-wavemate-ui.json`, result);
  printResult({ ...result, run_id, report: `${output}/${run_id}-wavemate-ui.json` });
  process.exitCode = result.status === 'passed' ? 0 : 2;
}
