import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  outputDirectory,
  parseArgs,
  printResult,
  stableRunId,
  workspaceRoot,
} from './command-utils.mjs';

const [command = 'help', ...rest] = process.argv.slice(2);
const args = parseArgs(rest);
const run_id = stableRunId(args, 'k3s-release');

const defaults = {
  chart: path.join(workspaceRoot, 'deploy', 'helm', 'planemem'),
  release: 'planemem',
  namespace: 'planemem-test',
  secret: 'planemem-secrets',
  replicas: 3,
  timeout: '180s',
};

function resolveCommand(commandName) {
  const configured = process.env[`${commandName.toUpperCase()}_BIN`];
  if (configured) return configured;
  if (commandName === 'helm' && process.env.LOCALAPPDATA) {
    const root = path.join(process.env.LOCALAPPDATA, 'PlaneMem', 'tools');
    if (existsSync(root)) {
      const candidates = [];
      for (const entry of requireDirectory(root)) {
        if (!entry.startsWith('helm-v')) continue;
        const candidate = path.join(root, entry, 'windows-amd64', 'helm.exe');
        if (existsSync(candidate)) candidates.push(candidate);
      }
      candidates.sort().reverse();
      if (candidates[0]) return candidates[0];
    }
  }
  return process.platform === 'win32' ? `${commandName}.exe` : commandName;
}

