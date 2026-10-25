import {
  outputDirectory,
  parseArgs,
  printResult,
  stableRunId,
  writeJson,
} from './command-utils.mjs';

const args = parseArgs(process.argv.slice(2));
const run_id = stableRunId(args, 'realistic-workbench');
const phase = String(args.phase ?? 'baseline');
const output = outputDirectory(args);
const baseUrl = String(args.url ?? process.env.WORKBENCH_URL ?? 'http://127.0.0.1:33000').replace(
  /\/$/,
  '',
);
const scope = {
  tenant_id: String(
    args.tenant_id ?? process.env.WORKBENCH_TENANT_ID ?? '01HF7YAT000000000000000001',
  ),
  workspace_id: String(
    args.workspace_id ?? process.env.WORKBENCH_WORKSPACE_ID ?? '01HF7YAT000000000000000002',
  ),
  project_id: String(
    args.project_id ?? process.env.WORKBENCH_PROJECT_ID ?? '01HF7YAT000000000000000003',
  ),
};
const token = String(args.token ?? process.env.WORKBENCH_TOKEN ?? 'smoke-probe');
const headers = {
  authorization: `Bearer ${token}`,
  'content-type': 'application/json',
  'x-tenant-id': scope.tenant_id,
  'x-workspace-id': scope.workspace_id,
  'x-project-id': scope.project_id,
  'x-actor-id': 'realistic-workbench-acceptance',
  'x-client-id': 'realistic-workbench-acceptance',
  'x-capability': 'workbench.read context.read audit.read',
  'x-role': 'admin',
  'x-token-expires-at': '2099-01-01T00:00:00.000Z',
};

const steps = [];
const observed = {};
const expected = {
  phase,
  overview: {
    active_work_items: 11,
    blocked_work_items: phase === 'transition' ? 1 : 2,
    completed_work_items: 3,
    active_sessions: 3,
    open_conflicts: phase === 'transition' ? 2 : 3,
  },
  work_items: 15,
  context: 10,
  sessions: 6,
  handoffs: 4,
  conflicts: {
    total: 4,
    open: phase === 'transition' ? 2 : 3,
    resolved: phase === 'transition' ? 2 : 1,
  },
  audit_fixture_rows: 14,
  admin: { active_sessions: 3, open_conflicts: phase === 'transition' ? 2 : 3 },
};

function record(name, passed, details = {}) {
  steps.push({ name, status: passed ? 'passed' : 'failed', ...details });
  if (!passed) throw new Error(`${name} failed${details.reason ? `: ${details.reason}` : ''}`);
}

function hasPostgresEnvelope(payload) {
  return (
    Array.isArray(payload?.source_refs) &&
    payload.source_refs.some((reference) => reference?.type === 'postgres')
  );
}

function assertRowsHaveRefs(rows, name) {
  const missing = rows.filter(
    (row) => !Array.isArray(row.source_refs) || row.source_refs.length === 0,
  );
  record(`${name}.source_refs`, missing.length === 0, {
    rows: rows.length,
    missing: missing.length,
  });
}

async function query(operation, input = {}, requestScope = scope) {
  const response = await fetch(`${baseUrl}/v1/workbench/query`, {
    method: 'POST',
    headers: {
      ...headers,
      'x-tenant-id': requestScope.tenant_id,
      'x-workspace-id': requestScope.workspace_id,
      'x-project-id': requestScope.project_id,
      'x-trace-id': `${run_id}-${operation}`,
    },
    body: JSON.stringify({ operation, ...input }),
  });
  const text = await response.text();
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    payload = { raw: text };
  }
  return { status: response.status, payload };
}

