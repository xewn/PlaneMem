import assert from 'node:assert/strict';
import test from 'node:test';
import { signWebhook } from '@planemem/plane-connector';
import { createPlatformServer, type PlatformServer } from '../../apps/api-gateway/src/server.js';

let app: PlatformServer;
let baseUrl: string;

test.beforeEach(async () => {
  app = createPlatformServer({
    port: 0,
    version: '0.1.0',
    vector_enabled: false,
    plane_webhook_secret: 'test-webhook-secret',
  });
  baseUrl = await app.start();
});

test.afterEach(async () => {
  await app.stop();
});

function headers(capability: string): Record<string, string> {
  return {
    'content-type': 'application/json',
    'x-tenant-id': 'tenant-runtime',
    'x-workspace-id': 'workspace-runtime',
    'x-project-id': 'project-runtime',
    'x-actor-id': 'actor-runtime',
    'x-client-id': 'client-runtime',
    traceparent: 'trace-runtime',
    'x-capability': capability,
  };
}

test('T4.1 runtime serves health, readiness and version without request context', async () => {
  const health = await fetch(`${baseUrl}/health`);
  assert.equal(health.status, 200);
  assert.deepEqual(await health.json(), {
    service: 'planemem-platform',
    version: '0.1.0',
    status: 'ok',
  });

  const ready = await fetch(`${baseUrl}/health/ready`);
  assert.equal(ready.status, 200);
  assert.deepEqual(await ready.json(), {
    service: 'planemem-platform',
    version: '0.1.0',
    status: 'ready',
    ready: true,
  });

  const version = await fetch(`${baseUrl}/version`);
  assert.equal(version.status, 200);
  assert.deepEqual(await version.json(), { version: '0.1.0' });
});

test('T4.1 runtime indexes and searches scoped context with trace preservation', async () => {
  const writeHeaders = { ...headers('context.write'), 'idempotency-key': 'runtime-idem-1' };
  const indexed = await fetch(`${baseUrl}/v1/context/index`, {
    method: 'POST',
    headers: writeHeaders,
    body: JSON.stringify({
      id: 'memory-runtime-1',
      title: 'Offline deployment',
      snippet: 'k3s image transfer',
      revision: 1,
      score: 1,
      source_refs: [{ type: 'fixture', id: 'runtime-1' }],
    }),
  });
  assert.equal(indexed.status, 200);
  assert.equal((await indexed.json()).trace_id, 'trace-runtime');

  const replayed = await fetch(`${baseUrl}/v1/context/index`, {
    method: 'POST',
    headers: { ...writeHeaders, traceparent: 'trace-runtime-replay' },
    body: JSON.stringify({
      id: 'memory-runtime-1',
      title: 'Offline deployment',
      snippet: 'k3s image transfer',
      revision: 1,
      score: 1,
      source_refs: [{ type: 'fixture', id: 'runtime-1' }],
    }),
  });
  assert.equal(replayed.status, 200);
  assert.equal((await replayed.json()).trace_id, 'trace-runtime');

  const searched = await fetch(`${baseUrl}/v1/context/search`, {
    method: 'POST',
    headers: headers('context.read'),
    body: JSON.stringify({ query: 'k3s' }),
  });
  assert.equal(searched.status, 200);
  const body = await searched.json();
  assert.equal(body.trace_id, 'trace-runtime');
  assert.equal(body.data.hits[0].id, 'memory-runtime-1');
  assert.equal(body.data.hits.length, 1);
  assert.deepEqual(body.source_refs, [{ type: 'fixture', id: 'runtime-1' }]);
});

test('T4.1 runtime rejects missing capabilities, malformed JSON, missing scope and unknown routes', async () => {
  const denied = await fetch(`${baseUrl}/v1/context/index`, {
    method: 'POST',
    headers: headers('context.read'),
    body: JSON.stringify({}),
  });
  assert.equal(denied.status, 403);
  assert.equal((await denied.json()).code, 'DENIED');

  const malformed = await fetch(`${baseUrl}/v1/context/search`, {
    method: 'POST',
    headers: { ...headers('context.read'), 'content-type': 'application/json' },
    body: '{',
  });
  assert.equal(malformed.status, 400);
  assert.equal((await malformed.json()).code, 'INVALID_JSON');

  const missingScopeHeaders = headers('context.read');
  delete missingScopeHeaders['x-project-id'];
  const missingScope = await fetch(`${baseUrl}/v1/context/search`, {
    method: 'POST',
    headers: missingScopeHeaders,
    body: JSON.stringify({ query: 'k3s' }),
  });
  assert.equal(missingScope.status, 400);

  const unknown = await fetch(`${baseUrl}/v1/unknown`, { headers: headers('context.read') });
  assert.equal(unknown.status, 404);
});

