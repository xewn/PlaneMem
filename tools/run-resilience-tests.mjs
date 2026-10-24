import { spawnSync } from 'node:child_process';
import { runLivePlatformProbe } from './live-platform-probe.mjs';
import {
  outputDirectory,
  parseArgs,
  printResult,
  stableRunId,
  writeJson,
} from './command-utils.mjs';

const args = parseArgs(process.argv.slice(2));
const scenario = String(args.scenario ?? 'offline-conflict');
const output = outputDirectory(args);
const run_id = stableRunId(args, 'resilience');
const defaultDependencyMatrix = [
  'postgres',
  'redis',
  'nats',
  'rabbitmq',
  'keycloak',
  'minio',
  'ai-memory',
  'otel-collector',
];
const defaultBusinessRecoveryServices = ['postgres', 'nats', 'rabbitmq', 'ai-memory'];
const composePrefix = [
  'compose',
  '-p',
  'planemem-local',
  '-f',
  'deploy/compose/docker-compose.yml',
  '-f',
  'deploy/compose/docker-compose.local-test.yml',
];
const known = {
  'offline-conflict': ['outbox.durable_write', 'network.reconnect', 'sync.ack', 'conflict.resolve'],
  'dependency-down': [
    'dependency.stop',
    'runtime.degraded-request',
    'dependency.restore',
    'dependency.healthy',
  ],
  'dependency-matrix': defaultDependencyMatrix.flatMap((service) => [
    `${service}.health.before`,
    `${service}.stop`,
    `${service}.runtime.probe`,
    `${service}.restore`,
    `${service}.health.after`,
  ]),
  'process-kill': [
    'process.health.before',
    'process.kill',
    'process.restore',
    'process.health.after',
    'runtime.probe',
  ],
  'network-partition': [
    'network.health.before',
    'network.disconnect',
    'network.partition.probe',
    'network.reconnect',
    'network.recover-runtime',
    'network.recovery.probe',
  ],
  'business-recovery': defaultBusinessRecoveryServices.flatMap((service) => [
    `${service}.health.before`,
    `${service}.stop`,
    `${service}.restore`,
    `${service}.health.after`,
    `${service}.business.probe`,
  ]),
};