function requireDirectory(directory) {
  try {
    return readdirSync(directory, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch {
    return [];
  }
}

function runTool(tool, toolArgs) {
  const result = spawnSync(resolveCommand(tool), toolArgs, {
    cwd: workspaceRoot,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  });
  return {
    command: tool,
    args: toolArgs,
    status: result.status ?? 1,
    stdout: String(result.stdout ?? '').trim(),
    stderr: String(result.stderr ?? '').trim(),
    error: result.error?.message,
  };
}

function asString(name, fallback) {
  const value = args[name];
  return value === undefined || value === true ? fallback : String(value);
}

function asPositiveInteger(name, fallback) {
  const value = Number(asString(name, String(fallback)));
  if (!Number.isInteger(value) || value < 1)
    throw new Error(`--${name.replaceAll('_', '-')} must be a positive integer`);
  return value;
}

function deploymentInput() {
  const imageRepository = asString('image_repository', 'ghcr.io/planemem/platform');
  const imageTag = asString('image_tag', '0.1.0');
  const imageDigest = asString('image_digest', '');
  const chart = path.resolve(asString('chart', defaults.chart));
  const release = asString('release', defaults.release);
  const namespace = asString('namespace', defaults.namespace);
  const secret = asString('secret', defaults.secret);
  const replicas = asPositiveInteger('replicas', defaults.replicas);
  const timeout = asString('timeout', defaults.timeout);
  const errors = [];
  if (!existsSync(path.join(chart, 'Chart.yaml')))
    errors.push(`chart is missing Chart.yaml: ${chart}`);
  if (!existsSync(path.join(chart, 'templates', 'deployment.yaml')))
    errors.push(`chart is missing deployment template: ${chart}`);
  if (!/^[a-z0-9](?:[a-z0-9./:_-]*[a-z0-9])?$/u.test(imageRepository))
    errors.push(`invalid image repository: ${imageRepository}`);
  if (
    !/^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(imageTag) ||
    imageTag === 'latest' ||
    imageTag.includes('@')
  )
    errors.push(`image tag must be immutable and cannot be latest: ${imageTag}`);
  if (!/^sha256:[a-f0-9]{64}$/u.test(imageDigest))
    errors.push('image digest must match sha256:<64 lowercase hex characters>');
  if (imageDigest === `sha256:${'0'.repeat(64)}`) errors.push('image digest cannot be all zeroes');
  if (!/^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/u.test(namespace))
    errors.push(`invalid namespace: ${namespace}`);
  if (!/^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/u.test(release))
    errors.push(`invalid release name: ${release}`);
  if (!/^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/u.test(secret))
    errors.push(`invalid secret name: ${secret}`);
  if (errors.length > 0) {
    const error = new Error(errors.join('; '));
    error.validation = errors;
    throw error;
  }
  return {
    chart,
    release,
    namespace,
    secret,
    replicas,
    timeout,
    imageRepository,
    imageTag,
    imageDigest,
  };
}

function setArgs(input) {
  return [
    '--set-string',
    `image.repository=${input.imageRepository}`,
    '--set-string',
    `image.tag=${input.imageTag}`,
    '--set-string',
    `image.digest=${input.imageDigest}`,
    '--set-string',
    `secrets.existingSecret=${input.secret}`,
    '--set-string',
    `replicaCount=${input.replicas}`,
  ];
}

function helmNamespaceArgs(input) {
  return ['--namespace', input.namespace, '--create-namespace'];
}

function reportPath() {
  const requested = args.output;
  if (requested && String(requested).toLowerCase().endsWith('.json'))
    return path.resolve(String(requested));
  const directory = reportDirectory();
  return path.join(directory, `${run_id}.json`);
}

function reportDirectory() {
  const requested = args.output;
  if (requested && String(requested).toLowerCase().endsWith('.json'))
    return path.dirname(path.resolve(String(requested)));
  return outputDirectory(args);
}

function saveReport(result) {
  const file = reportPath();
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  return { ...result, report: path.relative(workspaceRoot, file).replaceAll('\\', '/') };
}

function printAndExit(result, exitCode = 0) {
  const withReport = saveReport(result);
  printResult(withReport);
  if (exitCode !== 0) process.exitCode = exitCode;
}

function validateChartWithHelm(input) {
  const result = runTool('helm', ['lint', input.chart]);
  return result.status === 0
    ? { status: 'passed', output: result.stdout }
    : {
        status: 'failed',
        output: result.stderr || result.stdout,
        command: result.command,
        args: result.args,
      };
}

function renderChart(input) {
  const result = runTool('helm', [
    'template',
    input.release,
    input.chart,
    ...helmNamespaceArgs(input),
    ...setArgs(input),
  ]);
  if (result.status !== 0) return { status: 'failed', error: result.stderr || result.stdout };
  const output = path.resolve(
    asString('render_output', path.join(reportDirectory(), `${run_id}.yaml`)),
  );
  mkdirSync(path.dirname(output), { recursive: true });
  writeFileSync(output, `${result.stdout}\n`, 'utf8');
  return { status: 'passed', output: path.relative(workspaceRoot, output).replaceAll('\\', '/') };
}

function deploymentArgs(input) {
  return [
    'upgrade',
    '--install',
    input.release,
    input.chart,
    ...helmNamespaceArgs(input),
    '--atomic',
    '--wait',
    '--timeout',
    input.timeout,
    ...setArgs(input),
  ];
}

function parseJsonOutput(result, label) {
  if (result.status !== 0) {
    const error = new Error(`${label} failed: ${result.stderr || result.stdout}`);
    error.external = true;
    throw error;
  }
  try {
    return JSON.parse(result.stdout);
  } catch {
    throw new Error(`${label} returned invalid JSON`);
  }
}

function verifyDeployment(input) {
  const deployment = parseJsonOutput(
    runTool('kubectl', ['-n', input.namespace, 'get', 'deployment', input.release, '-o', 'json']),
    'kubectl get deployment',
  );
  const desired = Number(deployment.spec?.replicas ?? input.replicas);
  const ready = Number(deployment.status?.readyReplicas ?? 0);
  const available = Number(deployment.status?.availableReplicas ?? 0);
  if (desired !== input.replicas || ready < input.replicas || available < input.replicas)
    throw new Error(
      `deployment is not ready: ready=${ready} available=${available} desired=${desired}`,
    );
  const selector = Object.entries(deployment.spec?.selector?.matchLabels ?? {})
    .map(([key, value]) => `${key}=${value}`)
    .join(',');
  if (!selector) throw new Error('deployment selector is empty');
  const pods = parseJsonOutput(
    runTool('kubectl', ['-n', input.namespace, 'get', 'pods', '-l', selector, '-o', 'json']),
    'kubectl get pods',
  );
  const items = pods.items ?? [];
  if (items.length < input.replicas)
    throw new Error(`pod count is below replicas: ${items.length}/${input.replicas}`);
  const nodes = new Set();
  for (const pod of items) {
    if (pod.status?.phase !== 'Running')
      throw new Error(`pod is not running: ${pod.metadata?.name ?? 'unknown'}`);
    const readyCondition = (pod.status?.conditions ?? []).find(
      (condition) => condition.type === 'Ready',
    );
    if (readyCondition?.status !== 'True')
      throw new Error(`pod is not ready: ${pod.metadata?.name ?? 'unknown'}`);
    if (pod.spec?.nodeName) nodes.add(pod.spec.nodeName);
    for (const container of pod.spec?.containers ?? []) {
      if (!/@sha256:[a-f0-9]{64}$/u.test(String(container.image)))
        throw new Error(`pod image is not digest pinned: ${container.image}`);
      if (input.imageDigest && !String(container.image).endsWith(`@${input.imageDigest}`))
        throw new Error(
          `pod image digest mismatch: expected ${input.imageDigest}, got ${container.image}`,
        );
    }
  }
  const expectedNodes = asString('expected_nodes', '')
    .split(',')
    .map((node) => node.trim())
    .filter(Boolean);
  if (expectedNodes.length > 0 && expectedNodes.some((node) => !nodes.has(node)))
    throw new Error(
      `expected nodes are not all serving pods: expected=${expectedNodes.join(',')} actual=${[...nodes].join(',')}`,
    );
  const endpoints = parseJsonOutput(
    runTool('kubectl', ['-n', input.namespace, 'get', 'endpoints', input.release, '-o', 'json']),
    'kubectl get endpoints',
  );
  const endpointCount = (endpoints.subsets ?? []).reduce(
    (count, subset) => count + (subset.addresses?.length ?? 0),
    0,
  );
  if (endpointCount < input.replicas)
    throw new Error(`service endpoints are below replicas: ${endpointCount}/${input.replicas}`);
  return {
    deployment: {
      desired,
      ready,
      available,
      generation: deployment.metadata?.generation,
      observed_generation: deployment.status?.observedGeneration,
    },
    pods: items.map((pod) => ({
      name: pod.metadata?.name,
      node: pod.spec?.nodeName,
      phase: pod.status?.phase,
    })),
    nodes: [...nodes].sort(),
    endpoints: endpointCount,
  };
}

async function verifyHealth() {
  const baseUrl = asString('health_url', '');
  if (!baseUrl) return { status: 'skipped' };
  const checks = [];
  for (const endpoint of ['/health', '/health/ready']) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    try {
      const response = await fetch(new URL(endpoint, baseUrl), { signal: controller.signal });
      checks.push({ endpoint, status: response.status });
      if (!response.ok) throw new Error(`${endpoint} returned HTTP ${response.status}`);
    } finally {
      clearTimeout(timer);
    }
  }
  return { status: 'passed', checks };
}

async function main() {
  if (command === 'help') {
    printResult({
      status: 'passed',
      command: 'help',
      commands: ['validate', 'render', 'preflight', 'deploy', 'verify', 'rollback'],
    });
    return;
  }
  if (!['validate', 'render', 'preflight', 'deploy', 'verify', 'rollback'].includes(command))
    throw new Error(`unknown command: ${command}`);
  const input = deploymentInput();
  const base = {
    status: 'passed',
    command,
    run_id,
    trace_id: `trace-${run_id}`,
    release: input.release,
    namespace: input.namespace,
    image: `${input.imageRepository}:${input.imageTag}@${input.imageDigest}`,
    source_refs: [
      { type: 'helm-chart', id: path.relative(workspaceRoot, input.chart).replaceAll('\\', '/') },
    ],
  };
  if (command === 'validate') {
    printAndExit({ ...base, validation: 'passed' });
    return;
  }
  if (command === 'render') {
    const rendered = renderChart(input);
    if (rendered.status !== 'passed') {
      printAndExit({ ...base, status: 'failed', error: rendered.error }, 1);
      return;
    }
    printAndExit({ ...base, rendered });
    return;
  }
  if (command === 'preflight') {
    const lint = validateChartWithHelm(input);
    const kubectl = runTool('kubectl', ['version', '--client=true', '--output=json']);
    if (lint.status !== 'passed' || kubectl.status !== 0) {
      printAndExit(
        {
          ...base,
          status: 'blocked',
          lint,
          kubectl: { status: kubectl.status, error: kubectl.stderr || kubectl.stdout },
        },
        2,
      );
      return;
    }
    printAndExit({ ...base, lint, kubectl: { status: 'passed' } });
    return;
  }
  if (command === 'deploy') {
    const result = runTool('helm', deploymentArgs(input));
    if (result.status !== 0) {
      printAndExit(
        { ...base, status: 'failed', error: result.stderr || result.stdout, phase: 'helm-upgrade' },
        1,
      );
      return;
    }
    const rollout = runTool('kubectl', [
      '-n',
      input.namespace,
      'rollout',
      'status',
      `deployment/${input.release}`,
      '--timeout',
      input.timeout,
    ]);
    if (rollout.status !== 0) {
      printAndExit(
        { ...base, status: 'failed', error: rollout.stderr || rollout.stdout, phase: 'rollout' },
        1,
      );
      return;
    }
    const verification = verifyDeployment(input);
    const health = await verifyHealth();
    printAndExit({ ...base, helm: 'passed', rollout: 'passed', verification, health });
    return;
  }
  if (command === 'verify') {
    const verification = verifyDeployment(input);
    const health = await verifyHealth();
    printAndExit({ ...base, verification, health });
    return;
  }
  const revision = asPositiveInteger('revision', 0);
  const result = runTool('helm', [
    'rollback',
    input.release,
    String(revision),
    ...helmNamespaceArgs(input),
    '--atomic',
    '--wait',
    '--timeout',
    input.timeout,
  ]);
  if (result.status !== 0) {
    printAndExit(
      { ...base, status: 'failed', error: result.stderr || result.stdout, phase: 'helm-rollback' },
      1,
    );
    return;
  }
  const verification = verifyDeployment(input);
  const health = await verifyHealth();
  printAndExit({ ...base, helm: 'rolled-back', revision, verification, health });
}

try {
  await main();
} catch (error) {
  printAndExit(
    {
      status: error.validation || !error.external ? 'failed' : 'blocked',
      command,
      run_id,
      trace_id: `trace-${run_id}`,
      error: error.message,
      validation: error.validation,
    },
    error.validation || !error.external ? 1 : 2,
  );
}
