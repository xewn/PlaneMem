import assert from 'node:assert/strict';
import test from 'node:test';
import { inspectSessionOrigin, SessionOriginBridge } from '../../apps/api-gateway/src/session-origin-bridge.js';
import { SessionCurrentReader, sessionCurrentOperation, type SessionCurrentGrant } from '../../apps/api-gateway/src/session-current.js';
import { originFixture, hash } from './session-origin-fixture.js';

test('preserved complete original chain links to a later terminal row without rewriting the old proof', async () => {
  const f = originFixture(3); let checks = 0; let reads = 0;
  const bridge = new SessionOriginBridge({ read: async () => { reads++; return f.snapshot; } },
    { authorize: async () => { checks++; return f.grant; } });
  const observed = await bridge.observe(f.target);
  assert.equal(checks, 2); assert.equal(reads, 1);
  assert.equal(observed.original_record_json, f.snapshot.records.at(-1)!.record_json);
  assert.equal(JSON.parse(observed.original_record_json).proof.result.data.status, 'running');
  assert.equal(JSON.parse(observed.session.session_json).status, 'ended');
  assert.equal(observed.migration_inventory_json, f.snapshot.migration_inventory_json);
  assert.equal(observed.original_records.length, 3);
  assert.notEqual(observed.original_records, f.snapshot.records);
  assert.equal(observed.target.challenge, f.target.challenge);
  assert.equal(observed.original_record_digest, hash(observed.original_record_json));
});

test('same ID or valid-looking main receipt never substitutes for the old original operation', () => {
  for (const change of ['missing', 'wrong-scope', 'main-receipt', 'original-status', 'source-ref', 'fingerprint',
    'sql-fingerprint', 'record-hash', 'marker', 'changed-start', 'resume-enrichment', 'trailing-attempt', 'gap', 'prior-effect']) {
    const f = originFixture(2); const last = f.snapshot.records.at(-1)!;
    const record = JSON.parse(last.record_json!);
    switch (change) {
      case 'missing': f.snapshot.records = []; break;
      case 'wrong-scope': record.proof.scope.workspace_id = f.target.project_id; break;
      case 'main-receipt': record.proof = { status: 'recorded', session_id: f.target.session_id }; break;
      case 'original-status': record.proof.result.data.status = 'ended'; break;
      case 'source-ref': record.proof.source_refs[0].id = f.target.session_id; break;
      case 'fingerprint': record.fingerprint = '0'.repeat(64); break;
      case 'sql-fingerprint': last.fingerprint = '0'.repeat(64); break;
      case 'marker': f.snapshot.session_idempotency_key = 'unrelated-main-key'; break;
      case 'changed-start': {
        const image = JSON.parse(f.snapshot.session!.session_json); image.started_at = '2026-11-04T00:00:00.000Z';
        f.snapshot.session!.session_json = JSON.stringify(image); break;
      }
      case 'resume-enrichment': {
        const image = JSON.parse(f.snapshot.session!.session_json); image.parent_session_id = f.target.project_id;
        image.resume_origin = { handoff_id: f.target.project_id, checkpoint_id: f.target.project_id, require_claimed: true };
        f.snapshot.session!.session_json = JSON.stringify(image); break;
      }
      case 'trailing-attempt': f.snapshot.records.push({ ...last, dispatch_attempt: 3 }); break;
      case 'gap': f.snapshot.records[0]!.dispatch_attempt = 2; break;
      case 'prior-effect': {
        const prior = JSON.parse(f.snapshot.records[0]!.record_json!); prior.proof.outcome = 'ConfirmedEffect';
        f.snapshot.records[0]!.record_json = JSON.stringify(prior); break;
      }
    }
    last.record_json = JSON.stringify(record);
    if (change !== 'record-hash') f.selection.original_record_digest = hash(last.record_json);
    else last.record_json += ' ';
    assert.throws(() => inspectSessionOrigin(f.snapshot, f.grant), change);
  }
});