export async function runLiveResilienceProbe({
  scenario: liveScenario = 'dependency-down',
  base_url = process.env.WORKCTX_URL ?? `http://127.0.0.1:${process.env.WORKCTX_PORT ?? '3000'}`,
  trace_id = `trace-${run_id}`,
  run_compose = defaultRunCompose,
  run_docker = defaultRunDocker,
  request = requestJson,
  wait_ms = 60_000,
  network,
  target,
  probe_command,
  services,
  run_probe = runLivePlatformProbe,
} = {}) {
  if (liveScenario === 'process-kill') {
    return runLiveProcessKillProbe({ base_url, trace_id, run_compose, request, wait_ms });
  }
  if (liveScenario === 'network-partition') {
    return runLiveNetworkPartitionProbe({
      base_url,
      trace_id,
      run_compose,
      run_docker,
      request,
      network,
      target,
      probe_command,
    });
  }
  if (liveScenario === 'business-recovery') {
    return runLiveBusinessRecoveryProbe({
      services,
      base_url,
      trace_id,
      run_compose,
      wait_ms,
      run_probe,
    });
  }
  if (liveScenario !== 'dependency-down') {
    return {
      status: 'blocked',
      mode: 'live',
      scenario: liveScenario,
      run_id,
      trace_id,
      source_refs: [{ type: 'external-gate', id: 'supported-live-resilience-scenario' }],
      external_gates: ['dependency-down live scenario'],
    };
  }
  const steps = [];
  const source_refs = [{ type: 'live-probe', id: 'compose-dependency-recovery' }];
  const step = (name, status, details = {}) => {
    steps.push({ name, status, trace_id, ...details });
    return status === 'passed';
  };
  let stopped = false;
  try {
    const initial = await run_compose(['ps', '--format', 'json']);
    const initialServices = parseServices(initial);
    if (!isHealthy(initialServices, 'rabbitmq')) {
      return blockedResult(
        'compose.health',
        'RabbitMQ is not healthy before fault injection',
        steps,
        source_refs,
        trace_id,
      );
    }
    if (!step('dependency.health.before', 'passed', { service: 'rabbitmq' }))
      return blockedResult(
        'dependency.health.before',
        'Initial dependency check failed',
        steps,
        source_refs,
        trace_id,
      );

    const stop = await run_compose(['stop', 'rabbitmq']);
    if (stop.status !== 0)
      return blockedResult('dependency.stop', diagnostic(stop), steps, source_refs, trace_id);
    stopped = true;
    if (!step('dependency.stop', 'passed', { service: 'rabbitmq' }))
      return blockedResult(
        'dependency.stop',
        'Dependency stop failed',
        steps,
        source_refs,
        trace_id,
      );

    const degraded = await request(`${String(base_url).replace(/\/$/, '')}/health/ready`, {
      method: 'GET',
      headers: { 'x-trace-id': trace_id },
    });
    if (
      !step('runtime.degraded-request', degraded.status === 200 ? 'passed' : 'failed', {
        status_code: degraded.status,
        dependency: 'rabbitmq',
      })
    )
      return blockedResult(
        'runtime.degraded-request',
        'Runtime was unavailable during dependency stop',
        steps,
        source_refs,
        trace_id,
      );

    const start = await run_compose(['start', 'rabbitmq']);
    stopped = false;
    if (start.status !== 0)
      return blockedResult('dependency.restore', diagnostic(start), steps, source_refs, trace_id);
    if (!step('dependency.restore', 'passed', { service: 'rabbitmq' }))
      return blockedResult(
        'dependency.restore',
        'Dependency restore failed',
        steps,
        source_refs,
        trace_id,
      );

    const healthy = await waitForHealthy(run_compose, 'rabbitmq', wait_ms);
    if (!step('dependency.healthy', healthy ? 'passed' : 'failed', { service: 'rabbitmq' }))
      return blockedResult(
        'dependency.healthy',
        'Dependency did not become healthy after restart',
        steps,
        source_refs,
        trace_id,
      );
    return {
      status: 'passed',
      mode: 'live',
      scenario: liveScenario,
      run_id,
      trace_id,
      source_refs,
      steps,
      measured: true,
      recovery_verified: true,
      external_gates: ['RC dependency business recovery'],
    };
  } finally {
    if (stopped) await run_compose(['start', 'rabbitmq']);
  }
}

export async function runLiveBusinessRecoveryProbe({
  services = defaultBusinessRecoveryServices,
  base_url = process.env.WORKCTX_URL ?? `http://127.0.0.1:${process.env.WORKCTX_PORT ?? '3000'}`,
  trace_id = `trace-${run_id}`,
  run_compose = defaultRunCompose,
  wait_ms = 60_000,
  run_probe = runLivePlatformProbe,
} = {}) {
  const selectedServices = [...new Set(services.map((service) => String(service).trim()))].filter(
    Boolean,
  );
  if (selectedServices.length === 0) {
    return {
      status: 'blocked',
      mode: 'live',
      scenario: 'business-recovery',
      run_id,
      trace_id,
      source_refs: [{ type: 'live-probe', id: 'compose-business-recovery' }],
      services: [],
      recovery_verified: false,
      error: 'At least one dependency service is required',
      external_gates: ['RC dependency business recovery'],
    };
  }

  const source_refs = [{ type: 'live-probe', id: 'compose-business-recovery' }];
  const results = [];
  for (const service of selectedServices) {
    const result = { service, status: 'passed', steps: [], trace_id, source_refs };
    let stopped = false;
    try {
      const before = await run_compose(['ps', '--format', 'json']);
      if (!isHealthy(parseServices(before), service))
        throw new Error(`${service} is not healthy before business recovery test`);
      result.steps.push({ name: 'health.before', status: 'passed' });

      const stop = await run_compose(['stop', service]);
      if (stop.status !== 0) throw new Error(diagnostic(stop));
      stopped = true;
      result.steps.push({ name: 'stop', status: 'passed' });

      const restore = await run_compose(['start', service]);
      if (restore.status !== 0) throw new Error(diagnostic(restore));
      stopped = false;
      result.steps.push({ name: 'restore', status: 'passed' });

      const healthy = await waitForHealthy(run_compose, service, wait_ms);
      if (!healthy) throw new Error(`${service} did not become healthy after restart`);
      result.steps.push({ name: 'health.after', status: 'passed' });

      const probe = await run_probe({
        base_url,
        trace_id: `${trace_id}-${service}`,
      });
      if (probe?.status !== 'passed') {
        throw new Error(
          `${service} business probe failed: ${probe?.error ?? 'unknown platform probe error'}`,
        );
      }
      result.steps.push({
        name: 'business.probe',
        status: 'passed',
        probe_steps: probe.steps?.length ?? 0,
      });
    } catch (error) {
      result.status = 'blocked';
      result.error = error instanceof Error ? error.message : String(error);
      result.steps.push({ name: 'failure', status: 'failed', error: result.error });
    } finally {
      if (stopped) {
        const restored = await run_compose(['start', service]);
        result.cleanup = { status: restored.status === 0 ? 'passed' : 'failed' };
        if (restored.status === 0) stopped = false;
        else result.status = 'blocked';
      }
    }
    results.push(result);
  }
  const passed = results.length > 0 && results.every((result) => result.status === 'passed');
  return {
    status: passed ? 'passed' : 'blocked',
    mode: 'live',
    scenario: 'business-recovery',
    run_id,
    trace_id,
    source_refs,
    services: results,
    recovery_verified: passed,
    measured: true,
    external_gates: ['RC dependency business recovery'],
  };
}

