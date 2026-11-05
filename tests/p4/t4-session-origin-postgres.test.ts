import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import postgres from 'postgres';
import { SessionService } from '@planemem/session-service';
import { PostgresSessionStore } from '../../apps/api-gateway/src/session-persistence.js';
import { PostgresSessionOriginStore } from '../../apps/api-gateway/src/session-origin-persistence.js';
import { SessionOriginBridge, legacyStartFingerprint } from '../../apps/api-gateway/src/session-origin-bridge.js';
import { originFixture, hash } from '../p3/session-origin-fixture.js';

const databaseUrl = process.env.SESSION_ORIGIN_TEST_DATABASE_URL;

// SOURCE ONLY. Actual SQL/session services, but the retained old OperationRecord and approval
// are explicit synthetic fixtures, not evidence of upgrading an actual old deployment.
test('remote retained original source survives connection replacement and sees another current writer', {
  skip: databaseUrl === undefined ? 'isolated remote origin database is not configured' : false,
}, async () => {
  assert.equal(process.env.SESSION_ORIGIN_REMOTE_ACCEPTANCE, 'approved-k3s');
  assert.equal(process.platform, 'linux'); assert.ok(process.env.KUBERNETES_SERVICE_HOST);
  assert.ok(['192.168.1.231', '192.168.1.232', '192.168.1.233'].includes(process.env.FACTORY_K3S_NODE_IP ?? ''));
  // This disposable DB must already contain the approved main+retained-old schema, and the
  // three scope rows from originFixture. Do not create, infer or repair migrations here.
  const first = postgres(databaseUrl!, { max: 1, connect_timeout: 5 });
  const second = postgres(databaseUrl!, { max: 1, connect_timeout: 5 });
  let firstClosed = false;
  let reopened: ReturnType<typeof postgres> | undefined;
  try {
    const f = originFixture(); f.target.client_id = 'origin-' + randomUUID();
    f.selection.operation_key = 'p02:v1:' + hash(randomUUID());
    const service = new SessionService(new PostgresSessionStore(first));
    const created = await service.startSessionAsync({ tenant_id: f.target.tenant_id as never,
      workspace_id: f.target.workspace_id as never, project_id: f.target.project_id as never,
      actor_id: f.target.actor_id, client_id: f.target.client_id, trace_id: f.selection.original_trace_id,
      idempotency_key: 'continuity:' + f.selection.operation_key });
    f.target.session_id = created.session_id;
    const fingerprint = legacyStartFingerprint(f.target, f.selection);
    const row = JSON.parse(f.snapshot.records[0]!.record_json!);
    Object.assign(row, { operation_key: f.selection.operation_key, fingerprint });
    Object.assign(row.proof, { operation_key: f.selection.operation_key, client_id: f.target.client_id,
      source_refs: created.source_refs, observed_at: new Date().toISOString(), result: {
        schema_version: 1, trace_id: f.selection.original_trace_id, source_refs: created.source_refs, data: created,
      } });
    await first`INSERT INTO wcp_continuity_operations (operation_key, dispatch_attempt, fingerprint, record)
      VALUES (${f.selection.operation_key}, 1, ${fingerprint}, ${first.json(row)})`;
    const rawStore = new PostgresSessionOriginStore(first);
    // Fixture approval explicitly derives from actual DB JSONB output, not reserialized HTTP text.
    const actual = await rawStore.read(f.target, f.selection);
    f.selection.original_record_digest = hash(actual.records[0]!.record_json!);
    f.selection.migration_inventory_digest = hash(actual.migration_inventory_json);
    f.grant.expires_at = new Date(Date.now() + 120_000).toISOString();
    const authority = { authorize: async () => structuredClone(f.grant) };
    const before = await new SessionOriginBridge(rawStore, authority).observe(f.target);
    assert.equal(JSON.parse(before.session.session_json).status, 'running');
    await new SessionService(new PostgresSessionStore(second)).endSessionAsync({
      tenant_id: f.target.tenant_id as never, workspace_id: f.target.workspace_id as never,
      project_id: f.target.project_id as never, session_id: created.session_id,
      trace_id: 'origin-other-writer', expected_version: 1, status: 'ended',
    });
    await first.end(); firstClosed = true;
    reopened = postgres(databaseUrl!, { max: 1, connect_timeout: 5 });
    const bridge = new SessionOriginBridge(new PostgresSessionOriginStore(reopened), authority);
    const after = await bridge.observe(f.target);
    assert.equal(JSON.parse(after.session.session_json).status, 'ended');
    assert.equal(after.original_record_json, before.original_record_json);
    assert.equal(after.original_records_digest, before.original_records_digest);
    assert.equal(after.migration_inventory_json, before.migration_inventory_json);
    // A new marker requires a new independently approved exact inventory, even if existing
    // columns still look compatible. Retain the added fixture marker for later inspection.
    await second`INSERT INTO schema_migrations (version, checksum) VALUES (${'fixture_origin_' + randomUUID()}, 'fixture-only')`;
    await assert.rejects(bridge.observe(f.target));
    await assert.rejects(bridge.observe({ ...f.target, client_id: 'another-owner' }));
  } finally {
    await Promise.allSettled([...(firstClosed ? [] : [first.end()]), second.end(), ...(reopened ? [reopened.end()] : [])]);
  }
});
