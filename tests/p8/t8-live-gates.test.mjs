import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  runLiveDependencyMatrix,
  runLiveResilienceProbe,
} from '../../tools/run-resilience-tests.mjs';
import { runLiveSecurityProbe } from '../../tools/run-security-tests.mjs';

function startFakeRuntime() {
  const server = createServer(async (request, response) => {
    let body = '';
    for await (const chunk of request) body += chunk;
    response.setHeader('content-type', 'application/json');
    if (request.url === '/health/ready') {
      response.writeHead(200);
      response.end(JSON.stringify({ ready: true }));
      return;
    }
    if (request.url === '/v1/context/index' || request.url === '/v1/context/search') {
      response.writeHead(200);
      response.end(
        JSON.stringify({ schema_version: 1, trace_id: 'trace-fake', data: { hits: [] } }),
      );
      return;
    }
    response.writeHead(404);
    response.end(JSON.stringify({ error: 'not found' }));
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      resolve({ server, baseUrl: `http://127.0.0.1:${address.port}` });
    });
  });
}

test('P8 performance live command measures HTTP p95 and emits a passed runtime report', async () => {
  const fake = await startFakeRuntime();
  const output = mkdtempSync(path.join(os.tmpdir(), 'planemem-performance-test-'));
  try {
    const raw = await runChild([
      'tools/run-performance-tests.mjs',
      '--live',
      '--base-url',
      fake.baseUrl,
      '--requests',
      '10',
      '--concurrency',
      '2',
      '--run-id',
      'p8-performance-live-test',
      '--output',
      output,
    ]);
    const result = JSON.parse(raw.trim());
    assert.equal(result.status, 'passed');
    assert.equal(result.measured, true);
    assert.equal(result.measurements.completed_requests, 10);
    assert.ok(result.measurements.search_p95_ms <= 1000);
    assert.equal(result.external_gates.includes('runtime HTTP'), false);
    assert.equal(
      readFileSync(path.join(output, 'p8-performance-live-test-performance.json'), 'utf8').length >
        0,
      true,
    );
  } finally {
    fake.server.close();
    rmSync(output, { recursive: true, force: true });
  }
});

test('P8 security live probe verifies scope isolation and deny side effects', async () => {
  const fake = await startSecurityRuntime();
  try {
    const result = await runLiveSecurityProbe({
      base_url: fake.baseUrl,
      trace_id: 'trace-security-test',
    });
    assert.equal(result.status, 'passed');
    assert.equal(result.runtime_status, 'passed');
    assert.equal(result.scope_leak_hits, 0);
    assert.equal(result.denied_side_effects, 0);
  } finally {
    fake.server.close();
  }
});

test('P8 resilience live probe records dependency stop, degraded request and recovery', async () => {
  let rabbitmqHealthy = true;
  const compose = async (command) => {
    if (command[0] === 'stop') {
      rabbitmqHealthy = false;
      return { status: 0, stdout: '', stderr: '' };
    }
    if (command[0] === 'start') {
      rabbitmqHealthy = true;
      return { status: 0, stdout: '', stderr: '' };
    }
    if (command[0] === 'ps') {
      const services = [
        'postgres',
        'redis',
        'nats',
        'keycloak',
        'minio',
        'otel-collector',
        'ai-memory',
        'plane',
        'workctx',
      ].map((Service) => ({ Service, State: 'running', Health: 'healthy' }));
      services.push({
        Service: 'rabbitmq',
        State: rabbitmqHealthy ? 'running' : 'exited',
        Health: rabbitmqHealthy ? 'healthy' : '',
      });
      return {
        status: 0,
        stdout: services.map((service) => JSON.stringify(service)).join('\n'),
        stderr: '',
      };
    }
    throw new Error(`unexpected compose command: ${command.join(' ')}`);
  };
  const request = async (url) => ({ status: url.endsWith('/health/ready') ? 200 : 200 });
  const result = await runLiveResilienceProbe({
    base_url: 'http://fake-runtime',
    trace_id: 'trace-resilience-test',
    run_compose: compose,
    request,
    wait_ms: 0,
  });
  assert.equal(result.status, 'passed');
  assert.deepEqual(
    result.steps.map((step) => step.status),
    ['passed', 'passed', 'passed', 'passed', 'passed'],
  );
  assert.equal(result.recovery_verified, true);
});

