import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import postgres from 'postgres';
import { SessionService } from '@planemem/session-service';
import { PostgresSessionStore } from '../../apps/api-gateway/src/session-persistence.js';
import { PostgresSessionCurrentStore } from '../../apps/api-gateway/src/session-current-persistence.js';
import { readSessionCurrentSnapshot, sessionCurrentProtocol,
  type SessionCurrentTarget } from '../../apps/api-gateway/src/session-current.js';
import type { RequestContext } from '../../apps/api-gateway/src/router.js';

const databaseUrl = process.env.SESSION_CURRENT_TEST_DATABASE_URL;

// SOURCE ONLY until the whole factory development phase finishes. This scenario is to be run by
// an explicitly scheduled remote k3s Job, with hostIP supplied by the Kubernetes downward API.
// The disposable DB must already contain migrations and the three fixture scope rows below.
test('remote PostgreSQL current source sees a different writer without refreshing a hydrated Map', {
  skip: databaseUrl === undefined ? 'remote current-session fixture is not configured' : false,
}, async () => {
  assert.equal(process.env.SESSION_CURRENT_REMOTE_ACCEPTANCE, 'approved-k3s');
  assert.equal(process.platform, 'linux');
  assert.ok(process.env.KUBERNETES_SERVICE_HOST);
  assert.ok(['192.168.1.231', '192.168.1.232', '192.168.1.233'].includes(process.env.FACTORY_K3S_NODE_IP ?? ''));
  // The guard runs BEFORE any client construction or database connection.
  const firstDb = postgres(databaseUrl!, { max: 1, connect_timeout: 5 });
  const secondDb = postgres(databaseUrl!, { max: 1, connect_timeout: 5 });
  try {
    const context: RequestContext = {
      schema_version: 1, tenant_id: '01HF7YAT000000000000000001',
      workspace_id: '01HF7YAT000000000000000002', project_id: '01HF7YAT000000000000000003',
      actor_id: 'session-current-remote-fixture', client_id: `current-${randomUUID()}`,
      trace_id: `current-${randomUUID()}`, capability: ['session.write'],
      idempotency_key: `current-start-${randomUUID()}`,
    };
    const writer = new SessionService(new PostgresSessionStore(firstDb));
    const original = await writer.startSessionAsync({
      tenant_id: context.tenant_id as never, workspace_id: context.workspace_id as never,
      project_id: context.project_id as never, actor_id: context.actor_id, client_id: context.client_id,
      trace_id: context.trace_id, idempotency_key: context.idempotency_key!,
    });
    const sessionId = original.session_id;
    const target: SessionCurrentTarget = {
      protocol_version: sessionCurrentProtocol, endpoint_ref: 'explicit-remote-fixture',
      configuration_digest: 'a'.repeat(64), tenant_id: context.tenant_id,
      workspace_id: context.workspace_id, project_id: context.project_id,
      actor_id: context.actor_id, client_id: context.client_id,
      session_id: sessionId, trace_id: context.trace_id, challenge: 'b'.repeat(64),
    };
    const staleDomain = new SessionService(new PostgresSessionStore(firstDb));
    await staleDomain.hydrate();
    const source = new PostgresSessionCurrentStore(firstDb);
    const before = (await source.read(target))!;
    assert.equal(readSessionCurrentSnapshot(before, target).status, 'running');
    const otherWriter = new SessionService(new PostgresSessionStore(secondDb));
    await otherWriter.endSessionAsync({
      tenant_id: context.tenant_id as never, workspace_id: context.workspace_id as never,
      project_id: context.project_id as never, trace_id: context.trace_id,
      session_id: sessionId, expected_version: 1, status: 'ended',
    });
    const after = (await source.read(target))!;
    const current = readSessionCurrentSnapshot(after, target);
    assert.equal(current.status, 'ended');
    assert.equal(current.version, 2);
    assert.equal(staleDomain.getSession(sessionId as never, context as never).status, 'running');
    assert.equal(original.status, 'running');
    assert.equal((await source.read(target))!.session_json, after.session_json);
    assert.equal(await source.read({ ...target, client_id: 'wrong-client' }), null);
    assert.equal(await source.read({ ...target, actor_id: 'wrong-actor' }), null);
    assert.equal(await source.read({ ...target, project_id: target.workspace_id }), null);

    // Explicit fixture corruption must never round a BIGINT into a successful protocol version.
    await secondDb`UPDATE wcp_sessions SET version = 9007199254740993 WHERE session_id = ${sessionId}`;
    const damaged = (await source.read(target))!;
    assert.throws(() => readSessionCurrentSnapshot(damaged, target));
  } finally {
    await Promise.allSettled([firstDb.end(), secondDb.end()]);
  }
});