export async function runLiveProcessKillProbe({
  base_url = process.env.WORKCTX_URL ?? `http://127.0.0.1:${process.env.WORKCTX_PORT ?? '3000'}`,
  trace_id = `trace-${run_id}`,
  run_compose = defaultRunCompose,
  request = requestJson,
  wait_ms = 60_000,
} = {}) {
  const steps = [];
  const source_refs = [{ type: 'live-probe', id: 'compose-process-kill-recovery' }];
  let killed = false;
  const step = (name, status, details = {}) => {
    steps.push({ name, status, trace_id, ...details });
    return status === 'passed';
  };
  try {
    const initial = await run_compose(['ps', '--format', 'json']);
    if (!isHealthy(parseServices(initial), 'workctx'))
      return blockedResultForScenario(
        'process-kill',
        'workctx is not healthy before process fault injection',
        steps,
        source_refs,
        trace_id,
      );
    step('process.health.before', 'passed', { service: 'workctx' });

    const kill = await run_compose(['kill', '-s', 'SIGKILL', 'workctx']);
    if (kill.status !== 0)
      return blockedResultForScenario(
        'process-kill',
        diagnostic(kill),
        steps,
        source_refs,
        trace_id,
      );
    killed = true;
    step('process.kill', 'passed', { service: 'workctx', signal: 'SIGKILL' });

    const restore = await run_compose(['start', 'workctx']);
    if (restore.status !== 0)
      return blockedResultForScenario(
        'process-kill',
        diagnostic(restore),
        steps,
        source_refs,
        trace_id,
      );
    killed = false;
    step('process.restore', 'passed', { service: 'workctx' });

    const healthy = await waitForHealthy(run_compose, 'workctx', wait_ms);
    if (!step('process.health.after', healthy ? 'passed' : 'failed', { service: 'workctx' }))
      return blockedResultForScenario(
        'process-kill',
        'workctx did not become healthy after process restart',
        steps,
        source_refs,
        trace_id,
      );
    const runtime = await request(`${String(base_url).replace(/\/$/, '')}/health/ready`, {
      method: 'GET',
      headers: { 'x-trace-id': trace_id },
    });
    if (
      !step('runtime.probe', runtime.status === 200 ? 'passed' : 'failed', {
        status_code: runtime.status,
      })
    )
      return blockedResultForScenario(
        'process-kill',
        `Runtime readiness returned HTTP ${runtime.status ?? 'unreachable'} after process restart`,
        steps,
        source_refs,
        trace_id,
      );
    return {
      status: 'passed',
      mode: 'live',
      scenario: 'process-kill',
      run_id,
      trace_id,
      source_refs,
      steps,
      measured: true,
      recovery_verified: true,
      external_gates: ['RC dependency business recovery'],
    };
  } finally {
    if (killed) await run_compose(['start', 'workctx']);
  }
}

