import assert from 'node:assert/strict';
import test from 'node:test';
import { createPlatformServer, type PlatformServer } from '../../apps/api-gateway/src/server.js';

test('P6-S04/T6.2 runtime emits scoped allowed and denied audit records', async () => {
  const callbacks: string[] = [];
  const app: PlatformServer = createPlatformServer({
    port: 0,
    on_audit: (record) => callbacks.push(record.audit_id),
  });
  const baseUrl = await app.start();
  const headers = {
    'content-type': 'application/json',
    'x-tenant-id': 'tenant-audit-runtime',
    'x-workspace-id': 'workspace-audit-runtime',
    'x-project-id': 'project-audit-runtime',
    'x-actor-id': 'actor-audit-runtime',
    'x-client-id': 'client-audit-runtime',
    traceparent: 'trace-audit-runtime-allowed',
    'x-capability': 'context.read',
  };
  try {
    const allowed = await fetch(`${baseUrl}/v1/context/search`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ query: 'audit' }),
    });
    assert.equal(allowed.status, 200);

    const denied = await fetch(`${baseUrl}/v1/context/search`, {
      method: 'POST',
      headers: { ...headers, traceparent: 'trace-audit-runtime-denied', 'x-capability': '' },
      body: JSON.stringify({ query: 'audit' }),
    });
    assert.equal(denied.status, 403);

    const records = app.auditRecords();
    assert.equal(records.length, 2);
    assert.deepEqual(
      records.map((record) => [record.result, record.trace_id]),
      [
        ['allowed', 'trace-audit-runtime-allowed'],
        ['denied', 'trace-audit-runtime-denied'],
      ],
    );
    assert.equal(records[1]?.details && typeof records[1].details, 'object');
    assert.equal(callbacks.length, 2);
    assert.deepEqual(
      callbacks,
      records.map((record) => record.audit_id),
    );
  } finally {
    await app.stop();
  }
});

test('P6-S04/T6.2 returns a traceable 503 when audit persistence is unavailable', async () => {
  const app: PlatformServer = createPlatformServer({
    port: 0,
    audit_persist: async () => {
      throw new Error('database unavailable');
    },
  });
  const baseUrl = await app.start();
  try {
    const response = await fetch(`${baseUrl}/v1/context/search`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-tenant-id': 'tenant-audit-failure',
        'x-workspace-id': 'workspace-audit-failure',
        'x-project-id': 'project-audit-failure',
        'x-actor-id': 'actor-audit-failure',
        'x-client-id': 'client-audit-failure',
        traceparent: 'trace-audit-persistence-failure',
        'x-capability': 'context.read',
      },
      body: JSON.stringify({ query: 'audit failure' }),
    });
    const payload = (await response.json()) as {
      code?: string;
      trace_id?: string;
      retryable?: boolean;
    };
    assert.equal(response.status, 503);
    assert.equal(payload.code, 'AUDIT_PERSISTENCE_UNAVAILABLE');
    assert.equal(payload.trace_id, 'trace-audit-persistence-failure');
    assert.equal(payload.retryable, true);
  } finally {
    await app.stop();
  }
});
