import { spawnSync } from 'node:child_process';
import {
  outputDirectory,
  parseArgs,
  printResult,
  stableRunId,
  writeJson,
} from './command-utils.mjs';

const args = parseArgs(process.argv.slice(2));
const output = outputDirectory(args);
const run_id = stableRunId(args, 'identity-audit');
const composePrefix = [
  'compose',
  '-p',
  'planemem-local',
  '-f',
  'deploy/compose/docker-compose.yml',
  '-f',
  'deploy/compose/docker-compose.local-test.yml',
];

export async function runIdentityAuditLiveProbe({
  keycloak_url = process.env.KEYCLOAK_URL ?? 'http://127.0.0.1:8081',
  keycloak_admin = process.env.KEYCLOAK_ADMIN ?? 'admin',
  keycloak_admin_password = process.env.KEYCLOAK_ADMIN_PASSWORD ?? 'change-me',
  runtime_url = process.env.PLANEMEM_URL,
  trace_id = `trace-${run_id}`,
  request = requestJson,
  runtime_request = requestText,
  run_compose = defaultRunCompose,
} = {}) {
  const source_refs = [
    { type: 'live-probe', id: 'keycloak-password-token' },
    { type: 'live-probe', id: 'runtime-audit-emission' },
    { type: 'live-probe', id: 'postgres-audit-storage' },
  ];
  const steps = [];
  const step = (name, status, details = {}) => {
    steps.push({ name, status, trace_id, ...details });
    return status === 'passed';
  };
  const url = String(keycloak_url).replace(/\/$/, '');
  const tokenResponse = await request(`${url}/realms/master/protocol/openid-connect/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-trace-id': trace_id },
    body: new URLSearchParams({
      grant_type: 'password',
      client_id: 'admin-cli',
      username: keycloak_admin,
      password: keycloak_admin_password,
    }).toString(),
  });
  const tokenPayload = tokenResponse.body;
  const tokenPassed =
    tokenResponse.status === 200 &&
    typeof tokenPayload?.access_token === 'string' &&
    tokenPayload.access_token.length > 20 &&
    tokenPayload.token_type === 'Bearer';
  if (
    !step('identity.keycloak.token', tokenPassed ? 'passed' : 'failed', {
      status_code: tokenResponse.status,
      token_type: tokenPayload?.token_type,
      expires_in: tokenPayload?.expires_in,
    })
  ) {
    return result('blocked', steps, source_refs, trace_id, [
      'OPA policy integration',
      'runtime audit persistence',
    ]);
  }

  const tokenClaims = decodeJwtPayload(tokenPayload.access_token);
  if (
    !step(
      'identity.keycloak.claims',
      tokenClaims?.iss && tokenClaims?.azp === 'admin-cli' ? 'passed' : 'failed',
      {
        issuer: tokenClaims?.iss,
        authorized_party: tokenClaims?.azp,
      },
    )
  ) {
    return result('blocked', steps, source_refs, trace_id, [
      'OPA policy integration',
      'runtime audit persistence',
    ]);
  }

  if (runtime_url) {
    const runtimeBase = String(runtime_url).replace(/\/$/, '');
    const runtimeHeaders = {
      'content-type': 'application/json',
      'x-tenant-id': '01HF7YAT000000000000000001',
      'x-workspace-id': '01HF7YAT000000000000000002',
      'x-project-id': '01HF7YAT000000000000000003',
      'x-actor-id': 'identity-audit-live',
      'x-client-id': 'identity-audit-live',
      'x-capability': 'context.read',
      'x-trace-id': `${trace_id}-runtime`,
    };
    const before = await runtime_request(`${runtimeBase}/metrics`, {
      headers: { 'x-trace-id': `${trace_id}-runtime` },
    });
    const beforeCount = parseMetric(before.text, 'planemem_audit_records_total');
    const requestResult = await runtime_request(`${runtimeBase}/v1/context/search`, {
      method: 'POST',
      headers: runtimeHeaders,
      body: JSON.stringify({ query: 'identity-audit-live' }),
    });
    if (
      !step('audit.runtime.request', requestResult.status === 200 ? 'passed' : 'failed', {
        status_code: requestResult.status,
      })
    ) {
      return result('blocked', steps, source_refs, trace_id, [
        'OPA policy integration',
        'runtime audit persistence',
      ]);
    }
    const after = await runtime_request(`${runtimeBase}/metrics`, {
      headers: { 'x-trace-id': `${trace_id}-runtime` },
    });
    const afterCount = parseMetric(after.text, 'planemem_audit_records_total');
    if (
      !step('audit.runtime.emission', afterCount > beforeCount ? 'passed' : 'failed', {
        before_count: beforeCount,
        after_count: afterCount,
      })
    ) {
      return result('blocked', steps, source_refs, trace_id, [
        'OPA policy integration',
        'runtime audit persistence',
      ]);
    }
    const runtimeTrace = `${trace_id}-runtime`.replaceAll("'", "''");
    const persisted = await runSql(
      run_compose,
      `SELECT count(*) FROM wcp_audit_records WHERE trace_id='${runtimeTrace}' AND action='context.search';`,
    );
    const persistedPassed = persisted.status === 0 && persisted.stdout.trim() === '1';
    if (
      !step('audit.runtime.persistence', persistedPassed ? 'passed' : 'failed', {
        stdout: persisted.stdout.trim(),
      })
    ) {
      return result('blocked', steps, source_refs, trace_id, [
        'OPA policy integration',
        'RC audit persistence',
      ]);
    }
    const runtimeCleanup = await runSql(
      run_compose,
      `DELETE FROM wcp_audit_records WHERE trace_id='${runtimeTrace}';`,
    );
    if (
      !step('audit.runtime.cleanup', runtimeCleanup.status === 0 ? 'passed' : 'failed', {
        exit_code: runtimeCleanup.status,
      })
    ) {
      return result('blocked', steps, source_refs, trace_id, [
        'OPA policy integration',
        'RC audit persistence',
      ]);
    }
  }

  const table = await runSql(run_compose, "SELECT to_regclass('public.wcp_audit_records');");
  const tablePassed = table.status === 0 && table.stdout.trim() === 'wcp_audit_records';
  if (!step('audit.table', tablePassed ? 'passed' : 'failed', { stdout: table.stdout.trim() })) {
    return result('blocked', steps, source_refs, trace_id, [
      'OPA policy integration',
      'runtime audit persistence',
    ]);
  }

  const safeRunId = String(run_id).replace(/[^A-Za-z0-9_-]/g, '_');
  const auditId = '01HF7YAT00000000000000A1B';
  const traceValue = `${trace_id}-audit`;
  const insertSql = `INSERT INTO wcp_audit_records (audit_id, tenant_id, workspace_id, project_id, actor_id, client_id, action, resource, result, classification, details, trace_id, source_refs, occurred_at) VALUES ('${auditId}', '01HF7YAT000000000000000001', '01HF7YAT000000000000000002', '01HF7YAT000000000000000003', 'identity-audit-probe', 'identity-audit-live', 'identity.token.issue', 'identity-audit:${safeRunId}', 'allowed', 'internal', '{"source":"identity-audit-live"}'::jsonb, '${traceValue}', '[]'::jsonb, now()) ON CONFLICT (audit_id) DO UPDATE SET trace_id = EXCLUDED.trace_id;`;
  const write = await runSql(run_compose, insertSql);
  if (
    !step('audit.roundtrip.write', write.status === 0 ? 'passed' : 'failed', {
      exit_code: write.status,
    })
  ) {
    return result('blocked', steps, source_refs, trace_id, [
      'OPA policy integration',
      'runtime audit persistence',
    ]);
  }

  const read = await runSql(
    run_compose,
    `SELECT count(*) FROM wcp_audit_records WHERE audit_id='${auditId}' AND trace_id='${traceValue}';`,
  );
  const readPassed = read.status === 0 && read.stdout.trim() === '1';
  if (
    !step('audit.roundtrip.read', readPassed ? 'passed' : 'failed', { stdout: read.stdout.trim() })
  ) {
    await runSql(run_compose, `DELETE FROM wcp_audit_records WHERE audit_id='${auditId}';`);
    return result('blocked', steps, source_refs, trace_id, [
      'OPA policy integration',
      'runtime audit persistence',
    ]);
  }

  const cleanup = await runSql(
    run_compose,
    `DELETE FROM wcp_audit_records WHERE audit_id='${auditId}';`,
  );
  const cleanupPassed = cleanup.status === 0;
  step('audit.roundtrip.cleanup', cleanupPassed ? 'passed' : 'failed', {
    exit_code: cleanup.status,
  });
  const cleanupVerify = await runSql(
    run_compose,
    `SELECT count(*) FROM wcp_audit_records WHERE audit_id='${auditId}';`,
  );
  const cleanupVerified = cleanupVerify.status === 0 && cleanupVerify.stdout.trim() === '0';
  step('audit.roundtrip.cleanup.verify', cleanupVerified ? 'passed' : 'failed', {
    stdout: cleanupVerify.stdout.trim(),
  });
  const status = steps.every((item) => item.status === 'passed') ? 'passed' : 'blocked';
  return {
    status,
    mode: 'live',
    run_id,
    trace_id,
    source_refs,
    measured: true,
    steps,
    storage_scope: 'synthetic PostgreSQL audit row; deleted after verification',
    external_gates: ['OPA policy integration', 'RC audit persistence'],
  };
}

function result(status, steps, source_refs, trace_id, external_gates) {
  return {
    status,
    mode: 'live',
    run_id,
    trace_id,
    source_refs,
    measured: false,
    steps,
    external_gates,
  };
}

async function runSql(run_compose, sql) {
  return run_compose([
    'exec',
    '-T',
    '-e',
    `PGPASSWORD=${process.env.POSTGRES_PASSWORD ?? 'change-me'}`,
    'postgres',
    'psql',
    '-U',
    process.env.POSTGRES_USER ?? 'planemem',
    '-d',
    process.env.POSTGRES_DB ?? 'planemem',
    '-Atc',
    sql,
  ]);
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

async function requestJson(url, options) {
  try {
    const response = await fetch(url, options);
    const text = await response.text();
    let body;
    try {
      body = JSON.parse(text);
    } catch {
      body = undefined;
    }
    return { status: response.status, body };
  } catch (error) {
    return {
      status: undefined,
      body: { error: error instanceof Error ? error.message : String(error) },
    };
  }
}

async function requestText(url, options) {
  try {
    const response = await fetch(url, options);
    const text = await response.text();
    let body;
    try {
      body = JSON.parse(text);
    } catch {
      body = undefined;
    }
    return { status: response.status, body, text };
  } catch (error) {
    return {
      status: undefined,
      body: { error: error instanceof Error ? error.message : String(error) },
      text: '',
    };
  }
}

function parseMetric(text, name) {
  const match = String(text ?? '').match(new RegExp(`^${name}\\s+([0-9]+(?:\\.[0-9]+)?)$`, 'm'));
  return match ? Number(match[1]) : -1;
}

function decodeJwtPayload(token) {
  try {
    const [, encoded] = String(token).split('.');
    if (!encoded) return undefined;
    return JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
  } catch {
    return undefined;
  }
}

if (
  process.argv[1] &&
  new URL(import.meta.url).pathname.endsWith(process.argv[1].replaceAll('\\', '/'))
) {
  if (args.live === true) {
    const liveResult = await runIdentityAuditLiveProbe({
      keycloak_url: args.keycloak_url,
      runtime_url: args.runtime_url ?? process.env.PLANEMEM_URL ?? 'http://127.0.0.1:3000',
      trace_id: `trace-${run_id}`,
    });
    writeJson(output, `${run_id}-identity-audit.json`, liveResult);
    printResult(liveResult);
    if (liveResult.status !== 'passed') process.exitCode = liveResult.status === 'blocked' ? 2 : 1;
  } else {
    const fixture = {
      status: 'passed',
      mode: 'offline-fixture',
      run_id,
      trace_id: `trace-${run_id}`,
      source_refs: [{ type: 'security-fixture', id: 'identity-audit' }],
      external_gates: ['Keycloak', 'OPA', 'audit persistence'],
    };
    writeJson(output, `${run_id}-identity-audit.json`, fixture);
    printResult(fixture);
  }
}
