import assert from 'node:assert/strict';
import test from 'node:test';
import { createPlatformServer, type PlatformServer } from '../../apps/api-gateway/src/server.js';

const databaseUrl = process.env.SESSION_TEST_DATABASE_URL;

test(
  'T4 session gateway restores continuity from PostgreSQL after runtime restart',
  { skip: databaseUrl === undefined ? 'SESSION_TEST_DATABASE_URL is required' : false },
  async () => {
    const previousDatabaseUrl = process.env.DATABASE_URL;
    process.env.DATABASE_URL = databaseUrl;
    let first: PlatformServer | undefined;
    let second: PlatformServer | undefined;
    try {
      first = createPlatformServer({ port: 0 });
      const firstUrl = await first.start();
      const started = await post(firstUrl, '/v1/sessions', {}, headers('client-persist-live'), {
        'idempotency-key': `live-session-${Date.now()}`,
      });
      assert.equal(started.response.status, 200);
      const sessionId = started.body.data.session_id as string;
      const run = await post(
        firstUrl,
        `/v1/sessions/${sessionId}/runs`,
        { model: 'live-persistence-model', expected_version: 1 },
        headers('client-persist-live'),
      );
      assert.equal(run.response.status, 200);
      const checkpoint = await post(
        firstUrl,
        `/v1/sessions/${sessionId}/checkpoint`,
        {
          completed: ['restart-test'],
          in_progress: [],
          next_actions: ['resume'],
          decisions: [],
          risks: [],
          open_questions: [],
          expected_version: 2,
        },
        headers('client-persist-live'),
      );
      assert.equal(checkpoint.response.status, 200);
      const checkpointId = checkpoint.body.data.checkpoint_id as string;
      const handoff = await post(
        firstUrl,
        `/v1/sessions/${sessionId}/handoff`,
        { checkpoint_id: checkpointId, target_client: 'client-persist-next' },
        headers('client-persist-live'),
        { 'idempotency-key': `live-handoff-${Date.now()}` },
      );
      assert.equal(handoff.response.status, 200);
      const handoffId = handoff.body.data.handoff_id as string;
      await first.stop();
      first = undefined;

      second = createPlatformServer({ port: 0 });
      const secondUrl = await second.start();
      const resumed = await post(
        secondUrl,
        `/v1/sessions/${sessionId}/resume`,
        { handoff_id: handoffId },
        headers('client-persist-next'),
        { 'idempotency-key': `live-resume-${Date.now()}` },
      );
      assert.equal(resumed.response.status, 200);
      assert.equal(resumed.body.data.checkpoint.checkpoint_id, checkpointId);
      assert.equal(resumed.body.data.handoff.status, 'claimed');
      assert.equal(resumed.body.data.session.parent_session_id, sessionId);
    } finally {
      await first?.stop();
      await second?.stop();
      if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = previousDatabaseUrl;
    }
  },
);

function headers(client: string): Record<string, string> {
  return {
    'content-type': 'application/json',
    'x-tenant-id': '01HF7YAT000000000000000001',
    'x-workspace-id': '01HF7YAT000000000000000002',
    'x-project-id': '01HF7YAT000000000000000003',
    'x-actor-id': 'actor-persist-live',
    'x-client-id': client,
    'x-capability': 'session.write',
    traceparent: `trace-${client}-${Date.now()}`,
  };
}

async function post(
  baseUrl: string,
  path: string,
  body: Record<string, unknown>,
  requestHeaders: Record<string, string>,
  extraHeaders: Record<string, string> = {},
): Promise<{ response: Response; body: any }> {
  const response = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { ...requestHeaders, ...extraHeaders },
    body: JSON.stringify(body),
  });
  return { response, body: await response.json() };
}
