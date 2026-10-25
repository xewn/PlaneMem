import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import postgres from '../../artifacts/runtime/node_modules/postgres/src/index.js';
import test from 'node:test';
import { createUlid } from '@planemem/contracts';

const enabled = process.env.K3S_REAL_DATA_CLOSURE === '1';
const forwardPort = Number(process.env.K3S_PORT ?? 38081);
const baseUrl = process.env.WORKCTX_URL ?? `http://127.0.0.1:${forwardPort}`;
const webhookSecret = process.env.PLANE_WEBHOOK_SECRET;
const databaseUrl = process.env.K3S_DATABASE_URL;
const scope = {
  tenant_id: '01HF7YAT000000000000000001',
  workspace_id: '01HF7YAT000000000000000002',
  project_id: '01HF7YAT000000000000000003',
};
let portForward;

test(
  'P8 k3s real data closure persists through deployment restart',
  { skip: !enabled },
  async () => {
    assert.ok(webhookSecret, 'PLANE_WEBHOOK_SECRET is required');
    assert.ok(databaseUrl, 'K3S_DATABASE_URL is required');
    await startPortForward();
    try {
      const runId = `k3s-real-data-closure-${Date.now()}`;
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
          title: `K3s Real Database Closure ${runId}`,
          status: 'active',
        },
      };
      const bootstrapHeaders = {
        'content-type': 'application/json',
        'x-tenant-id': scope.tenant_id,
        'x-workspace-id': scope.workspace_id,
        'x-project-id': scope.project_id,
        'x-actor-id': 'k3s-real-data-bootstrap',
        'x-client-id': 'k3s-real-data-bootstrap',
        'x-capability': 'context.write',
        'x-trace-id': `${traceId}-bootstrap`,
      };
      const bootstrap = await post(
        '/v1/context/index',
        bootstrapHeaders,
        JSON.stringify({
          id: `k3s-scope-bootstrap-${runId}`,
          title: 'K3s scope bootstrap',
          snippet: 'Initializes the explicit project scope before the event recovery probe.',
          revision: 1,
          score: 1,
          source_refs: [{ type: 'test-bootstrap', id: runId }],
        }),
      );
      assert.equal(bootstrap.status, 200);
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

      const accepted = await post('/v1/plane/webhook', webhookHeaders, raw);
      assert.equal(accepted.status, 200);
      assert.equal((await accepted.json()).status, 'accepted');
      const duplicate = await post('/v1/plane/webhook', webhookHeaders, raw);
      assert.equal(duplicate.status, 200);
      assert.equal((await duplicate.json()).status, 'duplicate');

      const queryHeaders = {
        'content-type': 'application/json',
        'x-tenant-id': scope.tenant_id,
        'x-workspace-id': scope.workspace_id,
        'x-project-id': scope.project_id,
        'x-actor-id': 'k3s-real-data-closure',
        'x-client-id': 'k3s-real-data-closure-test',
        'x-capability': 'context.read',
        'x-trace-id': `${traceId}-search`,
      };
      const beforeSearch = await post(
        '/v1/context/search',
        queryHeaders,
        JSON.stringify({ query: `K3s Real Database Closure ${runId}` }),
      );
      assert.equal(beforeSearch.status, 200);
      const beforeBody = await beforeSearch.json();
      assert.ok(beforeBody.data.hits.length >= 1);
      const sessionClient = `k3s-session-${runId}`;
      const sessionHeaders = {
        'content-type': 'application/json',
        'x-tenant-id': scope.tenant_id,
        'x-workspace-id': scope.workspace_id,
        'x-project-id': scope.project_id,
        'x-actor-id': 'k3s-session-closure',
        'x-client-id': sessionClient,
        'x-capability': 'session.write',
        'x-trace-id': `${traceId}-session`,
      };
      const sessionStart = await post(
        '/v1/sessions',
        { ...sessionHeaders, 'idempotency-key': `session-${runId}` },
        '{}',
      );
      assert.equal(sessionStart.status, 200);
      const sessionId = (await sessionStart.json()).data.session_id;
      const sessionRun = await post(
        `/v1/sessions/${sessionId}/runs`,
        { ...sessionHeaders, 'x-trace-id': `${traceId}-session-run` },
        JSON.stringify({
          session_id: sessionId,
          model: 'k3s-real-data-model',
          expected_version: 1,
        }),
      );
      assert.equal(sessionRun.status, 200);
      const sessionRunId = (await sessionRun.json()).data.run_id;
      const sessionCheckpoint = await post(
        `/v1/sessions/${sessionId}/checkpoint`,
        { ...sessionHeaders, 'x-trace-id': `${traceId}-session-checkpoint` },
        JSON.stringify({
          session_id: sessionId,
          completed: ['real-data-closure'],
          in_progress: [],
          next_actions: ['resume-after-restart'],
          decisions: [],
          risks: [],
          open_questions: [],
          expected_version: 2,
        }),
      );
      assert.equal(sessionCheckpoint.status, 200);
      const checkpointId = (await sessionCheckpoint.json()).data.checkpoint_id;
      const sessionHandoff = await post(
        `/v1/sessions/${sessionId}/handoff`,
        { ...sessionHeaders, 'idempotency-key': `handoff-${runId}` },
        JSON.stringify({
          checkpoint_id: checkpointId,
          target_client: 'k3s-session-resumer',
        }),
      );
      assert.equal(sessionHandoff.status, 200);
      const handoffId = (await sessionHandoff.json()).data.handoff_id;
      const db = postgres(databaseUrl, { max: 1, connect_timeout: 5 });
      const before = await readDbState(db, eventId, externalId, traceId, {
        sessionId,
        runId: sessionRunId,
        checkpointId,
        handoffId,
      });
      assert.deepEqual(before, {
        events: 1,
        projections: 1,
        hits: 1,
        audits: 1,
        sessions: 1,
        runs: 1,
        checkpoints: 1,
        handoffs: 1,
        claimed_handoffs: 0,
      });

      await stopPortForward();
      const restart = kubectl('rollout', 'restart', 'deployment/planemem', '-n', 'planemem-test');
      assert.equal(restart.status, 0, restart.stderr || restart.stdout);
      const rollout = kubectl(
        'rollout',
        'status',
        'deployment/planemem',
        '-n',
        'planemem-test',
        '--timeout=180s',
      );
      assert.equal(rollout.status, 0, rollout.stderr || rollout.stdout);
      await startPortForward();
      await waitForReady();

      const afterSearch = await post(
        '/v1/context/search',
        queryHeaders,
        JSON.stringify({ query: `K3s Real Database Closure ${runId}` }),
      );
      assert.equal(afterSearch.status, 200);
      const afterBody = await afterSearch.json();
      assert.ok(afterBody.data.hits.length >= 1);
      assert.ok(
        afterBody.data.hits.some((hit) => hit.source_refs.some((ref) => ref.id === externalId)),
      );
      const replayedStart = await post(
        '/v1/sessions',
        { ...sessionHeaders, 'idempotency-key': `session-${runId}` },
        '{}',
      );
      assert.equal(replayedStart.status, 200);
      assert.equal((await replayedStart.json()).data.session_id, sessionId);
      const resumed = await post(
        `/v1/sessions/${sessionId}/resume`,
        {
          ...sessionHeaders,
          'x-client-id': 'k3s-session-resumer',
          'x-trace-id': `${traceId}-session-resume`,
          'idempotency-key': `resume-${runId}`,
        },
        JSON.stringify({ handoff_id: handoffId }),
      );
      assert.equal(resumed.status, 200);
      const resumedBody = await resumed.json();
      assert.equal(resumedBody.data.checkpoint.checkpoint_id, checkpointId);
      assert.equal(resumedBody.data.handoff.status, 'claimed');
      assert.equal(resumedBody.data.session.parent_session_id, sessionId);
      const duplicateAfterRestart = await post('/v1/plane/webhook', webhookHeaders, raw);
      assert.equal(duplicateAfterRestart.status, 200);
      assert.equal((await duplicateAfterRestart.json()).status, 'duplicate');
      const after = await readDbState(db, eventId, externalId, traceId, {
        sessionId,
        runId: sessionRunId,
        checkpointId,
        handoffId,
      });
      assert.deepEqual(after, {
        events: 1,
        projections: 1,
        hits: 1,
        audits: 2,
        sessions: 2,
        runs: 1,
        checkpoints: 1,
        handoffs: 1,
        claimed_handoffs: 1,
      });
      writeReport({
        environment: 'k3s',
        run_id: runId,
        event_id: eventId,
        external_id: externalId,
        trace_id: traceId,
        session_id: sessionId,
        agent_run_id: sessionRunId,
        checkpoint_id: checkpointId,
        handoff_id: handoffId,
        image: process.env.K3S_IMAGE ?? null,
        migration: process.env.K3S_MIGRATION ?? null,
        before,
        after,
        status: 'passed',
      });
      await db.end();
    } finally {
      await stopPortForward();
    }
  },
);

