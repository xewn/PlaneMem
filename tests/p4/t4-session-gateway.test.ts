import assert from 'node:assert/strict';
import test from 'node:test';
import { createPlatformServer, type PlatformServer } from '../../apps/api-gateway/src/server.js';

function headers(
  capability = 'session.write',
  client = 'client-session-gateway',
): Record<string, string> {
  return {
    'content-type': 'application/json',
    'x-tenant-id': 'tenant-session-gateway',
    'x-workspace-id': 'workspace-session-gateway',
    'x-project-id': 'project-session-gateway',
    'x-actor-id': 'actor-session-gateway',
    'x-client-id': client,
    'x-capability': capability,
    traceparent: `trace-${client}`,
  };
}

async function post(
  baseUrl: string,
  path: string,
  body: Record<string, unknown>,
  requestHeaders: Record<string, string> = headers(),
): Promise<{ response: Response; body: any }> {
  const response = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: requestHeaders,
    body: JSON.stringify(body),
  });
  return { response, body: await response.json() };
}

test('T4 session gateway exposes PlaneMem continuity lifecycle without duplicating factory state', async () => {
  const app: PlatformServer = createPlatformServer({ port: 0 });
  const baseUrl = await app.start();
  try {
    const started = await post(
      baseUrl,
      '/v1/sessions',
      {},
      { ...headers(), 'idempotency-key': 'session-start-1' },
    );
    assert.equal(started.response.status, 200);
    assert.equal(started.body.data.status, 'running');
    const sessionId = started.body.data.session_id;

    const replayed = await post(
      baseUrl,
      '/v1/sessions',
      {},
      { ...headers(), traceparent: 'trace-session-replay', 'idempotency-key': 'session-start-1' },
    );
    assert.equal(replayed.response.status, 200);
    assert.equal(replayed.body.data.session_id, sessionId);
    // Without PostgreSQL this legacy route only has session-domain idempotency;
    // its transport envelope follows this request, not the removed HTTP cache.
    assert.equal(replayed.body.trace_id, 'trace-session-replay');

    const run = await post(baseUrl, `/v1/sessions/${sessionId}/runs`, {
      model: 'factory-role-model',
      expected_version: 1,
    });
    assert.equal(run.response.status, 200);
    const runId = run.body.data.run_id;

    const tool = await post(baseUrl, `/v1/sessions/${sessionId}/tool-calls`, {
      run_id: runId,
      tool_name: 'factory.plan',
      status: 'succeeded',
      expected_version: 2,
    });
    assert.equal(tool.response.status, 200);

    const checkpoint = await post(baseUrl, `/v1/sessions/${sessionId}/checkpoint`, {
      completed: ['requirements'],
      in_progress: ['architecture'],
      next_actions: ['review-bom'],
      decisions: ['abp-first'],
      risks: ['unverified-module'],
      open_questions: [],
      expected_version: 3,
    });
    assert.equal(checkpoint.response.status, 200);
    const checkpointId = checkpoint.body.data.checkpoint_id;

    const handoff = await post(
      baseUrl,
      `/v1/sessions/${sessionId}/handoff`,
      { checkpoint_id: checkpointId, target_client: 'client-next' },
      { ...headers(), 'idempotency-key': 'session-handoff-1' },
    );
    assert.equal(handoff.response.status, 200);
    const handoffId = handoff.body.data.handoff_id;

    const deniedClaim = await post(
      baseUrl,
      `/v1/handoffs/${handoffId}/claim`,
      {},
      headers('session.write', 'client-wrong'),
    );
    assert.equal(deniedClaim.response.status, 400);
    assert.equal(deniedClaim.body.code, 'HANDOFF_ACCESS_DENIED');

    const resumed = await post(
      baseUrl,
      `/v1/sessions/${sessionId}/resume`,
      { handoff_id: handoffId },
      { ...headers('session.write', 'client-next'), 'idempotency-key': 'session-resume-1' },
    );
    assert.equal(resumed.response.status, 200);
    assert.equal(resumed.body.data.handoff.status, 'claimed');
    assert.equal(resumed.body.data.checkpoint.checkpoint_id, checkpointId);
    assert.equal(resumed.body.data.session.parent_session_id, sessionId);

    const conflict = await post(baseUrl, `/v1/sessions/${sessionId}/runs`, {
      expected_version: 99,
    });
    assert.equal(conflict.response.status, 409);
    assert.equal(conflict.body.code, 'SESSION_VERSION_CONFLICT');
  } finally {
    await app.stop();
  }
});
