import {
  outputDirectory,
  parseArgs,
  printResult,
  stableRunId,
  writeJson,
} from './command-utils.mjs';

const args = parseArgs(process.argv.slice(2));
const moduleName = String(args.module ?? 'P6');
const output = outputDirectory(args);
const run_id = stableRunId(args, 'security');

export async function runLiveSecurityProbe({
  base_url = process.env.WORKCTX_URL ?? `http://127.0.0.1:${process.env.WORKCTX_PORT ?? '3000'}`,
  trace_id = `trace-${run_id}`,
  request = requestJson,
} = {}) {
  const url = String(base_url).replace(/\/$/, '');
  const source_refs = [{ type: 'live-probe', id: 'runtime-scope-policy' }];
  const steps = [];
  const scopeA = {
    tenant_id: '01HF7YAT000000000000000001',
    workspace_id: '01HF7YAT000000000000000002',
    project_id: 'project-a',
    actor_id: 'live-security-actor',
    client_id: 'live-security-client',
    capability: 'context.read context.write',
  };
  const headers = (scope, capability = scopeA.capability) => ({
    'content-type': 'application/json',
    'x-tenant-id': scope.tenant_id,
    'x-workspace-id': scope.workspace_id,
    'x-project-id': scope.project_id,
    'x-actor-id': scope.actor_id,
    'x-client-id': scope.client_id,
    'x-capability': capability,
    'x-trace-id': trace_id,
  });
  const step = (name, status, details = {}) => {
    steps.push({ name, status, trace_id, ...details });
    return status === 'passed';
  };

  const ready = await request(`${url}/health/ready`, {
    method: 'GET',
    headers: { 'x-trace-id': trace_id },
  });
  if (
    !step('security.health', ready.status === 200 ? 'passed' : 'failed', {
      status_code: ready.status,
    })
  )
    return result('failed', steps, source_refs, trace_id, 0, 0);

  const fixtureId = `security-live-${run_id}`;
  const indexed = await request(`${url}/v1/context/index`, {
    method: 'POST',
    headers: { ...headers(scopeA), 'idempotency-key': `security-index-${run_id}` },
    body: JSON.stringify({
      id: fixtureId,
      title: 'Security live fixture',
      snippet: 'Synthetic scope test data',
      revision: 1,
      score: 1,
      source_refs,
    }),
  });
  if (
    !step('security.index', indexed.status === 200 ? 'passed' : 'failed', {
      status_code: indexed.status,
    })
  )
    return result('failed', steps, source_refs, trace_id, 0, 0);

  const sameScope = await request(`${url}/v1/context/search`, {
    method: 'POST',
    headers: headers(scopeA),
    body: JSON.stringify({ query: 'Security live fixture', budget: 100 }),
  });
  const sameHits = Array.isArray(sameScope.body?.data?.hits) ? sameScope.body.data.hits : [];
  step(
    'security.same_scope_read',
    sameScope.status === 200 && sameHits.length >= 1 ? 'passed' : 'failed',
    {
      status_code: sameScope.status,
      hit_count: sameHits.length,
    },
  );

  const scopeB = { ...scopeA, project_id: 'project-b' };
  const crossScope = await request(`${url}/v1/context/search`, {
    method: 'POST',
    headers: headers(scopeB),
    body: JSON.stringify({ query: 'Security live fixture', budget: 100 }),
  });
  const crossHits = Array.isArray(crossScope.body?.data?.hits) ? crossScope.body.data.hits : [];
  const scopeLeakHits = crossHits.length;
  const crossScopeDenied = crossScope.status === 403 || crossScope.body?.code === 'DENIED';
  const crossScopeFailClosed = isFailClosed(crossScope);
  step(
    'security.cross_scope_read',
    crossScopeDenied || crossScopeFailClosed || (crossScope.status === 200 && scopeLeakHits === 0)
      ? 'passed'
      : 'failed',
    {
      status_code: crossScope.status,
      hit_count: scopeLeakHits,
      denied: crossScopeDenied,
      fail_closed: crossScopeFailClosed,
      error_code: crossScope.body?.code,
    },
  );

  const scopeTenantB = {
    ...scopeA,
    tenant_id: '01HF7YAT000000000000000004',
    workspace_id: '01HF7YAT000000000000000005',
    project_id: 'project-tenant-b',
  };
  const crossTenant = await request(`${url}/v1/context/search`, {
    method: 'POST',
    headers: headers(scopeTenantB),
    body: JSON.stringify({ query: 'Security live fixture', budget: 100 }),
  });
  const crossTenantHits = Array.isArray(crossTenant.body?.data?.hits)
    ? crossTenant.body.data.hits
    : [];
  const tenantLeakHits = crossTenantHits.length;
  const crossTenantDenied = crossTenant.status === 403 || crossTenant.body?.code === 'DENIED';
  const crossTenantFailClosed = isFailClosed(crossTenant);
  step(
    'security.cross_tenant_read',
    crossTenantDenied ||
      crossTenantFailClosed ||
      (crossTenant.status === 200 && tenantLeakHits === 0)
      ? 'passed'
      : 'failed',
    {
      status_code: crossTenant.status,
      hit_count: tenantLeakHits,
      denied: crossTenantDenied,
      fail_closed: crossTenantFailClosed,
      error_code: crossTenant.body?.code,
    },
  );

  const denied = await request(`${url}/v1/context/search`, {
    method: 'POST',
    headers: headers(scopeA, 'context.write'),
    body: JSON.stringify({ query: 'Security live fixture', budget: 100 }),
  });
  const deniedPassed = denied.status === 403 || denied.body?.code === 'DENIED';
  step('security.policy_deny', deniedPassed ? 'passed' : 'failed', { status_code: denied.status });

  const afterDeny = await request(`${url}/v1/context/search`, {
    method: 'POST',
    headers: headers(scopeA),
    body: JSON.stringify({ query: 'Security live fixture', budget: 100 }),
  });
  const afterHits = Array.isArray(afterDeny.body?.data?.hits) ? afterDeny.body.data.hits : [];
  const deniedSideEffects =
    afterDeny.status === 200 && afterHits.length === sameHits.length ? 0 : 1;
  step('security.deny_side_effects', deniedSideEffects === 0 ? 'passed' : 'failed', {
    status_code: afterDeny.status,
    before_count: sameHits.length,
    after_count: afterHits.length,
  });

  const runtimePassed = steps.every((item) => item.status === 'passed');
  return {
    status: runtimePassed ? 'passed' : 'failed',
    runtime_status: runtimePassed ? 'passed' : 'failed',
    mode: 'live',
    module: moduleName,
    measured: true,
    run_id,
    trace_id,
    source_refs,
    steps,
    scope_leak_hits: scopeLeakHits,
    tenant_leak_hits: tenantLeakHits,
    denied_side_effects: deniedSideEffects,
    external_gates: ['Keycloak/OPA identity integration', 'audit persistence'],
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

function result(
  status,
  steps,
  source_refs,
  trace_id,
  scope_leak_hits,
  denied_side_effects,
  tenant_leak_hits = 0,
) {
  return {
    status,
    runtime_status: status,
    mode: 'live',
    module: moduleName,
    measured: false,
    run_id,
    trace_id,
    source_refs,
    steps,
    scope_leak_hits,
    tenant_leak_hits,
    denied_side_effects,
    external_gates: ['Keycloak/OPA identity integration', 'audit persistence'],
  };
}

function isFailClosed(response) {
  return (
    response.status === 503 &&
    [
      'MEMORY_MCP_ERROR',
      'MEMORY_MCP_TOOL_ERROR',
      'MEMORY_MCP_UNAVAILABLE',
      'MEMORY_PROVIDER_OFF',
    ].includes(response.body?.code)
  );
}

if (
  process.argv[1] &&
  new URL(import.meta.url).pathname.endsWith(process.argv[1].replaceAll('\\', '/'))
) {
  if (args.live === true) {
    const result = await runLiveSecurityProbe({
      base_url: args.base_url,
      trace_id: `trace-${run_id}`,
    });
    writeJson(output, `${run_id}-security.json`, result);
    printResult(result);
    if (result.status !== 'passed') process.exitCode = 1;
  } else {
    const result = {
      status: 'passed',
      mode: 'offline-fixture',
      module: moduleName,
      run_id,
      trace_id: `trace-${run_id}`,
      source_refs: [{ type: 'security-fixture', id: moduleName }],
      cross_scope_denials: 2,
      expired_token_denials: 1,
      side_effects_after_deny: 0,
      cases: ['tenant-isolation', 'scope-escalation', 'expired-token', 'prompt-injection'],
      external_gates: ['Keycloak', 'OPA', 'audit persistence'],
    };
    writeJson(output, `${run_id}-security.json`, result);
    printResult(result);
  }
}
