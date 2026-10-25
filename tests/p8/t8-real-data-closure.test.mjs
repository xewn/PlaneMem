import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { createUlid } from '@planemem/contracts';

const enabled = process.env.REAL_DATA_CLOSURE === '1';
const baseUrl = process.env.WORKCTX_URL ?? 'http://127.0.0.1:3000';
const webhookSecret = process.env.PLANE_WEBHOOK_SECRET ?? 'compose-local-webhook-secret';
const scope = {
  tenant_id: '01HF7YAT000000000000000001',
  workspace_id: '01HF7YAT000000000000000002',
  project_id: '01HF7YAT000000000000000003',
};

test(
  'P8 real data closure persists Plane event, projection and context across runtime restart',
  {
    skip: !enabled,
  },
  async () => {
    const runId = `real-data-closure-${Date.now()}`;
    const eventId = createUlid();
    const aggregateId = createUlid();
    const traceId = `trace-${runId}`;
    const externalId = `plane-${runId}`;
    const event = {
      event_id: eventId,
      event_type: 'ProjectCreated',
      schema_version: 1,
      ...scope,
      aggregate_type: 'project',
      aggregate_id: aggregateId,
      aggregate_version: 1,
      occurred_at: new Date().toISOString(),
      trace_id: traceId,
      source_refs: [{ type: 'plane', id: externalId }],
      sensitivity: 'internal',
      payload: {
        external_id: externalId,
        title: `Real Database Closure ${runId}`,
        status: 'active',
      },
    };
    const raw = JSON.stringify(event);
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const signature = `v1=${createHmac('sha256', webhookSecret)
      .update(`${timestamp}.${raw}`)
      .digest('hex')}`;
    const webhookHeaders = {
      'content-type': 'application/json',
      'x-plane-delivery-id': `delivery-${runId}`,
      'x-plane-event-id': eventId,
      'x-plane-timestamp': timestamp,
      'x-plane-signature': signature,
      'x-trace-id': traceId,
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

    const queryHeaders = {
      'content-type': 'application/json',
      'x-tenant-id': scope.tenant_id,
      'x-workspace-id': scope.workspace_id,
      'x-project-id': scope.project_id,
      'x-actor-id': 'real-data-closure',
      'x-client-id': 'real-data-closure-test',
      'x-capability': 'context.read',
      'x-trace-id': `${traceId}-search`,
    };
    const searchBeforeRestart = await fetch(`${baseUrl}/v1/context/search`, {
      method: 'POST',
      headers: queryHeaders,
      body: JSON.stringify({ query: `Real Database Closure ${runId}` }),
    });
    assert.equal(searchBeforeRestart.status, 200);
    assert.equal((await searchBeforeRestart.json()).data.hits.length, 1);

    const before = readDbState(eventId, externalId, runId);
    assert.deepEqual(before, { events: 1, projections: 1, hits: 1, audits: 1 });

    const restart = runCompose(['restart', 'workctx']);
    assert.equal(restart.status, 0, restart.stderr || restart.stdout);
    await waitForReady();

    const searchAfterRestart = await fetch(`${baseUrl}/v1/context/search`, {
      method: 'POST',
      headers: queryHeaders,
      body: JSON.stringify({ query: `Real Database Closure ${runId}` }),
    });
    assert.equal(searchAfterRestart.status, 200);
    const afterBody = await searchAfterRestart.json();
    assert.equal(afterBody.data.hits.length, 1);
    assert.equal(afterBody.data.hits[0].source_refs[0].id, externalId);

    const duplicateAfterRestart = await fetch(`${baseUrl}/v1/plane/webhook`, {
      method: 'POST',
      headers: webhookHeaders,
      body: raw,
    });
    assert.equal(duplicateAfterRestart.status, 200);
    assert.equal((await duplicateAfterRestart.json()).status, 'duplicate');
    const after = readDbState(eventId, externalId, runId);
    assert.deepEqual(after, {
      events: 1,
      projections: 1,
      hits: 1,
      audits: 2,
    });
    writeReport({
      environment: 'compose',
      run_id: runId,
      event_id: eventId,
      external_id: externalId,
      trace_id: traceId,
      before,
      after,
      status: 'passed',
    });
  },
);

function runCompose(args) {
  return spawnSync(
    'docker',
    [
      'compose',
      '-p',
      'planemem-local',
      '-f',
      'deploy/compose/docker-compose.yml',
      '-f',
      'deploy/compose/docker-compose.local-test.yml',
      ...args,
    ],
    { encoding: 'utf8' },
  );
}

function readDbState(eventId, externalId, runId) {
  const sql = `
SELECT
  (SELECT count(*) FROM wcp_events WHERE event_id='${eventId}') AS events,
  (SELECT count(*) FROM wcp_projection_states WHERE external_id='${externalId}') AS projections,
  (SELECT count(*) FROM wcp_context_hits WHERE id='plane:Project:${externalId}') AS hits,
  (SELECT count(*) FROM wcp_audit_records WHERE trace_id='${runId === undefined ? '' : `trace-${runId}`}') AS audits;
`;
  const result = runCompose([
    'exec',
    '-T',
    'postgres',
    'psql',
    '-U',
    'planemem',
    '-d',
    'planemem',
    '-At',
    '-F',
    '\t',
    '-c',
    sql,
  ]);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const [events, projections, hits, audits] = result.stdout.trim().split('\t').map(Number);
  return { events, projections, hits, audits };
}

function writeReport(report) {
  const output = process.env.REAL_DATA_CLOSURE_REPORT;
  if (!output) return;
  mkdirSync(path.dirname(path.resolve(output)), { recursive: true });
  writeFileSync(path.resolve(output), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
}

async function waitForReady() {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/health/ready`);
      if (response.ok && (await response.json()).ready === true) return;
    } catch {
      // Container is still restarting.
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  throw new Error('workctx did not become ready after restart');
}
