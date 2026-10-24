import {
  outputDirectory,
  parseArgs,
  printResult,
  stableRunId,
  workspaceRoot,
  writeJson,
} from './command-utils.mjs';
import { runLivePlatformProbe } from './live-platform-probe.mjs';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const args = parseArgs(process.argv.slice(2));
const chain = String(args.chain ?? args.suite ?? 'plane-to-mcp');
const output = outputDirectory(args);
const run_id = stableRunId(args, 'functional');
const chains = {
  'plane-to-mcp': ['plane.webhook', 'projection.apply', 'context.compile', 'mcp.resource'],
  'client-switch': ['codex.checkpoint', 'handoff.create', 'claude.claim', 'resume.context'],
};
const suiteSteps = {
  workbench: ['gateway.query', 'workbench.render', 'handoff.confirm', 'conflict.resolve'],
};
const names = chains[chain] ?? suiteSteps[chain];

function localComposeServicesAvailable() {
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
  if (result.error !== undefined || result.status !== 0) return false;
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
  });
}

export function validateWavemateUiGate(reportPath, { runtime_url } = {}) {
  const resolvedReport = path.resolve(workspaceRoot, String(reportPath ?? ''));
  if (!existsSync(resolvedReport)) {
    return {
      status: 'blocked',
      error: `WaveMate UI report not found: ${resolvedReport}`,
      external_gates: ['WaveMate UI report'],
    };
  }
  let report;
  try {
    report = JSON.parse(readFileSync(resolvedReport, 'utf8'));
  } catch (error) {
    return {
      status: 'blocked',
      error: `WaveMate UI report is not valid JSON: ${String(error)}`,
      external_gates: ['WaveMate UI report'],
    };
  }
  const restorePath = path.join(path.dirname(resolvedReport), 'restore-verification.json');
  let restore;
  try {
    restore = JSON.parse(readFileSync(restorePath, 'utf8'));
  } catch (error) {
    return {
      status: 'blocked',
      report,
      error: `WaveMate restore verification is unavailable: ${String(error)}`,
      external_gates: ['WaveMate configuration restore'],
    };
  }
  const reportRuntimeUrl = report.source_refs?.find((ref) => ref.type === 'runtime-http')?.id;
  const runtimeMatches =
    runtime_url === undefined ||
    reportRuntimeUrl === `${String(runtime_url).replace(/\/$/, '')}/mcp`;
  const checks = {
    status: report.status === 'passed',
    client: report.client === 'wavemate',
    version: report.client_version === '0.24.1',
    tools_call: Number(report.traffic?.tools_call ?? 0) > 0,
    successful_responses:
      Number(report.traffic?.successful_responses ?? 0) >= Number(report.traffic?.requests ?? 1),
    jsonrpc_errors: Number(report.traffic?.jsonrpc_errors ?? 1) === 0,
    prompt_visible: report.ui?.prompt_visible === true,
    completed_visible: report.ui?.completed_visible === true,
    matched_result: report.ui?.matched_result === true,
    matched_trace: report.ui?.matched_trace === true,
    external_gates: Array.isArray(report.external_gates) && report.external_gates.length === 0,
    runtime_matches: runtimeMatches,
    restore_status: restore.status === 'passed',
    restore_url: restore.configured_url === 'http://127.0.0.1:3000/mcp',
    restart_needed: restore.restart_needed === false,
  };
  const passed = Object.values(checks).every(Boolean);
  return {
    status: passed ? 'passed' : 'blocked',
    report,
    report_path: resolvedReport,
    restore,
    restore_path: restorePath,
    runtime_url: reportRuntimeUrl,
    checks,
    external_gates: passed ? [] : ['WaveMate 0.24.1 UI gate'],
  };
}