test('T4.2 runtime accepts signed Plane webhooks and exposes MCP JSON-RPC transport', async () => {
  const event = {
    event_id: '01HF7YAT000000000000000009',
    event_type: 'ProjectCreated',
    schema_version: 1,
    tenant_id: '01HF7YAT000000000000000001',
    workspace_id: '01HF7YAT000000000000000002',
    project_id: '01HF7YAT000000000000000003',
    aggregate_type: 'project',
    aggregate_id: '01HF7YAT000000000000000003',
    aggregate_version: 1,
    occurred_at: new Date().toISOString(),
    trace_id: 'trace-plane-webhook-runtime',
    source_refs: [{ type: 'plane', id: 'plane-project-runtime' }],
    sensitivity: 'internal',
    payload: {
      external_id: 'plane-project-runtime',
      title: 'Runtime Webhook Project',
      status: 'active',
    },
  };
  const raw = JSON.stringify(event);
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const signature = await signWebhook(raw, 'test-webhook-secret', timestamp);
  const webhookHeaders = {
    'content-type': 'application/json',
    'x-plane-delivery-id': 'delivery-runtime-1',
    'x-plane-event-id': event.event_id,
    'x-plane-timestamp': timestamp,
    'x-plane-signature': signature,
    'x-trace-id': event.trace_id,
  };

  const accepted = await fetch(`${baseUrl}/v1/plane/webhook`, {
    method: 'POST',
    headers: webhookHeaders,
    body: raw,
  });
  assert.equal(accepted.status, 200);
  assert.equal((await accepted.json()).status, 'accepted');

  const duplicate = await fetch(`${baseUrl}/v1/plane/webhook`, {
    method: 'POST',
    headers: webhookHeaders,
    body: raw,
  });
  assert.equal(duplicate.status, 200);
  assert.equal((await duplicate.json()).status, 'duplicate');

  const searchResponse = await fetch(`${baseUrl}/v1/context/search`, {
    method: 'POST',
    headers: {
      ...headers('context.read'),
      'x-tenant-id': event.tenant_id,
      'x-workspace-id': event.workspace_id,
      'x-project-id': event.project_id,
    },
    body: JSON.stringify({ query: 'Runtime Webhook Project' }),
  });
  assert.equal(searchResponse.status, 200);
  const searchBody = await searchResponse.json();
  assert.equal(searchBody.data.hits.length, 1);
  assert.equal(searchBody.data.hits[0].source_refs[0].id, 'plane-project-runtime');

  const mcpHeaders = {
    ...headers('context.read'),
    'x-tenant-id': event.tenant_id,
    'x-workspace-id': event.workspace_id,
    'x-project-id': event.project_id,
    'content-type': 'application/json',
  };
  const discover = await fetch(`${baseUrl}/mcp`, {
    method: 'POST',
    headers: mcpHeaders,
    body: JSON.stringify({ jsonrpc: '2.0', id: 0, method: 'server/discover', params: {} }),
  });
  assert.equal(discover.status, 200);
  const discoverBody = await discover.json();
  assert.deepEqual(discoverBody.result.supportedVersions, ['2025-11-25', '2024-11-11']);
  assert.deepEqual(discoverBody.result.capabilities, { tools: {}, resources: {}, prompts: {} });

  const initialize = await fetch(`${baseUrl}/mcp`, {
    method: 'POST',
    headers: mcpHeaders,
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }),
  });
  assert.equal(initialize.status, 200);
  assert.equal((await initialize.json()).result.serverInfo.name, 'planemem-mcp');

  const tools = await fetch(`${baseUrl}/mcp`, {
    method: 'POST',
    headers: mcpHeaders,
    body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' }),
  });
  assert.equal(tools.status, 200);
  assert.deepEqual(
    (await tools.json()).result.tools.map((tool: { name: string }) => tool.name),
    ['context_search', 'context_index'],
  );

  const call = await fetch(`${baseUrl}/mcp`, {
    method: 'POST',
    headers: mcpHeaders,
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: { name: 'context_search', arguments: { query: 'Runtime Webhook Project' } },
    }),
  });
  assert.equal(call.status, 200);
  const callBody = await call.json();
  const callResult = JSON.parse(callBody.result.content[0].text);
  assert.equal(callResult.data.hits.length, 1);

  const resources = await fetch(`${baseUrl}/mcp`, {
    method: 'POST',
    headers: mcpHeaders,
    body: JSON.stringify({ jsonrpc: '2.0', id: 4, method: 'resources/list' }),
  });
  assert.equal(resources.status, 200);
  assert.equal(
    (await resources.json()).result.resources[0].uri,
    'wcp://context/plane:Project:plane-project-runtime',
  );
});

test('T4.2 runtime rejects an invalid Plane webhook signature before projection', async () => {
  const raw = JSON.stringify({ event_id: 'invalid' });
  const response = await fetch(`${baseUrl}/v1/plane/webhook`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-plane-delivery-id': 'delivery-invalid',
      'x-plane-event-id': 'invalid',
      'x-plane-timestamp': Math.floor(Date.now() / 1000).toString(),
      'x-plane-signature': 'v1=invalid',
      'x-trace-id': 'trace-invalid-webhook',
    },
    body: raw,
  });
  assert.equal(response.status, 401);
  assert.equal((await response.json()).code, 'WEBHOOK_SIGNATURE_INVALID');
});
