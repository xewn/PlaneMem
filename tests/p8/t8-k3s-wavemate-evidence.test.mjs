import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '..', '..');
const evidencePath = path.join(
  root,
  'artifacts',
  'test-reports',
  'k3s',
  '20261022T2038-wavemate-ui',
  'manifest.json',
);

test('P8-E06/T8.4 records a reproducible k3s and WaveMate deployment gate', () => {
  const evidence = JSON.parse(readFileSync(evidencePath, 'utf8'));
  assert.equal(evidence.status, 'passed');
  assert.equal(evidence.cluster.distribution, 'k3s');
  assert.deepEqual(
    evidence.cluster.nodes.map((node) => node.status),
    ['Ready', 'Ready', 'Ready'],
  );
  assert.equal(evidence.release.status, 'deployed');
  assert.equal(evidence.release.revision, 22);
  assert.equal(evidence.release.replicas, 3);
  assert.match(
    evidence.offline_image.digest_alias,
    /^docker\.io\/library\/planemem-platform@sha256:[0-9a-f]{64}$/,
  );
  assert.equal(evidence.offline_image.nodes_imported.length, 3);
  assert.equal(evidence.platform_probe.status, 'passed');
  assert.equal(evidence.platform_probe.steps, 12);
  assert.equal(evidence.remote_status.status, 'passed');
  assert.equal(evidence.remote_status.nodes, 3);
  assert.equal(evidence.remote_status.ready_replicas, 3);
  assert.equal(evidence.remote_status.rollout, 'successfully rolled out');
  const remoteStatus = JSON.parse(
    readFileSync(path.join(root, evidence.remote_status.report), 'utf8'),
  );
  assert.equal(remoteStatus.helm.revision, 22);
  assert.equal(remoteStatus.helm.status, 'deployed');
  assert.equal(evidence.node_recovery.status, 'passed');
  assert.equal(evidence.node_recovery.node, 'hdserver2');
  assert.equal(evidence.node_recovery.rollout, 'passed');
  assert.equal(evidence.node_recovery.uncordon, 'passed');
  assert.equal(evidence.node_recovery.nodes_ready, 3);
  assert.equal(evidence.node_recovery.replicas_ready, 3);
  const recoveryProbe = JSON.parse(
    readFileSync(path.join(root, evidence.node_recovery.platform_probe), 'utf8'),
  );
  assert.equal(recoveryProbe.status, 'passed');
  assert.equal(recoveryProbe.steps.length, 12);
  assert.equal(evidence.wavemate_probe.status, 'passed');
  assert.equal(evidence.wavemate_probe.traffic.jsonrpc_errors, 0);
  assert.equal(evidence.wavemate_probe.traffic.server_discover, 1);
  assert.equal(evidence.wavemate_probe.traffic.initialize, 1);
  assert.equal(evidence.wavemate_probe.traffic.initialized_notification, 1);
  assert.equal(evidence.wavemate_ui_probe.status, 'passed');
  assert.equal(evidence.wavemate_ui_probe.traffic.tools_call, 1);
  assert.equal(evidence.wavemate_ui_probe.traffic.successful_responses, 5);
  assert.equal(evidence.wavemate_ui_probe.traffic.jsonrpc_errors, 0);
  assert.equal(evidence.wavemate_ui_probe.ui.prompt_visible, true);
  assert.equal(evidence.wavemate_ui_probe.ui.completed_visible, true);
  assert.equal(evidence.wavemate_ui_probe.ui.matched_result, true);
  assert.equal(evidence.wavemate_ui_probe.ui.matched_trace, true);
  assert.deepEqual(evidence.wavemate_ui_probe.external_gates, []);
  assert.equal(
    evidence.wavemate_ui_probe.post_test_restore,
    'artifacts/command-reports/wavemate-k3s-ui-retry1/restore-verification.json',
  );
  const restorePath = path.join(root, evidence.wavemate_ui_probe.post_test_restore);
  const restore = JSON.parse(readFileSync(restorePath, 'utf8'));
  assert.equal(restore.configured_url, 'http://127.0.0.1:3000/mcp');
  assert.equal(restore.restart_needed, false);
  const negativePath = path.join(
    root,
    'artifacts',
    'test-reports',
    'k3s',
    '20261022T2038-wavemate-ui',
    'wavemate-ui-negative-attempt.json',
  );
  const negative = JSON.parse(readFileSync(negativePath, 'utf8'));
  assert.equal(negative.status, 'blocked');
  assert.equal(negative.traffic.tools_call, 0);
  assert.equal(evidence.wavemate_ui_repeat_probe.status, 'passed');
  assert.equal(evidence.wavemate_ui_repeat_probe.traffic.tools_call, 1);
  assert.equal(evidence.wavemate_ui_repeat_probe.traffic.successful_responses, 5);
  assert.equal(evidence.wavemate_ui_repeat_probe.traffic.jsonrpc_errors, 0);
  assert.equal(evidence.wavemate_ui_repeat_probe.ui.prompt_visible, true);
  assert.equal(evidence.wavemate_ui_repeat_probe.ui.completed_visible, true);
  assert.equal(evidence.wavemate_ui_repeat_probe.ui.matched_result, true);
  assert.equal(evidence.wavemate_ui_repeat_probe.ui.matched_trace, true);
  const repeatRestore = JSON.parse(
    readFileSync(path.join(root, evidence.wavemate_ui_repeat_probe.post_test_restore), 'utf8'),
  );
  assert.equal(repeatRestore.status, 'passed');
  assert.equal(repeatRestore.configured_url, 'http://127.0.0.1:3000/mcp');
  assert.equal(repeatRestore.restart_needed, false);
  assert.equal(evidence.wavemate_ui_negative_repeat.status, 'blocked');
  assert.equal(evidence.wavemate_ui_negative_repeat.traffic.tools_call, 0);
  assert.equal(
    evidence.wavemate_ui_negative_repeat.post_test_restore.endsWith('restore-verification.json'),
    true,
  );
  const negativeRestore = JSON.parse(
    readFileSync(path.join(root, evidence.wavemate_ui_negative_repeat.post_test_restore), 'utf8'),
  );
  assert.equal(negativeRestore.status, 'passed');
  assert.equal(negativeRestore.configured_url, 'http://127.0.0.1:3000/mcp');
  assert.equal(evidence.wavemate_ui_latest_probe.status, 'passed');
  assert.equal(evidence.wavemate_ui_latest_probe.traffic.tools_call, 1);
  assert.equal(evidence.wavemate_ui_latest_probe.traffic.successful_responses, 5);
  assert.equal(evidence.wavemate_ui_latest_probe.traffic.jsonrpc_errors, 0);
  assert.equal(evidence.wavemate_ui_latest_probe.ui.prompt_visible, true);
  assert.equal(evidence.wavemate_ui_latest_probe.ui.completed_visible, true);
  assert.equal(evidence.wavemate_ui_latest_probe.ui.matched_result, true);
  assert.equal(evidence.wavemate_ui_latest_probe.ui.matched_trace, true);
  assert.deepEqual(evidence.wavemate_ui_latest_probe.external_gates, []);
  const latestRestore = JSON.parse(
    readFileSync(path.join(root, evidence.wavemate_ui_latest_probe.post_test_restore), 'utf8'),
  );
  assert.equal(latestRestore.status, 'passed');
  assert.equal(latestRestore.configured_url, 'http://127.0.0.1:3000/mcp');
  assert.equal(latestRestore.restart_needed, false);
  assert.equal(evidence.wavemate_e2e_gate.status, 'passed');
  assert.equal(evidence.wavemate_e2e_gate.client, 'wavemate');
  assert.equal(evidence.wavemate_e2e_gate.platform_steps, 12);
  assert.equal(evidence.wavemate_e2e_gate.wavemate_tools_call, 1);
  assert.equal(evidence.wavemate_e2e_gate.wavemate_successful_responses, 5);
  assert.deepEqual(evidence.wavemate_e2e_gate.external_gates, []);
  assert.equal(evidence.wavemate_e2e_gate.wavemate_checks.runtime_matches, true);
  assert.equal(evidence.wavemate_e2e_gate.wavemate_checks.restore_status, true);
  assert.equal(evidence.wavemate_e2e_gate.wavemate_checks.restore_url, true);
  const sbom = JSON.parse(
    readFileSync(
      path.join(root, 'artifacts', 'command-reports', 'sbom-wavemate-current4', 'sbom.cdx.json'),
      'utf8',
    ),
  );
  assert.equal(sbom.bomFormat, 'CycloneDX');
  assert.equal(sbom.components.length, 26);
  const vulnerabilityScan = JSON.parse(
    readFileSync(
      path.join(root, 'artifacts', 'command-reports', 'trivy-wavemate-current4', 'summary.json'),
      'utf8',
    ),
  );
  assert.equal(vulnerabilityScan.status, 'passed');
  assert.equal(vulnerabilityScan.scanner_version, '0.58.1');
  assert.equal(vulnerabilityScan.result.vulnerability_count, 0);
  assert.equal(vulnerabilityScan.result.critical, 0);
  assert.equal(vulnerabilityScan.result.high, 0);
  const dependencyScan = JSON.parse(
    readFileSync(
      path.join(root, 'artifacts', 'command-reports', 'trivy-images-current4', 'summary.json'),
      'utf8',
    ),
  );
  assert.equal(dependencyScan.status, 'blocked');
  assert.equal(dependencyScan.image_count, 10);
  assert.equal(
    dependencyScan.images.find((image) => image.artifact === 'planemem-platform:0.1.0-wavemate')
      .vulnerability_count,
    0,
  );
  assert.equal(
    dependencyScan.images.some((image) => image.vulnerability_count > 0),
    true,
  );
  const commandDependencyScan = JSON.parse(
    readFileSync(
      path.join(
        root,
        'artifacts',
        'command-reports',
        'p8-vulnerability-scan-command-current2',
        'summary.json',
      ),
      'utf8',
    ),
  );
  assert.equal(commandDependencyScan.status, 'blocked');
  assert.equal(commandDependencyScan.image_count, 10);
  assert.equal(
    commandDependencyScan.images.every((image) => image.image_id),
    true,
  );
  assert.equal(
    commandDependencyScan.images.some((image) => image.vulnerability_count > 0),
    true,
  );
  const remediation = JSON.parse(
    readFileSync(
      path.join(
        root,
        'artifacts',
        'command-reports',
        'p8-vulnerability-scan-command-current2',
        'remediation.json',
      ),
      'utf8',
    ),
  );
  assert.equal(remediation.images.length, 10);
  assert.equal(
    remediation.images.some((image) => image.top_remediation_packages.length > 0),
    true,
  );
  const dependencyMatrix = JSON.parse(
    readFileSync(
      path.join(
        root,
        'artifacts',
        'command-reports',
        'p8-dependency-matrix-current',
        'p8-dependency-matrix-current-resilience.json',
      ),
      'utf8',
    ),
  );
  assert.equal(dependencyMatrix.status, 'passed');
  assert.equal(dependencyMatrix.scenario, 'dependency-matrix');
  assert.equal(dependencyMatrix.services.length, 8);
  assert.equal(
    dependencyMatrix.services.every((service) => service.status === 'passed'),
    true,
  );
  assert.equal(dependencyMatrix.recovery_verified, true);
  for (const [runId, scenario] of [
    ['p8-process-kill-current', 'process-kill'],
    ['p8-network-partition-current4', 'network-partition'],
    ['p8-business-recovery-current2', 'business-recovery'],
  ]) {
    const resilience = JSON.parse(
      readFileSync(
        path.join(root, 'artifacts', 'command-reports', runId, `${runId}-resilience.json`),
        'utf8',
      ),
    );
    assert.equal(resilience.status, 'passed');
    assert.equal(resilience.scenario, scenario);
    assert.equal(resilience.recovery_verified, true);
  }
});
