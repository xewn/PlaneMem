import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '..', '..');
const node = process.execPath;

function run(script, args, output) {
  const result = spawnSync(node, [path.join(root, 'tools', script), ...args, '--output', output], {
    cwd: root,
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, `${script}: ${result.stderr}`);
  return JSON.parse(result.stdout.trim());
}

function runBlocked(script, args, output) {
  const result = spawnSync(node, [path.join(root, 'tools', script), ...args, '--output', output], {
    cwd: root,
    encoding: 'utf8',
  });
  assert.notEqual(result.status, 0, `${script} unexpectedly passed live gate`);
  return JSON.parse(result.stdout.trim());
}

function runModuleContractEdge(edge) {
  const result = spawnSync(
    node,
    [path.join(root, 'tools', 'run-module-tests.mjs'), '--contract', '--edge', edge],
    {
      cwd: root,
      encoding: 'utf8',
      env: Object.fromEntries(
        Object.entries(process.env).filter(([key]) => key !== 'NODE_TEST_CONTEXT'),
      ),
    },
  );
  assert.equal(result.status, 0, `contract edge ${edge}: ${result.stderr}`);
  return `${result.stdout}\n${result.stderr}`;
}

test('T0.1/T0.5 expose reproducible fixture, integration, resilience and evidence commands', () => {
  const output = mkdtempSync(path.join(tmpdir(), 'planemem-tooling-'));
  try {
    const packageManifest = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
    const buildConfig = JSON.parse(readFileSync(path.join(root, 'tsconfig.build.json'), 'utf8'));
    assert.match(packageManifest.scripts.build, /tsconfig\.build\.json/);
    assert.equal(buildConfig.compilerOptions.noEmit, false);
    const validated = run('fixture-cli.mjs', ['validate'], output);
    assert.equal(validated.status, 'passed');
    assert.equal(validated.mode, 'offline-fixture');
    const seeded = run(
      'fixture-cli.mjs',
      ['seed', '--fixture', 'tenant-demo', '--version', '1'],
      output,
    );
    assert.equal(seeded.status, 'passed');
    assert.equal(existsSync(path.join(output, 'seed.json')), true);
    const moduleSeed = run('fixture-cli.mjs', ['seed', '--module', 'P8'], output);
    assert.equal(moduleSeed.module, 'P8');
    const events = run('fixture-cli.mjs', ['events', '--scenario', 'duplicate-gap-delay'], output);
    assert.equal(events.status, 'passed');
    assert.equal(events.event_count >= 3, true);
    const backup = run('fixture-cli.mjs', ['backup', '--manifest', 'sha256:fixture'], output);
    assert.equal(backup.status, 'passed');
    assert.equal(backup.verified, true);
    const functional = run('run-functional-tests.mjs', ['--chain', 'plane-to-mcp'], output);
    assert.equal(functional.status, 'passed');
    assert.equal(functional.steps.length >= 4, true);
    assert.equal(functional.duplicate_event, 'duplicate');
    assert.match(functional.context_pack_hash, /^sha256:/);
    assert.match(functional.mcp_resource_uri, /^wcp:\/\/context\//);
    const workbench = run('run-functional-tests.mjs', ['--suite', 'workbench'], output);
    assert.equal(workbench.steps[0].name, 'gateway.query');
    const clientSwitch = run('run-functional-tests.mjs', ['--chain', 'client-switch'], output);
    assert.equal(clientSwitch.handoff_status, 'claimed');
    assert.equal(clientSwitch.resumed_client_id, 'claude-code');
    assert.match(runModuleContractEdge('IF-P2-P3'), /pass/);
    const live = runBlocked(
      'run-functional-tests.mjs',
      ['--chain', 'plane-to-mcp', '--live'],
      output,
    );
    assert.equal(live.status, 'blocked');
    const resilience = run('run-resilience-tests.mjs', ['--scenario', 'offline-conflict'], output);
    assert.equal(resilience.status, 'passed');
    assert.equal(resilience.side_effects, 0);
    const security = run('run-security-tests.mjs', ['--module', 'P6'], output);
    assert.equal(security.status, 'passed');
    assert.equal(security.cross_scope_denials, 2);
    const performance = run('run-performance-tests.mjs', ['--profile', 'release'], output);
    assert.equal(performance.status, 'simulated');
    const planAudit = run('plan-audit.mjs', [], output);
    assert.equal(planAudit.status, 'passed');
    assert.equal(planAudit.counts.task_files, 37);
    assert.equal(planAudit.counts.task_ids_in_module_plans, 37);
    assert.equal(planAudit.counts.task_ids_in_verification_docs, 37);
    assert.equal(planAudit.counts.modules, 9);
    assert.equal(planAudit.counts.contract_edges, 28);
    const evidence = run('evidence-cli.mjs', ['--module', 'P0', '--run-id', 't0-tooling'], output);
    assert.equal(evidence.status, 'passed');
    for (const artifact of [
      'environment.json',
      'seed.json',
      'health.json',
      'trace.jsonl',
      'failure-cases.json',
      'module-verification.yaml',
      'test-summary.txt',
    ]) {
      assert.equal(existsSync(path.join(output, artifact)), true, artifact);
    }
    assert.equal(
      readFileSync(path.join(output, 'evidence-manifest.json'), 'utf8').includes('T0.1'),
      true,
    );
  } finally {
    rmSync(output, { recursive: true, force: true });
  }
});
