import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import {
  PlaneCapabilityMatrix,
  PlaneClient,
  PlaneProjection,
  WebhookLedger,
  acceptWebhook,
  assertSupported,
  signWebhook,
  verifyWebhook,
  type PlaneTransport,
  type PlaneTransportResponse,
} from '@planemem/plane-connector';
import { mockPlaneEvent } from '@planemem/test-fixtures';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const matrix: PlaneCapabilityMatrix = {
  plane_version: '0.26.0',
  connector_version: '0.1.0',
  api_version: 'v1',
  webhook_version: 'v1',
  image_digest: 'sha256:plane-fixture',
  features: {
    projects: true,
    work_items: true,
    attachments: true,
    webhooks: true,
  },
};

test('T1.1 freezes Plane version and capability support', () => {
  assert.ok(fs.existsSync(path.join(root, 'integrations/plane/compatibility.yaml')));
  assert.equal(assertSupported(matrix, 'projects', '0.26.0').supported, true);
  const rejected = assertSupported(matrix, 'comments', '0.26.0');
  assert.equal(rejected.supported, false);
  if (!rejected.supported) {
    assert.equal(rejected.error.code, 'PLANE_CAPABILITY_UNSUPPORTED');
  }
  assert.throws(() => assertSupported(matrix, 'projects', '0.27.0'), /version/i);
});

class FakePlaneTransport implements PlaneTransport {
  readonly requests: Array<{ method: string; path: string; headers: Record<string, string> }> = [];
  private calls = 0;

  async request<T>(request: {
    method: 'GET' | 'POST' | 'PATCH';
    path: string;
    headers: Record<string, string>;
    body?: unknown;
  }): Promise<PlaneTransportResponse<T>> {
    this.requests.push(request);
    this.calls += 1;
    if (this.calls === 1 && request.method === 'GET') {
      return { status: 429, headers: { 'retry-after': '0' }, data: null as T };
    }
    return {
      status: request.method === 'GET' ? 200 : 201,
      headers: { etag: 'W/"version-2"' },
      data: { id: 'plane-issue-01', version: 2, title: 'issue' } as unknown as T,
    };
  }
}

test('T1.2 uses typed transport, retries read throttling, and carries ETag/idempotency', async () => {
  const transport = new FakePlaneTransport();
  const client = new PlaneClient(transport, {
    base_url: 'https://plane.example',
    api_token: 'token-fixture',
    workspace_slug: 'workspace-demo',
    trace_id: 'trace_plane_01',
  });
  const project = await client.getProject('project-01');
  assert.equal(project.id, 'plane-issue-01');
  const workItem = await client.createWorkItem('project-01', { title: 'issue' }, 'idem-01');
  assert.equal(workItem.version, 2);
  await client.updateWorkItem('project-01', 'issue-01', { title: 'updated' }, 'W/"version-1"');
  assert.match(transport.requests[0]?.path ?? '', /projects\/project-01/);
  assert.equal(transport.requests[2]?.headers['idempotency-key'], 'idem-01');
  assert.equal(transport.requests[3]?.headers['if-match'], 'W/"version-1"');
});

test('T1.3 signs raw webhook body and rejects tampering, replay window, and missing headers', async () => {
  const rawBody = JSON.stringify({ event: 'project.created' });
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const signature = await signWebhook(rawBody, 'secret-fixture', timestamp);
  const headers = {
    'x-plane-delivery-id': 'delivery-01',
    'x-plane-event-id': 'event-01',
    'x-plane-timestamp': timestamp,
    'x-plane-signature': signature,
    'x-trace-id': 'trace_webhook_01',
  };
  assert.equal((await verifyWebhook(rawBody, headers, 'secret-fixture')).valid, true);
  assert.equal((await verifyWebhook(`${rawBody} `, headers, 'secret-fixture')).valid, false);
  const oldHeaders = { ...headers, 'x-plane-timestamp': (Number(timestamp) - 600).toString() };
  assert.equal((await verifyWebhook(rawBody, oldHeaders, 'secret-fixture')).valid, false);
  const accepted = await acceptWebhook(rawBody, headers, 'secret-fixture', (body) => body);
  assert.equal(accepted.accepted, true);
  const missing = await acceptWebhook(rawBody, {}, 'secret-fixture', () => undefined);
  assert.equal(missing.accepted, false);
});

test('T1.4 deduplicates deliveries and replays dead letters exactly once', () => {
  const ledger = new WebhookLedger();
  assert.equal(ledger.deduplicate('delivery-01', 'event-01').kind, 'new');
  assert.equal(ledger.deduplicate('delivery-01', 'event-01').kind, 'duplicate');
  assert.equal(ledger.deduplicate('delivery-02', 'event-01').kind, 'duplicate');
  const deadLetter = ledger.enqueueRetry(
    {
      delivery_id: 'delivery-03',
      event_id: 'event-03',
      payload: { event: 'failed' },
      trace_id: 'trace_dlq_01',
    },
    'upstream timeout',
    1,
  );
  assert.equal(deadLetter.kind, 'dead_letter');
  let replayed = 0;
  assert.equal(
    ledger.replayDeadLetter(deadLetter.id, () => {
      replayed += 1;
    }).status,
    'replayed',
  );
  assert.equal(
    ledger.replayDeadLetter(deadLetter.id, () => {
      replayed += 1;
    }).status,
    'duplicate',
  );
  assert.equal(replayed, 1);
});

test('T1.5 projects Plane events into observed state without replacing authority', () => {
  const projection = new PlaneProjection();
  const event = mockPlaneEvent('projection');
  const first = projection.applyPlaneEvent(event);
  const duplicate = projection.applyPlaneEvent(event);
  assert.equal(first.status, 'accepted');
  assert.equal(duplicate.status, 'duplicate');
  const state = projection.getObservedState('Project', 'fixture-projection-project');
  assert.equal(state?.source_event_id, event.event_id);
  assert.equal(state?.authority, 'plane');
  assert.equal(
    projection.resolveExternalRef('Project', 'fixture-projection-project')?.entity_kind,
    'Project',
  );
});