test('migration exact names, marker values, ordering and full approved digest cannot be inferred from numeric prefixes', () => {
  for (const change of ['missing-old', 'renamed', 'checksum', 'alias', 'changed-inventory', 'unsorted', 'short-commit', 'empty-lineage']) {
    const f = originFixture(); const inventory = JSON.parse(f.snapshot.migration_inventory_json);
    if (change === 'missing-old') inventory.splice(2, 1);
    if (change === 'renamed') inventory[2].version = '011';
    if (change === 'checksum') inventory[2].checksum = 'some-other-marker';
    if (change === 'alias') inventory[2].Version = inventory[2].version;
    if (change === 'changed-inventory') inventory[1].checksum = 'changed';
    if (change === 'unsorted') inventory.reverse();
    if (change === 'short-commit') f.selection.current_source_commit = '70a141f';
    if (change === 'empty-lineage') f.selection.database_lineage_ref = '';
    f.snapshot.migration_inventory_json = JSON.stringify(inventory);
    if (change !== 'changed-inventory') f.selection.migration_inventory_digest = hash(f.snapshot.migration_inventory_json);
    assert.throws(() => inspectSessionOrigin(f.snapshot, f.grant), change);
  }
});

test('approval before and after owning transaction must be exactly the same current grant', async () => {
  for (const change of ['revoked', 'expiry', 'lineage', 'identity', 'commit', 'target']) {
    const f = originFixture(); let calls = 0;
    const bridge = new SessionOriginBridge({ read: async () => f.snapshot }, { authorize: async () => {
      if (++calls === 1) return f.grant;
      const last = structuredClone(f.grant);
      if (change === 'revoked') throw new Error('fixture approval revoked after resource release');
      if (change === 'expiry') last.expires_at = new Date(Date.now() + 120_000).toISOString();
      if (change === 'lineage') last.selection.database_lineage_digest = '0'.repeat(64);
      if (change === 'identity') last.identity_digest = '0'.repeat(64);
      if (change === 'commit') last.selection.current_source_commit = '0'.repeat(40);
      if (change === 'target') last.target.challenge = '0'.repeat(64);
      return last;
    } });
    await assert.rejects(bridge.observe(f.target)); assert.equal(calls, 2);
  }
});

test('missing bridge table or approval has no unlinked-current fallback', async () => {
  const f = originFixture(); let reads = 0;
  const store = { read: async () => { reads++; throw new Error('fixture missing table'); } };
  await assert.rejects(new SessionOriginBridge(store, { authorize: async () => { throw new Error('no ABP source'); } }).read(f.target));
  assert.equal(reads, 0);
  await assert.rejects(new SessionOriginBridge(store, { authorize: async () => f.grant }).read(f.target));
  assert.equal(reads, 1);
});

test('cancellation waits for the pending source and never returns a late origin', async () => {
  const f = originFixture(); const controller = new AbortController();
  let enter!: () => void; const entered = new Promise<void>(resolve => { enter = resolve; });
  let release!: () => void; const pending = new Promise<void>(resolve => { release = resolve; });
  let finished = false; let returned = false;
  const bridge = new SessionOriginBridge({ read: async (_target, _selection, signal) => {
    enter(); await pending; assert.equal(signal!.aborted, true); finished = true; return f.snapshot;
  } }, { authorize: async () => f.grant });
  const result = bridge.observe(f.target, controller.signal).finally(() => { returned = true; });
  const rejected = assert.rejects(result);
  await entered; controller.abort(); await Promise.resolve(); assert.equal(returned, false);
  release(); await rejected; assert.equal(finished, true);
});

test('source approval deadline survives later current OIDC/OPA and route-policy awaits', async () => {
  const f = originFixture(); f.grant.expires_at = new Date(Date.now() + 10_000).toISOString();
  const bridge = new SessionOriginBridge({ read: async () => f.snapshot }, { authorize: async () => f.grant });
  const reader = new SessionCurrentReader(bridge, f.target, { authorize: async target => ({
    target: { ...target }, identity_digest: 'a'.repeat(64), authorization_ref: 'fixture-current-policy',
    expires_at: new Date(Date.parse(f.grant.expires_at) + 60_000).toISOString(),
  } satisfies SessionCurrentGrant) });
  const { tenant_id, workspace_id, project_id, actor_id, client_id, trace_id } = f.target;
  const result = await reader.read({ operation: sessionCurrentOperation,
    context: { tenant_id, workspace_id, project_id, actor_id, client_id, trace_id, schema_version: 1, capability: ['context.read'],
      token_expires_at: new Date(Date.now() + 120_000).toISOString() },
    input: { protocol_version: f.target.protocol_version, endpoint_ref: f.target.endpoint_ref, configuration_digest: f.target.configuration_digest,
      session_id: f.target.session_id, challenge: f.target.challenge } }, async () => {});
  assert.equal((result.data as any).authorization.expires_at, f.grant.expires_at);
});