export async function runLiveNetworkPartitionProbe({
  base_url = process.env.WORKCTX_URL ?? `http://127.0.0.1:${process.env.WORKCTX_PORT ?? '3000'}`,
  trace_id = `trace-${run_id}`,
  run_compose = defaultRunCompose,
  request = requestJson,
  run_docker = defaultRunDocker,
  network = process.env.PLANEMEM_COMPOSE_NETWORK ?? 'planemem-local_default',
  target = process.env.PLANEMEM_PARTITION_TARGET ?? 'planemem-local-ai-memory-1',
  probe_command = [
    'exec',
    '-T',
    'workctx',
    'sh',
    '-c',
    "wget -S -O- --timeout=3 http://ai-memory:49374/ 2>&1 | grep -q 'HTTP/'",
  ],
} = {}) {
  const steps = [];
  const source_refs = [{ type: 'live-probe', id: 'compose-network-partition-recovery' }];
  let disconnected = false;
  const step = (name, status, details = {}) => {
    steps.push({ name, status, trace_id, ...details });
    return status === 'passed';
  };
  try {
    const initial = await run_compose(['ps', '--format', 'json']);
    if (
      !isHealthy(parseServices(initial), 'workctx') ||
      !isHealthy(parseServices(initial), 'ai-memory')
    )
      return blockedResultForScenario(
        'network-partition',
        'workctx and ai-memory must be healthy before network fault injection',
        steps,
        source_refs,
        trace_id,
      );
    step('network.health.before', 'passed', { services: ['workctx', 'ai-memory'] });

    const disconnect = await run_docker(['network', 'disconnect', '--force', network, target]);
    if (disconnect.status !== 0)
      return blockedResultForScenario(
        'network-partition',
        diagnostic(disconnect),
        steps,
        source_refs,
        trace_id,
      );
    disconnected = true;
    step('network.disconnect', 'passed', { network, target });

    const partitionProbe = await run_compose(probe_command);
    if (
      !step('network.partition.probe', partitionProbe.status !== 0 ? 'passed' : 'failed', {
        expected: 'dependency unreachable from workctx',
        exit_code: partitionProbe.status,
      })
    )
      return blockedResultForScenario(
        'network-partition',
        'workctx still reached ai-memory after network disconnect',
        steps,
        source_refs,
        trace_id,
      );

    const reconnect = await run_docker([
      'network',
      'connect',
      '--alias',
      'ai-memory',
      network,
      target,
    ]);
    if (reconnect.status !== 0)
      return blockedResultForScenario(
        'network-partition',
        diagnostic(reconnect),
        steps,
        source_refs,
        trace_id,
      );
    disconnected = false;
    step('network.reconnect', 'passed', { network, target });

    const recoverRuntime = await run_compose([
      'up',
      '-d',
      '--force-recreate',
      '--no-deps',
      'workctx',
    ]);
    if (recoverRuntime.status !== 0)
      return blockedResultForScenario(
        'network-partition',
        diagnostic(recoverRuntime),
        steps,
        source_refs,
        trace_id,
      );
    step('network.recover-runtime', 'passed', { service: 'workctx' });

    const recoveryProbe = await run_compose(probe_command);
    if (
      !step('network.recovery.probe', recoveryProbe.status === 0 ? 'passed' : 'failed', {
        expected: 'dependency reachable after reconnect',
        exit_code: recoveryProbe.status,
      })
    )
      return blockedResultForScenario(
        'network-partition',
        'workctx could not reach ai-memory after network reconnect',
        steps,
        source_refs,
        trace_id,
      );
    const runtime = await request(`${String(base_url).replace(/\/$/, '')}/health/ready`, {
      method: 'GET',
      headers: { 'x-trace-id': trace_id },
    });
    if (runtime.status !== 200)
      return blockedResultForScenario(
        'network-partition',
        `Runtime readiness returned HTTP ${runtime.status ?? 'unreachable'} after network recovery`,
        steps,
        source_refs,
        trace_id,
      );
    steps.push({ name: 'runtime.probe', status: 'passed', trace_id, status_code: runtime.status });
    return {
      status: 'passed',
      mode: 'live',
      scenario: 'network-partition',
      run_id,
      trace_id,
      source_refs,
      steps,
      measured: true,
      recovery_verified: true,
      external_gates: ['RC dependency business recovery'],
    };
  } finally {
    if (disconnected)
      await run_docker(['network', 'connect', '--alias', 'ai-memory', network, target]);
  }
}

