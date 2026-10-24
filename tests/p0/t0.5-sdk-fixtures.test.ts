import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { validateEntity } from '@planemem/contracts';
import { MockWcpServer, WcpClient, type WcpRequest } from '@planemem/sdk';
import {
  FIXTURE_VERSION,
  assertContract,
  createTestProject,
  createTestTenant,
  mockMemoryPage,
  mockPlaneEvent,
} from '@planemem/test-fixtures';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

test('T0.5 creates deterministic, schema-valid shared fixtures', () => {
  assert.ok(fs.existsSync(path.join(root, 'packages/test-fixtures/fixtures/p0-fixture.json')));
  const tenantA = createTestTenant('demo');
  const tenantB = createTestTenant('demo');
  assert.deepEqual(tenantA, tenantB);
  assert.equal(validateEntity('Tenant', tenantA).valid, true);

  const project = createTestProject('demo');
  assert.equal(validateEntity('Project', project).valid, true);
  assert.equal(validateEntity('WorkItem', mockPlaneEvent('demo').payload).valid, false);

  const event = mockPlaneEvent('demo');
  assert.equal(assertContract('event', event), event);
  const page = mockMemoryPage('demo');
  assert.equal(page.fixture_version, FIXTURE_VERSION);
  assert.ok(page.page_ref.startsWith('memory://'));
  assert.equal(assertContract('memory_page', page), page);
});

test('T0.5 SDK and mock server preserve WCP headers, idempotency, and error shape', async () => {
  const requests: WcpRequest[] = [];
  const server = new MockWcpServer({
    onRequest(request) {
      requests.push(request);
    },
  });
  const client = new WcpClient(server, {
    tenant_id: createTestTenant('demo').id,
    workspace_id: createTestTenant('demo').workspace_id,
    project_id: createTestProject('demo').project_id,
    trace_id: 'trace_sdk_01',
  });
  const project = await client.createProject(createTestProject('demo'));
  const replay = await client.createProject(createTestProject('demo'));
  assert.deepEqual(replay, project);
  assert.equal(requests[0]?.headers['traceparent'], 'trace_sdk_01');
  assert.equal(requests[0]?.headers['idempotency-key'], 'fixture-demo-project');
  assert.equal(requests.length, 2);
  await assert.rejects(
    () => client.createProject({ bad: true } as never),
    (error: unknown) =>
      typeof error === 'object' &&
      error !== null &&
      'envelope' in error &&
      (error as { envelope?: { code?: string } }).envelope?.code ===
        'ENTITY_SCHEMA_VALIDATION_FAILED',
  );
});
