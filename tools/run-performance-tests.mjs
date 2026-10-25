import { performance } from 'node:perf_hooks';
import {
  outputDirectory,
  parseArgs,
  printResult,
  stableRunId,
  writeJson,
} from './command-utils.mjs';

const args = parseArgs(process.argv.slice(2));
const profile = String(args.profile ?? 'release');
const output = outputDirectory(args);
const run_id = stableRunId(args, 'performance');

export async function runLivePerformanceProbe({
  base_url = process.env.WORKCTX_URL ?? `http://127.0.0.1:${process.env.WORKCTX_PORT ?? '3000'}`,
  requests = 50,
  concurrency = 8,
  trace_id = `trace-${run_id}`,
} = {}) {
  const totalRequests = positiveInteger(requests, 'requests');
  const workerCount = Math.min(positiveInteger(concurrency, 'concurrency'), totalRequests);
  const url = String(base_url).replace(/\/$/, '');
  const scopeHeaders = {
    'content-type': 'application/json',
    'x-tenant-id': '01HF7YAT000000000000000001',
    'x-workspace-id': '01HF7YAT000000000000000002',
    'x-project-id': '01HF7YAT000000000000000003',
    'x-actor-id': 'live-performance-actor',
    'x-client-id': 'live-performance-client',
    'x-capability': 'context.read context.write',
    'x-trace-id': trace_id,
  };
  const source_refs = [{ type: 'live-probe', id: 'runtime-http-performance' }];
  const start = await requestJson(`${url}/health/ready`, {
    method: 'GET',
    headers: { 'x-trace-id': trace_id },
  });
  if (!start.ok || start.status !== 200) {
    return {
      status: 'blocked',
      mode: 'live',
      measured: false,
      trace_id,
      source_refs,
      error: `Runtime readiness failed with HTTP ${start.status ?? 'unreachable'}`,
      external_gates: ['deployed services'],
    };
  }

  const index = await requestJson(`${url}/v1/context/index`, {
    method: 'POST',
    headers: { ...scopeHeaders, 'idempotency-key': `live-performance-index-${run_id}` },
    body: JSON.stringify({
      id: `live-performance-${run_id}`,
      title: 'Live performance fixture',
      snippet: 'Runtime performance probe context',
      revision: 1,
      score: 1,
      source_refs,
    }),
  });
  if (!index.ok || index.status !== 200) {
    return {
      status: 'blocked',
      mode: 'live',
      measured: false,
      trace_id,
      source_refs,
      error: `Runtime index failed with HTTP ${index.status ?? 'unreachable'}`,
      external_gates: ['runtime HTTP index'],
    };
  }

  const durations = [];
  const errors = [];
  let next = 0;
  async function worker() {
    while (true) {
      const current = next;
      next += 1;
      if (current >= totalRequests) return;
      const measured = await requestJson(`${url}/v1/context/search`, {
        method: 'POST',
        headers: { ...scopeHeaders, 'x-trace-id': `${trace_id}-${current}` },
        body: JSON.stringify({ query: 'performance fixture', budget: 100 }),
      });
      if (measured.ok && measured.status === 200) durations.push(measured.duration_ms);
      else errors.push({ request: current, status: measured.status, error: measured.error });
    }
  }
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  const measurements = summarize(durations, errors, totalRequests);
  const passed = errors.length === 0 && measurements.search_p95_ms <= 1000;
  return {
    status: passed ? 'passed' : 'failed',
    mode: 'live',
    profile,
    measured: true,
    trace_id,
    source_refs,
    thresholds: { search_p95_ms: 1000 },
    measurements,
    external_gates: ['database/NATS end-to-end metrics', 'production load profile'],
  };
}

async function requestJson(url, options) {
  const started = performance.now();
  try {
    const response = await fetch(url, options);
    const text = await response.text();
    let body;
    try {
      body = JSON.parse(text);
    } catch {
      body = undefined;
    }
    return {
      ok: response.ok,
      status: response.status,
      body,
      duration_ms: Number((performance.now() - started).toFixed(3)),
    };
  } catch (error) {
    return {
      ok: false,
      status: undefined,
      error: error instanceof Error ? error.message : String(error),
      duration_ms: Number((performance.now() - started).toFixed(3)),
    };
  }
}

function summarize(durations, errors, requested) {
  const sorted = [...durations].sort((left, right) => left - right);
  const percentile = (ratio) => {
    if (sorted.length === 0) return null;
    const index = Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1);
    return sorted[index];
  };
  return {
    requested_requests: requested,
    completed_requests: durations.length,
    failed_requests: errors.length,
    errors,
    search_min_ms: sorted[0] ?? null,
    search_p50_ms: percentile(0.5),
    search_p95_ms: percentile(0.95),
    search_p99_ms: percentile(0.99),
    search_max_ms: sorted.at(-1) ?? null,
  };
}

function positiveInteger(value, field) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0)
    throw new Error(`${field} must be a positive integer`);
  return parsed;
}

if (
  process.argv[1] &&
  new URL(import.meta.url).pathname.endsWith(process.argv[1].replaceAll('\\', '/'))
) {
  if (args.live === true) {
    const result = await runLivePerformanceProbe({
      base_url: args.base_url,
      requests: args.requests,
      concurrency: args.concurrency,
      trace_id: `trace-${run_id}`,
    });
    writeJson(output, `${run_id}-performance.json`, result);
    printResult(result);
    if (result.status !== 'passed') process.exitCode = result.status === 'failed' ? 1 : 2;
  } else {
    const result = {
      status: 'simulated',
      mode: 'offline-fixture',
      profile,
      run_id,
      trace_id: `trace-${run_id}`,
      source_refs: [{ type: 'performance-profile', id: profile }],
      thresholds: { resume_p95_ms: 5000, projection_p95_ms: 3000, ack_p95_ms: 1000 },
      measured: null,
      reason:
        'No live service or load generator was supplied; this report validates command and evidence shape only.',
      external_gates: ['deployed services', 'load generator', 'database/NATS metrics'],
    };
    writeJson(output, `${run_id}-performance.json`, result);
    printResult(result);
  }
}
