import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  runClientSwitchScenario,
  runIntegrationScenario,
  runPlaneToMcpScenario,
} from '@planemem/integration-orchestrator';
import {
  createReleaseManifest,
  preflightRelease,
  planRollback,
  restoreBackup,
  createBackup,
} from '@planemem/release';

test('P8-C01/T8.2 validates the release manifest and deployment topology', () => {
  const manifest = createReleaseManifest({
    version: '0.1.0-rc.1',
    git_sha: 'abc123',
    approved: true,
  });
  const result = preflightRelease(manifest, {
    required_checks: ['contract', 'security', 'restore'],
  });
  assert.equal(result.allowed, true);
  assert.equal(manifest.artifacts.length > 0, true);
  assert.equal(manifest.schema_version, 1);
  assert.match(readFileSync('deploy/compose/docker-compose.yml', 'utf8'), /workctx:/);
  assert.match(
    readFileSync('deploy/helm/planemem/templates/deployment.yaml', 'utf8'),
    /existingSecret/,
  );
});

test('P8-R01/T8.3 live release gate migrates seeded state before continuity restore', () => {
  const releaseRunner = readFileSync('tools/run-release-tests.mjs', 'utf8');
  for (const token of [
    '010_session_continuity_persistence.sql',
    "'/seed/seed.sql'",
    "'session-continuity.restore'",
    "'security.tenant-isolation'",
    'run-security-tests.mjs',
    't4-session-persistence-live.test.ts',
  ]) {
    assert.match(releaseRunner, new RegExp(token.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\$&')));
  }
});

test('P8-E01/T8.1 emits a traceable integration report with fault outcomes', async () => {
  const report = await runIntegrationScenario({
    scenario_id: 'p8-fixture-plane-to-mcp',
    trace_id: 'trace-p8-e2e',
    steps: ['plane.webhook', 'projection.apply', 'context.compile', 'mcp.resource'],
    faults: ['duplicate_event'],
  });
  assert.equal(report.status, 'passed');
  assert.equal(
    report.steps.every((step) => step.source_refs.length > 0),
    true,
  );
  assert.equal(report.faults[0]?.handled, true);
});

test('P8-E01/T8.1 executes Plane event through projection, ContextPack and MCP resource', async () => {
  const result = await runPlaneToMcpScenario({
    scope: {
      tenant_id: '01HF7YAT000000000000000001',
      workspace_id: '01HF7YAT000000000000000002',
      project_id: '01HF7YAT000000000000000003',
    },
    trace_id: 'trace-p8-plane-to-mcp',
    external_project_id: 'plane-project-e2e',
    title: 'Continuity project',
  });

  assert.equal(result.report.status, 'passed');
  assert.deepEqual(
    result.report.steps.map((step) => step.name),
    ['plane.webhook', 'projection.apply', 'context.compile', 'mcp.resource'],
  );
  assert.equal(result.duplicate_event.status, 'duplicate');
  assert.equal(result.observed_state.authority, 'plane');
  assert.equal(result.mcp_resource.trace_id, 'trace-p8-plane-to-mcp');
  assert.match(result.mcp_resource.resource.text, /Continuity project/);
  assert.ok(result.mcp_resource.resource.uri.startsWith('wcp://context/'));
});

test('P8-E02/T8.1 executes Codex checkpoint through Claude handoff and resume', async () => {
  const result = await runClientSwitchScenario({
    scope: {
      tenant_id: '01HF7YAT000000000000000001',
      workspace_id: '01HF7YAT000000000000000002',
      project_id: '01HF7YAT000000000000000003',
    },
    trace_id: 'trace-p8-client-switch',
  });

  assert.equal(result.report.status, 'passed');
  assert.deepEqual(
    result.report.steps.map((step) => step.name),
    ['codex.session', 'memory.capture', 'checkpoint.create', 'handoff.create', 'claude.resume'],
  );
  assert.equal(result.handoff.status, 'claimed');
  assert.equal(result.resumed_session.client_id, 'claude-code');
  assert.equal(result.resumed_session.parent_session_id, result.checkpoint.session_id);
  assert.match(result.memory_ref.page_ref, /^memory:\/\//);
});

test('P8-R01/T8.3 creates and restores a hash-verified backup', () => {
  const backup = createBackup({
    manifest_version: '0.1.0-rc.1',
    files: { 'event.log': 'event-1\nevent-2', 'memory.md': '# memory\nrevision:2' },
  });
  const restored = restoreBackup(backup);
  assert.deepEqual(restored.files, backup.files);
  assert.equal(restored.verified, true);
});

test('P8-R02/T8.3 blocks rollback without approval and plans an approved rollback', () => {
  const denied = planRollback({
    from: '0.1.0',
    to: '0.0.9',
    approved: false,
    trace_id: 'trace-p8-rollback',
  });
  assert.equal(denied.allowed, false);
  const allowed = planRollback({
    from: '0.1.0',
    to: '0.0.9',
    approved: true,
    trace_id: 'trace-p8-rollback',
  });
  assert.equal(allowed.allowed, true);
  assert.equal(allowed.steps.length > 0, true);
});
