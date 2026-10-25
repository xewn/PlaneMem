import assert from 'node:assert/strict';
import test from 'node:test';
import { AuditService } from '@planemem/audit-service';
import { PolicyService } from '@planemem/policy-service';
import {
  HealthRegistry,
  MetricsRegistry,
  createTraceContext,
  withSpan,
} from '@planemem/observability';
import type { AuthContext } from '@planemem/auth';

const context: AuthContext = {
  tenant_id: 'tenant-p6',
  workspace_id: 'workspace-p6',
  project_id: 'project-p6',
  actor_id: 'actor-p6',
  client_id: 'codex',
  roles: ['member'],
  capabilities: ['context.read'],
  token_expires_at: '2099-01-01T00:00:00.000Z',
  trace_id: 'trace-p6',
};
const resource = {
  tenant_id: context.tenant_id,
  workspace_id: context.workspace_id,
  project_id: context.project_id,
  classification: 'internal' as const,
};

test('P6-S01/T6.1 denies expired tokens, scope escalation and missing capabilities', () => {
  const policy = new PolicyService();
  assert.equal(policy.authorize({ action: 'context.read', resource, context }).allowed, true);
  assert.equal(
    policy.authorize({
      action: 'context.read',
      resource: { ...resource, project_id: 'project-other' },
      context,
    }).reason,
    'scope_mismatch',
  );
  assert.equal(
    policy.authorize({
      action: 'context.read',
      resource,
      context: { ...context, token_expires_at: '2020-01-01T00:00:00.000Z' },
    }).reason,
    'token_expired',
  );
  assert.equal(policy.authorize({ action: 'handoff.claim', resource, context }).allowed, false);
  assert.equal(policy.health().ready, true);
});

test('P6-S02/T6.2 records complete, idempotent and redacted audit rows', () => {
  const audit = new AuditService();
  const input = {
    ...resource,
    actor_id: context.actor_id,
    client_id: context.client_id,
    action: 'context.read',
    resource: 'pack:p6',
    result: 'allowed' as const,
    classification: 'confidential' as const,
    details: { secret: 'do-not-export' },
    trace_id: context.trace_id,
    idempotency_key: 'idem-audit',
  };
  const first = audit.recordAudit(input);
  const retry = audit.recordAudit({ ...input, details: { secret: 'changed' } });
  assert.equal(retry.audit_id, first.audit_id);
  assert.match(String((first.details as { secret: string }).secret), /redacted/);
  assert.equal(audit.queryAudit(resource, { trace_id: context.trace_id }).length, 1);
  assert.equal(
    audit.createExportRecord({
      ...input,
      idempotency_key: 'idem-audit-export',
      export_format: 'json',
      row_count: 1,
    }).action,
    'export.json',
  );
  assert.equal(audit.health().metrics.records, 2);
});

test('P6-S03/T6.3 propagates trace spans and guards metric cardinality', async () => {
  const root = createTraceContext('trace-observe');
  const spans: string[] = [];
  const value = await withSpan(root, 'fixture.operation', (span) => {
    spans.push(span.trace_id);
    return 42;
  });
  assert.equal(value, 42);
  assert.deepEqual(spans, ['trace-observe']);
  const metrics = new MetricsRegistry();
  metrics.increment('requests_total', { route: '/v1/context' });
  assert.throws(
    () => metrics.increment('requests_total', { trace_id: root.trace_id }),
    /high-cardinality/,
  );
  const health = new HealthRegistry();
  health.set({ name: 'gateway', status: 'ok', version: '0.1.0' });
  health.set({ name: 'audit', status: 'degraded', version: '0.1.0' });
  assert.equal(health.snapshot().status, 'degraded');
});

test('P6-S04/T6.1 evaluates OPA decisions and fails closed on transport errors', async () => {
  const requests: Array<{ url: string; body: string }> = [];
  const opa = new PolicyService({
    opa_url: 'http://opa:8181',
    fetch_impl: async (input, init) => {
      requests.push({ url: String(input), body: String(init?.body) });
      return new Response(JSON.stringify({ result: { allow: true } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    },
  });
  const request = {
    action: 'context.read',
    resource,
    context,
  };
  const allowed = await opa.authorizeWithOpa(request);
  assert.equal(allowed.allowed, true);
  assert.equal(requests[0]?.url, 'http://opa:8181/v1/data/planemem/authz');
  assert.match(requests[0]?.body ?? '', /context\.read/);

  const denied = new PolicyService({
    opa_url: 'http://opa:8181',
    fetch_impl: async () =>
      new Response(JSON.stringify({ result: { allow: false } }), { status: 200 }),
  });
  assert.equal((await denied.authorizeWithOpa(request)).reason, 'opa_denied');

  const unavailable = new PolicyService({
    opa_url: 'http://opa:8181',
    fetch_impl: async () => {
      throw new Error('connection refused');
    },
  });
  const failed = await unavailable.authorizeWithOpa(request);
  assert.equal(failed.allowed, false);
  assert.equal(failed.reason, 'opa_unavailable');
});