export async function runLiveDependencyMatrix({
  services = defaultDependencyMatrix,
  base_url = process.env.WORKCTX_URL ?? `http://127.0.0.1:${process.env.WORKCTX_PORT ?? '3000'}`,
  trace_id = `trace-${run_id}`,
  run_compose = defaultRunCompose,
  request = requestJson,
  wait_ms = 60_000,
} = {}) {
  const selectedServices = [...new Set(services.map((service) => String(service).trim()))].filter(
    Boolean,
  );
  if (selectedServices.length === 0) {
    return {
      status: 'blocked',
      mode: 'live',
      scenario: 'dependency-matrix',
      run_id,
      trace_id,
      source_refs: [{ type: 'live-probe', id: 'compose-dependency-matrix' }],
      services: [],
      recovery_verified: false,
      error: 'At least one dependency service is required',
      external_gates: ['Compose dependency matrix'],
    };
  }

  const url = String(base_url).replace(/\/$/, '');
  const source_refs = [{ type: 'live-probe', id: 'compose-dependency-matrix' }];
  const results = [];
  for (const service of selectedServices) {
    const result = {
      service,
      status: 'passed',
      steps: [],
      trace_id,
      source_refs,
    };
    let stopIssued = false;
    try {
      const before = await run_compose(['ps', '--format', 'json']);
      if (!isHealthy(parseServices(before), service)) {
        throw new Error(`${service} is not healthy before fault injection`);
      }
      result.steps.push({ name: 'health.before', status: 'passed' });

      const stopped = await run_compose(['stop', service]);
      if (stopped.status !== 0) throw new Error(diagnostic(stopped));
      stopIssued = true;
      result.steps.push({ name: 'stop', status: 'passed' });

      const runtime = await request(`${url}/health/ready`, {
        method: 'GET',
        headers: { 'x-trace-id': trace_id, 'x-dependency-under-test': service },
      });
      if (runtime.status !== 200) {
        throw new Error(`Runtime readiness returned HTTP ${runtime.status ?? 'unreachable'}`);
      }
      result.steps.push({ name: 'runtime.probe', status: 'passed', status_code: runtime.status });

      const restored = await run_compose(['start', service]);
      if (restored.status !== 0) throw new Error(diagnostic(restored));
      stopIssued = false;
      result.steps.push({ name: 'restore', status: 'passed' });

      const healthy = await waitForHealthy(run_compose, service, wait_ms);
      if (!healthy) throw new Error(`${service} did not become healthy after restart`);
      result.steps.push({ name: 'health.after', status: 'passed' });
    } catch (error) {
      result.status = 'blocked';
      result.error = error instanceof Error ? error.message : String(error);
      result.steps.push({ name: 'failure', status: 'failed', error: result.error });
    } finally {
      if (stopIssued) {
        const restored = await run_compose(['start', service]);
        result.cleanup = { status: restored.status === 0 ? 'passed' : 'failed' };
        if (restored.status === 0) stopIssued = false;
        else result.status = 'blocked';
      }
    }
    results.push(result);
  }

  const passed = results.length > 0 && results.every((result) => result.status === 'passed');
  return {
    status: passed ? 'passed' : 'blocked',
    mode: 'live',
    scenario: 'dependency-matrix',
    run_id,
    trace_id,
    source_refs,
    services: results,
    recovery_verified: passed,
    measured: true,
    external_gates: ['RC dependency business recovery'],
  };
}

async function waitForHealthy(run_compose, service, timeoutMs) {
  const deadline = Date.now() + Number(timeoutMs);
  do {
    const result = await run_compose(['ps', '--format', 'json']);
    if (isHealthy(parseServices(result), service)) return true;
    if (timeoutMs <= 0) return false;
    await new Promise((resolve) =>
      setTimeout(resolve, Math.min(1000, Math.max(1, deadline - Date.now()))),
    );
  } while (Date.now() <= deadline);
  return false;
}