test('P8 dependency matrix stops and restores each selected Compose dependency', async () => {
  const health = new Map(['postgres', 'nats', 'keycloak'].map((service) => [service, true]));
  const compose = async (command) => {
    if (command[0] === 'stop') {
      health.set(command[1], false);
      return { status: 0, stdout: '', stderr: '' };
    }
    if (command[0] === 'start') {
      health.set(command[1], true);
      return { status: 0, stdout: '', stderr: '' };
    }
    if (command[0] === 'ps') {
      return {
        status: 0,
        stdout: [...health.entries()]
          .map(([Service, isHealthy]) =>
            JSON.stringify({
              Service,
              State: isHealthy ? 'running' : 'exited',
              Health: isHealthy ? 'healthy' : '',
            }),
          )
          .join('\n'),
        stderr: '',
      };
    }
    throw new Error(`unexpected compose command: ${command.join(' ')}`);
  };
  const result = await runLiveDependencyMatrix({
    services: ['postgres', 'nats', 'keycloak'],
    base_url: 'http://fake-runtime',
    trace_id: 'trace-dependency-matrix-test',
    run_compose: compose,
    request: async () => ({ status: 200 }),
    wait_ms: 0,
  });
  assert.equal(result.status, 'passed');
  assert.equal(result.recovery_verified, true);
  assert.deepEqual(
    result.services.map((service) => service.service),
    ['postgres', 'nats', 'keycloak'],
  );
  assert.equal(
    result.services.every((service) => service.status === 'passed'),
    true,
  );
});

test('P8 process-kill live probe restarts workctx and verifies readiness', async () => {
  let healthy = true;
  const compose = async (command) => {
    if (command[0] === 'kill') {
      healthy = false;
      return { status: 0, stdout: '', stderr: '' };
    }
    if (command[0] === 'start') {
      healthy = true;
      return { status: 0, stdout: '', stderr: '' };
    }
    if (command[0] === 'ps') {
      return {
        status: 0,
        stdout: JSON.stringify({
          Service: 'workctx',
          State: healthy ? 'running' : 'exited',
          Health: healthy ? 'healthy' : '',
        }),
        stderr: '',
      };
    }
    throw new Error(`unexpected compose command: ${command.join(' ')}`);
  };
  const result = await runLiveResilienceProbe({
    scenario: 'process-kill',
    base_url: 'http://fake-runtime',
    trace_id: 'trace-process-kill-test',
    run_compose: compose,
    request: async () => ({ status: 200 }),
    wait_ms: 0,
  });
  assert.equal(result.status, 'passed');
  assert.equal(result.recovery_verified, true);
  assert.deepEqual(
    result.steps.map((step) => step.name),
    [
      'process.health.before',
      'process.kill',
      'process.restore',
      'process.health.after',
      'runtime.probe',
    ],
  );
});

test('P8 network-partition live probe disconnects and reconnects ai-memory', async () => {
  let connected = true;
  const compose = async (command) => {
    if (command[0] === 'ps') {
      return {
        status: 0,
        stdout: [
          JSON.stringify({ Service: 'workctx', State: 'running', Health: 'healthy' }),
          JSON.stringify({ Service: 'ai-memory', State: 'running', Health: 'healthy' }),
        ].join('\n'),
        stderr: '',
      };
    }
    if (command[0] === 'exec') {
      return { status: connected ? 0 : 1, stdout: '', stderr: '' };
    }
    if (command[0] === 'up') {
      return { status: 0, stdout: '', stderr: '' };
    }
    throw new Error(`unexpected compose command: ${command.join(' ')}`);
  };
  const docker = async (command) => {
    if (command[0] === 'network' && command[1] === 'disconnect') connected = false;
    if (command[0] === 'network' && command[1] === 'connect') connected = true;
    return { status: 0, stdout: '', stderr: '' };
  };
  const result = await runLiveResilienceProbe({
    scenario: 'network-partition',
    base_url: 'http://fake-runtime',
    trace_id: 'trace-network-partition-test',
    run_compose: compose,
    run_docker: docker,
    request: async () => ({ status: 200 }),
    wait_ms: 0,
  });
  assert.equal(result.status, 'passed');
  assert.equal(result.recovery_verified, true);
  assert.deepEqual(
    result.steps.map((step) => step.name),
    [
      'network.health.before',
      'network.disconnect',
      'network.partition.probe',
      'network.reconnect',
      'network.recover-runtime',
      'network.recovery.probe',
      'runtime.probe',
    ],
  );
});