try {
  const overview = await query('overview');
  record('overview.http', overview.status === 200, { status_code: overview.status });
  record('overview.source_refs', hasPostgresEnvelope(overview.payload), {
    source_refs: overview.payload?.source_refs,
  });
  observed.overview = overview.payload?.data;
  for (const [field, value] of Object.entries(expected.overview)) {
    record(`overview.${field}`, observed.overview?.[field] === value, {
      expected: value,
      actual: observed.overview?.[field],
    });
  }

  const workItems = await query('work_items');
  const workRows = Array.isArray(workItems.payload?.data) ? workItems.payload.data : [];
  record('work_items.http', workItems.status === 200, { status_code: workItems.status });
  record('work_items.count', workRows.length === expected.work_items, {
    expected: expected.work_items,
    actual: workRows.length,
  });
  record(
    'work_items.realistic_fixture',
    workRows.some((row) => row.external_id === 'W-134') &&
      workRows.some((row) => row.external_id === 'W-140'),
    { ids: workRows.map((row) => row.external_id) },
  );
  assertRowsHaveRefs(workRows, 'work_items');
  observed.work_items = {
    total: workRows.length,
    by_status: Object.fromEntries(
      [...new Set(workRows.map((row) => String(row.status)))].map((status) => [
        status,
        workRows.filter((row) => row.status === status).length,
      ]),
    ),
  };

  const context = await query('context');
  const contextRows = Array.isArray(context.payload?.data) ? context.payload.data : [];
  record('context.http', context.status === 200, { status_code: context.status });
  record('context.count', contextRows.length === expected.context, {
    expected: expected.context,
    actual: contextRows.length,
  });
  record(
    'context.layers',
    ['L0', 'L1', 'L2', 'L3', 'L4'].every((layer) => contextRows.some((row) => row.layer === layer)),
    { layers: [...new Set(contextRows.map((row) => row.layer))] },
  );
  record(
    'context.proposed_and_expired',
    contextRows.some((row) => row.status === 'proposed') &&
      contextRows.some((row) => row.status === 'expired'),
    {},
  );
  assertRowsHaveRefs(contextRows, 'context');
  observed.context = {
    total: contextRows.length,
    by_layer: Object.fromEntries(
      ['L0', 'L1', 'L2', 'L3', 'L4'].map((layer) => [
        layer,
        contextRows.filter((row) => row.layer === layer).length,
      ]),
    ),
  };

  const sessions = await query('sessions');
  const sessionRows = Array.isArray(sessions.payload?.data) ? sessions.payload.data : [];
  record('sessions.http', sessions.status === 200, { status_code: sessions.status });
  record('sessions.count', sessionRows.length === expected.sessions, {
    expected: expected.sessions,
    actual: sessionRows.length,
  });
  record(
    'sessions.status_coverage',
    ['running', 'paused', 'ended', 'failed'].every((status) =>
      sessionRows.some((row) => row.status === status),
    ),
    { statuses: [...new Set(sessionRows.map((row) => row.status))] },
  );
  record(
    'sessions.telemetry_counts',
    sessionRows.some((row) => Number(row.run_count) >= 2) &&
      sessionRows.some((row) => Number(row.tool_call_count) >= 1),
    { run_counts: sessionRows.map((row) => [row.client_id, row.run_count, row.tool_call_count]) },
  );
  observed.sessions = sessionRows.map((row) => ({
    client_id: row.client_id,
    status: row.status,
    run_count: row.run_count,
    tool_call_count: row.tool_call_count,
  }));

  const handoffs = await query('handoffs');
  const handoffRows = Array.isArray(handoffs.payload?.data) ? handoffs.payload.data : [];
  record('handoffs.http', handoffs.status === 200, { status_code: handoffs.status });
  record('handoffs.count', handoffRows.length === expected.handoffs, {
    expected: expected.handoffs,
    actual: handoffRows.length,
  });
  record(
    'handoffs.status_coverage',
    ['offered', 'accepted', 'rejected'].every((status) =>
      handoffRows.some((row) => row.status === status),
    ),
    { statuses: [...new Set(handoffRows.map((row) => row.status))] },
  );
  observed.handoffs = handoffRows.map((row) => ({
    status: row.status,
    offered_to: row.offered_to,
  }));

  const conflicts = await query('conflicts');
  const conflictRows = Array.isArray(conflicts.payload?.data) ? conflicts.payload.data : [];
  const openConflicts = conflictRows.filter((row) => row.status === 'open').length;
  record('conflicts.http', conflicts.status === 200, { status_code: conflicts.status });
  record('conflicts.count', conflictRows.length === expected.conflicts.total, {
    expected: expected.conflicts.total,
    actual: conflictRows.length,
  });
  record('conflicts.open_count', openConflicts === expected.conflicts.open, {
    expected: expected.conflicts.open,
    actual: openConflicts,
  });
  record(
    'conflicts.resolved_count',
    conflictRows.filter((row) => row.status === 'resolved').length === expected.conflicts.resolved,
    { expected: expected.conflicts.resolved },
  );
  assertRowsHaveRefs(conflictRows, 'conflicts');
  observed.conflicts = { total: conflictRows.length, open: openConflicts };

  const audit = await query('audit');
  const auditRows = Array.isArray(audit.payload?.data) ? audit.payload.data : [];
  record('audit.http', audit.status === 200, { status_code: audit.status });
  const fixtureAuditRows = auditRows.filter((row) =>
    String(row.audit_id).startsWith('real-audit-'),
  );
  record('audit.fixture_rows', fixtureAuditRows.length === expected.audit_fixture_rows, {
    expected: expected.audit_fixture_rows,
    actual: fixtureAuditRows.length,
  });
  if (phase === 'transition') {
    record(
      'audit.transition_record',
      auditRows.some((row) => row.audit_id === 'real-transition-audit-01'),
      {},
    );
  }
  record(
    'audit.result_coverage',
    ['allowed', 'denied', 'error'].every((result) =>
      auditRows.some((row) => row.result === result),
    ),
    { results: [...new Set(auditRows.map((row) => row.result))] },
  );
  assertRowsHaveRefs(fixtureAuditRows, 'audit.fixture');
  observed.audit = { returned: auditRows.length, fixture_rows: fixtureAuditRows.length };

  const admin = await query('admin');
  record('admin.http', admin.status === 200, { status_code: admin.status });
  record(
    'admin.active_sessions',
    admin.payload?.data?.active_sessions === expected.admin.active_sessions,
    {
      expected: expected.admin.active_sessions,
      actual: admin.payload?.data?.active_sessions,
    },
  );
  record(
    'admin.open_conflicts',
    admin.payload?.data?.open_conflicts === expected.admin.open_conflicts,
    {
      expected: expected.admin.open_conflicts,
      actual: admin.payload?.data?.open_conflicts,
    },
  );
  record(
    'admin.audit_count',
    Number(admin.payload?.data?.audit_count) >= expected.audit_fixture_rows,
    {
      minimum: expected.audit_fixture_rows,
      actual: admin.payload?.data?.audit_count,
    },
  );
  observed.admin = admin.payload?.data;

  const isolatedScope = { ...scope, project_id: 'project-does-not-exist' };
  const isolatedWork = await query('work_items', {}, isolatedScope);
  const isolatedConflicts = await query('conflicts', {}, isolatedScope);
  record('scope_isolation.http', isolatedWork.status === 200 && isolatedConflicts.status === 200, {
    work_status: isolatedWork.status,
    conflict_status: isolatedConflicts.status,
  });
  record(
    'scope_isolation.empty',
    Array.isArray(isolatedWork.payload?.data) &&
      isolatedWork.payload.data.length === 0 &&
      Array.isArray(isolatedConflicts.payload?.data) &&
      isolatedConflicts.payload.data.length === 0,
    {
      work_items: isolatedWork.payload?.data,
      conflicts: isolatedConflicts.payload?.data,
    },
  );

  const report = {
    schema_version: 1,
    phase,
    status: 'passed',
    run_id,
    trace_id: `${run_id}-overview`,
    base_url: baseUrl,
    scope,
    expected,
    observed,
    steps,
    source_refs: [
      { type: 'fixture', id: 'seed-realistic-workbench.sql' },
      { type: 'postgres', id: 'wcp_*' },
      { type: 'live-api', id: baseUrl },
    ],
  };
  const reportPath = writeJson(output, `${run_id}.json`, report);
  printResult({ ...report, report_path: reportPath });
} catch (error) {
  const report = {
    schema_version: 1,
    status: 'failed',
    run_id,
    trace_id: `${run_id}-failure`,
    base_url: baseUrl,
    scope,
    expected,
    observed,
    steps,
    error: String(error instanceof Error ? error.message : error),
    source_refs: [
      { type: 'fixture', id: 'seed-realistic-workbench.sql' },
      { type: 'live-api', id: baseUrl },
    ],
  };
  const reportPath = writeJson(output, `${run_id}.json`, report);
  printResult({ ...report, report_path: reportPath });
  process.exitCode = 1;
}