function blockedResult(name, message, steps, source_refs, trace_id) {
  stepFailure(steps, name, trace_id, message);
  return {
    status: 'blocked',
    mode: 'live',
    scenario: 'dependency-down',
    run_id,
    trace_id,
    source_refs,
    steps,
    measured: false,
    recovery_verified: false,
    error: message,
    external_gates: ['Compose dependency recovery'],
  };
}

function blockedResultForScenario(scenario, message, steps, source_refs, trace_id) {
  stepFailure(steps, 'failure', trace_id, message);
  return {
    status: 'blocked',
    mode: 'live',
    scenario,
    run_id,
    trace_id,
    source_refs,
    steps,
    measured: false,
    recovery_verified: false,
    error: message,
    external_gates: ['Compose resilience scenario'],
  };
}

function stepFailure(steps, name, trace_id, message) {
  if (!steps.some((item) => item.name === name))
    steps.push({ name, status: 'failed', trace_id, error: message });
}

function defaultRunCompose(command) {
  const result = spawnSync('docker', [...composePrefix, ...command], { encoding: 'utf8' });
  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    error: result.error,
  };
}

function defaultRunDocker(command) {
  const result = spawnSync('docker', command, { encoding: 'utf8' });
  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    error: result.error,
  };
}

async function requestJson(url, options) {
  try {
    const response = await fetch(url, options);
    return { status: response.status };
  } catch (error) {
    return { status: undefined, error: error instanceof Error ? error.message : String(error) };
  }
}

function parseServices(result) {
  if (!result || result.status !== 0) return [];
  return String(result.stdout ?? '')
    .trim()
    .split(/\r?\n/)
    .filter(Boolean)
    .flatMap((line) => {
      try {
        return [JSON.parse(line)];
      } catch {
        return [];
      }
    });
}

function isHealthy(services, service) {
  const item = services.find((candidate) => candidate.Service === service);
  return item?.State === 'running' && item?.Health === 'healthy';
}

function diagnostic(result) {
  if (result?.error?.message) return result.error.message;
  return String(result?.stderr ?? result?.stdout ?? 'command failed').trim() || 'command failed';
}

if (
  process.argv[1] &&
  new URL(import.meta.url).pathname.endsWith(process.argv[1].replaceAll('\\', '/'))
) {
  if (args.live === true) {
    const result =
      scenario === 'dependency-matrix'
        ? await runLiveDependencyMatrix({
            services: args.services
              ? String(args.services)
                  .split(',')
                  .map((service) => service.trim())
              : undefined,
            base_url: args.base_url,
            trace_id: `trace-${run_id}`,
            wait_ms: args.wait_ms === undefined ? undefined : Number(args.wait_ms),
          })
        : await runLiveResilienceProbe({
            scenario,
            services: args.services
              ? String(args.services)
                  .split(',')
                  .map((service) => service.trim())
              : undefined,
            base_url: args.base_url,
            trace_id: `trace-${run_id}`,
            wait_ms: args.wait_ms === undefined ? undefined : Number(args.wait_ms),
          });
    writeJson(output, `${run_id}-resilience.json`, result);
    printResult(result);
    if (result.status !== 'passed') process.exitCode = result.status === 'blocked' ? 2 : 1;
  } else if (known[scenario] === undefined) {
    printResult({ status: 'failed', error: `unknown scenario: ${scenario}` });
    process.exitCode = 1;
  } else {
    const result = {
      status: 'passed',
      mode: 'offline-fixture',
      run_id,
      trace_id: `trace-${run_id}`,
      source_refs: [{ type: 'fault-scenario', id: scenario }],
      scenario,
      side_effects: 0,
      steps: known[scenario].map((name) => ({
        name,
        status: 'passed',
        trace_id: `trace-${run_id}`,
        source_refs: [{ type: 'fault-fixture', id: name }],
      })),
      external_gates: [
        'process restart',
        'network partition',
        'PostgreSQL/NATS/ai-memory recovery',
      ],
    };
    writeJson(output, `${run_id}-resilience.json`, result);
    printResult(result);
  }
}