test('P8 business-recovery live probe reruns the platform chain after dependency restore', async () => {
  const health = new Map(['postgres', 'nats'].map((service) => [service, true]));
  const compose = async (command) => {
    if (command[0] === 'stop') {
      health.set(command[1], false);
      return { status: 0, stdout: '', stderr: '' };
    }
    if (command[0] === 'start') {
      health.set(command[1], true);
      return { status: 0, stdout: '', stderr: '' };
    }
    if (command[0] === 'ps') {
      return {
        status: 0,
        stdout: [...health.entries()]
          .map(([Service, isHealthy]) =>
            JSON.stringify({
              Service,
              State: isHealthy ? 'running' : 'exited',
              Health: isHealthy ? 'healthy' : '',
            }),
          )
          .join('\n'),
        stderr: '',
      };
    }
    throw new Error(`unexpected compose command: ${command.join(' ')}`);
  };
  const probes = [];
  const result = await runLiveResilienceProbe({
    scenario: 'business-recovery',
    services: ['postgres', 'nats'],
    base_url: 'http://fake-runtime',
    trace_id: 'trace-business-recovery-test',
    run_compose: compose,
    run_probe: async ({ trace_id }) => {
      probes.push(trace_id);
      return { status: 'passed', steps: [{ name: 'live.mcp.tools.call' }] };
    },
    wait_ms: 0,
  });
  assert.equal(result.status, 'passed');
  assert.equal(result.recovery_verified, true);
  assert.deepEqual(probes, [
    'trace-business-recovery-test-postgres',
    'trace-business-recovery-test-nats',
  ]);
  assert.equal(
    result.services.every((service) => service.steps.at(-1).name === 'business.probe'),
    true,
  );
});

function runChild(argumentsList) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, argumentsList, {
      cwd: path.resolve(import.meta.dirname, '../..'),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => (stdout += chunk));
    child.stderr.on('data', (chunk) => (stderr += chunk));
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) reject(new Error(`child exited ${code}: ${stderr || stdout}`));
      else resolve(stdout);
    });
  });
}

function startSecurityRuntime() {
  const server = createServer(async (request, response) => {
    let body = '';
    for await (const chunk of request) body += chunk;
    const payload = body ? JSON.parse(body) : {};
    response.setHeader('content-type', 'application/json');
    if (request.url === '/health/ready') {
      response.writeHead(200);
      response.end(JSON.stringify({ ready: true }));
      return;
    }
    if (request.url === '/v1/context/index') {
      response.writeHead(200);
      response.end(JSON.stringify({ data: { id: payload.id } }));
      return;
    }
    if (request.url === '/v1/context/search') {
      if (!(request.headers['x-capability'] ?? '').includes('context.read')) {
        response.writeHead(403);
        response.end(JSON.stringify({ code: 'DENIED' }));
        return;
      }
      const sameScope = request.headers['x-project-id'] === 'project-a';
      response.writeHead(200);
      response.end(
        JSON.stringify({ data: { hits: sameScope ? [{ id: 'security-fixture' }] : [] } }),
      );
      return;
    }
    response.writeHead(404);
    response.end(JSON.stringify({ error: 'not found' }));
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () =>
      resolve({ server, baseUrl: `http://127.0.0.1:${server.address().port}` }),
    );
  });
}
