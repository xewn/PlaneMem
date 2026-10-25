import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  outputDirectory,
  parseArgs,
  printResult,
  stableRunId,
  workspaceRoot,
  writeJson,
} from './command-utils.mjs';

const args = parseArgs(process.argv.slice(2));
const output = outputDirectory(args);
const run_id = stableRunId(args, 'rc-readiness');
const mode = args.offline === true ? 'offline-fixture' : 'live';

function resolveCommand(command) {
  const configured = process.env[`${command.toUpperCase()}_BIN`];
  if (configured) return configured;
  if (command === 'helm' && process.env.LOCALAPPDATA) {
    const helmRoot = path.join(process.env.LOCALAPPDATA, 'PlaneMem', 'tools');
    if (existsSync(helmRoot)) {
      const candidates = readdirSync(helmRoot, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && entry.name.startsWith('helm-v'))
        .map((entry) => path.join(helmRoot, entry.name, 'windows-amd64', 'helm.exe'))
        .filter((candidate) => existsSync(candidate))
        .sort()
        .reverse();
      if (candidates[0]) return candidates[0];
    }
  }
  return command;
}

function commandAvailable(command) {
  const versionArgs =
    command === 'kubectl'
      ? ['version', '--client=true', '--output=json']
      : command === 'helm'
        ? ['version', '--short']
        : ['--version'];
  const result = spawnSync(resolveCommand(command), versionArgs, {
    cwd: workspaceRoot,
    encoding: 'utf8',
  });
  return result.error === undefined && result.status === 0;
}

function liveComposeStatus() {
  const result = spawnSync(
    'docker',
    [
      'compose',
      '-p',
      'planemem-local',
      '-f',
      'deploy/compose/docker-compose.yml',
      '-f',
      'deploy/compose/docker-compose.local-test.yml',
      'ps',
      '--format',
      'json',
    ],
    { cwd: workspaceRoot, encoding: 'utf8' },
  );
  if (result.error !== undefined || result.status !== 0) return 'not-ready';
  const services = result.stdout
    .trim()
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return undefined;
      }
    })
    .filter((service) => service !== undefined);
  const requiredServices = [
    'postgres',
    'redis',
    'nats',
    'rabbitmq',
    'keycloak',
    'minio',
    'otel-collector',
    'ai-memory',
    'plane',
    'workctx',
  ];
  const byService = new Map(services.map((service) => [service.Service, service]));
  return requiredServices.every((name) => {
    const service = byService.get(name);
    return service?.State === 'running' && service?.Health === 'healthy';
  })
    ? 'available'
    : 'not-ready';
}

function runNode(relativeScript, scriptArgs = []) {
  const result = spawnSync(
    process.execPath,
    [path.join(workspaceRoot, relativeScript), ...scriptArgs],
    { cwd: workspaceRoot, encoding: 'utf8' },
  );
  return { status: result.status === 0 ? 'passed' : 'failed', output: result.stdout.trim() };
}

const requiredFiles = [
  'deploy/compose/docker-compose.yml',
  'deploy/helm/planemem/Chart.yaml',
  'deploy/helm/planemem/values.schema.json',
  'deploy/release-manifest.yaml',
  'docs/design/05-release/01-release-deployment-rollback.md',
];
const fileChecks = requiredFiles.map((file) => ({
  file,
  status: existsSync(path.join(workspaceRoot, file)) ? 'passed' : 'failed',
}));
const localChecks = {
  plan_audit: runNode('tools/plan-audit.mjs', ['--output', output]),
  compose_doctor: runNode('deploy/compose/health/doctor.mjs', ['--offline']),
  compose_health: runNode('deploy/compose/health/healthcheck.mjs', ['--offline']),
  required_files: fileChecks,
};
const localStatus =
  Object.values(localChecks)
    .flatMap((value) => (Array.isArray(value) ? value : [value]))
    .every((value) => value.status === 'passed') &&
  fileChecks.every((value) => value.status === 'passed')
    ? 'passed'
    : 'failed';
const externalGates = [
  { gate: 'docker-cli', status: commandAvailable('docker') ? 'available' : 'missing' },
  { gate: 'helm-cli', status: commandAvailable('helm') ? 'available' : 'missing' },
  { gate: 'kubectl-cli', status: commandAvailable('kubectl') ? 'available' : 'missing' },
  { gate: 'live-services', status: mode === 'live' ? liveComposeStatus() : 'not-run' },
];
const externalStatus =
  mode === 'offline-fixture'
    ? 'blocked'
    : externalGates.every((gate) => gate.status === 'available')
      ? 'ready'
      : 'blocked';
const result = {
  status:
    mode === 'offline-fixture'
      ? 'simulated'
      : localStatus === 'passed' && externalStatus === 'ready'
        ? 'passed'
        : 'blocked',
  mode,
  command: 'rc-readiness',
  run_id,
  trace_id: `trace-${run_id}`,
  source_refs: [
    { type: 'release-design', id: 'docs/design/05-release' },
    { type: 'plan-audit', id: 'tools/plan-audit.mjs' },
  ],
  local_status: localStatus,
  local_checks: Object.fromEntries(
    Object.entries(localChecks).map(([name, value]) => [
      name,
      Array.isArray(value) ? value : value.status,
    ]),
  ),
  external_status: externalStatus,
  external_gates: externalGates,
  release_blockers: externalGates.filter((gate) => gate.status !== 'available'),
};
writeJson(output, `${run_id}-rc-readiness.json`, result);
printResult(result);
if (result.status === 'blocked') process.exitCode = 2;