async function post(path, headers, body) {
  return fetch(`${baseUrl}${path}`, { method: 'POST', headers, body });
}

function kubectl(...args) {
  return spawnSync('kubectl', args, { encoding: 'utf8' });
}

async function startPortForward() {
  portForward = spawn(
    'kubectl',
    ['-n', 'planemem-test', 'port-forward', 'svc/planemem', `${forwardPort}:80`],
    {
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('k3s port-forward did not start')), 20_000);
    const onData = (data) => {
      if (String(data).includes('Forwarding from')) {
        clearTimeout(timer);
        resolve();
      }
    };
    portForward.stdout.on('data', onData);
    portForward.stderr.on('data', onData);
    portForward.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    portForward.once('exit', (code) => {
      if (code !== 0) {
        clearTimeout(timer);
        reject(new Error(`k3s port-forward exited with ${code}`));
      }
    });
  });
}

async function stopPortForward() {
  if (!portForward) return;
  portForward.kill();
  await new Promise((resolve) => portForward.once('exit', resolve));
  portForward = undefined;
}

async function readDbState(db, eventId, externalId, traceId, continuity) {
  const rows = await db`
    SELECT
      (SELECT count(*) FROM wcp_events WHERE event_id=${eventId}) AS events,
      (SELECT count(*) FROM wcp_projection_states WHERE external_id=${externalId}) AS projections,
      (SELECT count(*) FROM wcp_context_hits WHERE id=${`plane:Project:${externalId}`}) AS hits,
      (SELECT count(*) FROM wcp_audit_records WHERE trace_id=${traceId}) AS audits,
      (SELECT count(*) FROM wcp_sessions WHERE session_id=${continuity.sessionId})
        + (SELECT count(*) FROM wcp_sessions WHERE parent_session_id=${continuity.sessionId}) AS sessions,
      (SELECT count(*) FROM wcp_agent_runs WHERE run_id=${continuity.runId}) AS runs,
      (SELECT count(*) FROM wcp_session_checkpoints WHERE checkpoint_id=${continuity.checkpointId}) AS checkpoints,
      (SELECT count(*) FROM wcp_session_handoffs WHERE handoff_id=${continuity.handoffId}) AS handoffs,
      (SELECT count(*) FROM wcp_session_handoffs WHERE handoff_id=${continuity.handoffId} AND status='claimed') AS claimed_handoffs
  `;
  return Object.fromEntries(Object.entries(rows[0]).map(([key, value]) => [key, Number(value)]));
}

function writeReport(report) {
  const output = process.env.K3S_REAL_DATA_CLOSURE_REPORT;
  if (!output) return;
  const requestedPath = path.resolve(output);
  const destination = existsSync(requestedPath)
    ? path.join(
        path.dirname(requestedPath),
        `${path.basename(requestedPath, path.extname(requestedPath))}.${report.run_id}${path.extname(requestedPath)}`,
      )
    : requestedPath;
  mkdirSync(path.dirname(destination), { recursive: true });
  writeFileSync(destination, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
}

async function waitForReady() {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/health/ready`);
      if (response.ok && (await response.json()).ready === true) return;
    } catch {
      // The Service can have no endpoints during the rolling restart.
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  throw new Error('k3s deployment did not become ready after restart');
}