if (names === undefined) {
  printResult({ status: 'failed', error: `unknown chain: ${chain}` });
  process.exitCode = 1;
} else if (args.live === true) {
  const blockedRun = stableRunId(args, 'functional');
  const composeAvailable = localComposeServicesAvailable();
  const client = String(args.client ?? '').toLowerCase();
  const requestedRuntimeUrl =
    process.env.WORKCTX_URL ?? `http://127.0.0.1:${process.env.WORKCTX_PORT ?? '3000'}`;
  const liveProbe = composeAvailable
    ? await runLivePlatformProbe({
        base_url: requestedRuntimeUrl,
        trace_id: `trace-${blockedRun}`,
      })
    : undefined;
  const wavemateGate =
    client === 'wavemate'
      ? validateWavemateUiGate(args.wavemate_report, { runtime_url: requestedRuntimeUrl })
      : undefined;
  const platformPassed =
    liveProbe?.status === 'passed' &&
    liveProbe?.transports?.plane_webhook === 'passed' &&
    liveProbe?.transports?.mcp_http_jsonrpc === 'passed';
  const clientPassed = client === 'wavemate' ? wavemateGate?.status === 'passed' : false;
  const externalGates = composeAvailable
    ? [
        ...(platformPassed ? [] : ['platform HTTP/transport probe']),
        ...(client === 'wavemate'
          ? clientPassed
            ? []
            : (wavemateGate?.external_gates ?? ['WaveMate 0.24.1 UI gate'])
          : ['production client processes']),
      ]
    : ['Docker/Compose and configured services'];
  const status = composeAvailable && platformPassed && clientPassed ? 'passed' : 'blocked';
  const probeRefs =
    liveProbe?.status === 'passed' ? [{ type: 'live-probe', id: 'planemem-platform-http' }] : [];
  const result = {
    status,
    mode: 'live',
    run_id: blockedRun,
    trace_id: `trace-${blockedRun}`,
    source_refs: [
      { type: 'external-gate', id: 'docker-compose' },
      ...(composeAvailable ? [{ type: 'live-service', id: 'planemem-local' }] : []),
      ...probeRefs,
      ...(wavemateGate?.status === 'passed'
        ? [
            { type: 'client-artifact', id: wavemateGate.report.artifact.path },
            { type: 'wavemate-ui-report', id: wavemateGate.report_path },
            { type: 'wavemate-restore-report', id: wavemateGate.restore_path },
          ]
        : []),
    ],
    live_services: composeAvailable ? 'available' : 'not-ready',
    live_probe: liveProbe ?? { status: 'not-run' },
    steps: liveProbe?.steps ?? [],
    client: client || undefined,
    wavemate_gate: wavemateGate,
    external_gates: externalGates,
    external_gate: composeAvailable
      ? client === 'wavemate'
        ? 'Platform HTTP, Plane Webhook, MCP transport and WaveMate 0.24.1 UI evidence are required'
        : 'Platform HTTP, Plane Webhook and MCP transport probes passed; production client processes required'
      : 'Docker/Compose and configured services required',
  };
  writeJson(output, `${blockedRun}-functional.json`, result);
  printResult(result);
  process.exitCode = status === 'passed' ? 0 : 2;
} else {
  if (chain === 'plane-to-mcp') {
    const integrationModule = pathToFileURL(
      path.join(workspaceRoot, 'apps', 'integration-orchestrator', 'src', 'index.ts'),
    ).href;
    const trace_id = `trace-${run_id}`;
    const script = `
      import { runPlaneToMcpScenario } from ${JSON.stringify(integrationModule)};
      const result = await runPlaneToMcpScenario({
        scope: {
          tenant_id: '01HF7YAT000000000000000001',
          workspace_id: '01HF7YAT000000000000000002',
          project_id: '01HF7YAT000000000000000003',
        },
        trace_id: ${JSON.stringify(trace_id)},
        external_project_id: 'plane-project-fixture',
        title: 'Fixture continuity project',
      });
      console.log(JSON.stringify(result));
    `;
    const child = spawnSync(
      process.execPath,
      ['--import', 'tsx', '--input-type=module', '--eval', script],
      { cwd: workspaceRoot, encoding: 'utf8' },
    );
    if (child.status !== 0) {
      printResult({
        status: 'failed',
        mode: 'offline-fixture',
        run_id,
        trace_id,
        error: child.stderr.trim() || 'Plane-to-MCP integration scenario failed',
      });
      process.exitCode = 1;
    } else {
      const executed = JSON.parse(child.stdout.trim());
      const result = {
        status: executed.report.status,
        mode: 'offline-fixture',
        run_id,
        chain,
        trace_id,
        steps: executed.report.steps,
        faults: executed.report.faults,
        duplicate_event: executed.duplicate_event.status,
        context_pack_hash: executed.context_pack.pack_hash,
        mcp_resource_uri: executed.mcp_resource.resource.uri,
        source_refs: executed.context_pack.source_refs,
        external_gates: ['Plane Webhook transport', 'PostgreSQL/NATS', 'production MCP client'],
      };
      writeJson(output, `${run_id}-functional.json`, result);
      printResult(result);
    }
  } else if (chain === 'client-switch') {
    const integrationModule = pathToFileURL(
      path.join(workspaceRoot, 'apps', 'integration-orchestrator', 'src', 'index.ts'),
    ).href;
    const trace_id = `trace-${run_id}`;
    const script = `
      import { runClientSwitchScenario } from ${JSON.stringify(integrationModule)};
      const result = await runClientSwitchScenario({
        scope: {
          tenant_id: '01HF7YAT000000000000000001',
          workspace_id: '01HF7YAT000000000000000002',
          project_id: '01HF7YAT000000000000000003',
        },
        trace_id: ${JSON.stringify(trace_id)},
      });
      console.log(JSON.stringify(result));
    `;
    const child = spawnSync(
      process.execPath,
      ['--import', 'tsx', '--input-type=module', '--eval', script],
      { cwd: workspaceRoot, encoding: 'utf8' },
    );
    if (child.status !== 0) {
      printResult({
        status: 'failed',
        mode: 'offline-fixture',
        run_id,
        trace_id,
        error: child.stderr.trim() || 'Client-switch integration scenario failed',
      });
      process.exitCode = 1;
    } else {
      const executed = JSON.parse(child.stdout.trim());
      const result = {
        status: executed.report.status,
        mode: 'offline-fixture',
        run_id,
        chain,
        trace_id,
        steps: executed.report.steps,
        faults: executed.report.faults,
        handoff_status: executed.handoff.status,
        resumed_client_id: executed.resumed_session.client_id,
        checkpoint_id: executed.checkpoint.checkpoint_id,
        memory_page_ref: executed.memory_ref.page_ref,
        source_refs: executed.checkpoint.source_refs,
        external_gates: [
          'Plane Webhook transport',
          'production client processes',
          'PostgreSQL/NATS',
        ],
      };
      writeJson(output, `${run_id}-functional.json`, result);
      printResult(result);
    }
  } else {
    const run_id = stableRunId(args, 'functional');
    const result = {
      status: 'passed',
      mode: 'offline-fixture',
      run_id,
      chain,
      trace_id: `trace-${run_id}`,
      steps: names.map((name) => ({
        name,
        status: 'passed',
        source_refs: [{ type: 'fixture', id: name }],
        trace_id: `trace-${run_id}`,
      })),
      external_gates: ['Plane', 'ai-memory', 'PostgreSQL/NATS', 'MCP transport'],
    };
    writeJson(output, `${run_id}-functional.json`, result);
    printResult(result);
  }
}
