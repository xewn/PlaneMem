import assert from 'node:assert/strict';
import test from 'node:test';
import { authenticatedContext } from '../../apps/api-gateway/src/authenticated-context.js';
import { SessionCurrentIdentityScope } from '../../apps/api-gateway/src/session-current-authority.js';
import { SessionCurrentReader, sessionCurrentOperation, sessionCurrentProtocol } from '../../apps/api-gateway/src/session-current.js';
import { SessionOriginBridge, sessionOriginSelectionDigest } from '../../apps/api-gateway/src/session-origin-bridge.js';
import { registerSessionOriginRoute, SessionOriginReader, sessionOriginPath, sessionOriginProtocol,
  sessionOriginOperation } from '../../apps/api-gateway/src/session-origin-http.js';
import { ApiGateway, type HttpRequest } from '../../apps/api-gateway/src/http.js';
import { CommandRouter, type CommandRequest } from '../../apps/api-gateway/src/router.js';
import type { OidcClaims } from '../../apps/api-gateway/src/oidc.js';
import { originFixture } from './session-origin-fixture.js';

// Actual route/binding/bridge code with synthetic claims, OPA, approval and DB sources.
// No listener, real signature verification, policy evaluation or production approval is used.
async function fixture() {
  const f = originFixture(2); const bearer = 'Bearer explicit-origin-test-token';
  const claims: OidcClaims = { iss: 'https://identity.example.test', aud: 'origin-test', sub: f.target.actor_id,
    client_id: f.target.client_id, tenant_id: f.target.tenant_id, workspace_id: f.target.workspace_id, project_id: f.target.project_id,
    scope: 'context.read context.origin.read', exp: Math.floor(Date.now() / 1000) + 120 };
  const state = { claims, verifications: 0, decisions: 0, reads: 0, approvals: 0, audits: 0, allowed: true,
    afterDecision: async (_call: number) => {}, afterPolicy: async (_call: number) => {}, afterApproval: async (_call: number) => {},
    inputs: [] as any[] };
  const verify = async (token: string | undefined) => { assert.equal(token, bearer); state.verifications++; return structuredClone(state.claims); };
  const context = await authenticatedContext(f.target, f.target.trace_id, bearer, verify, true);
  const identity = new SessionCurrentIdentityScope(verify, {
    decision_url: 'https://opa.example.test/v1/data/planemem/session_current/decision', policy_revision: 'a'.repeat(64),
    fetch_impl: async (_url, init) => {
      const body = String(init?.body); assert.equal(body.includes(bearer), false);
      assert.equal(new Headers(init?.headers).has('authorization'), false);
      const input = JSON.parse(body).input; state.inputs.push(input); state.decisions++;
      await state.afterDecision(state.decisions);
      return new Response(JSON.stringify({ result: { allow: state.allowed, policy_revision: 'a'.repeat(64), policy_digest: 'b'.repeat(64),
        endpoint_ref: f.target.endpoint_ref, configuration_digest: f.target.configuration_digest,
        expires_at_epoch_seconds: claims.exp } }), { headers: { 'content-type': 'application/json' } });
    },
  });
  const bridge = new SessionOriginBridge({ read: async () => { state.reads++; return f.snapshot; } },
    { authorize: async target => {
      await state.afterApproval(++state.approvals); return { ...structuredClone(f.grant), target: { ...target } };
    } });
  const router = new CommandRouter(async () => {
    await state.afterPolicy(state.audits + 1); return { allowed: true };
  }, () => { state.audits++; });
  const api = new ApiGateway(router);
  registerSessionOriginRoute(router, api, new SessionOriginReader(bridge, f.target), request => identity.forOriginRequest(request));
  const request: HttpRequest = { method: 'POST', path: sessionOriginPath,
    headers: { 'idempotency-key': 'deliberately-reused-origin-key' }, context,
    body: { protocol_version: sessionOriginProtocol, endpoint_ref: f.target.endpoint_ref, configuration_digest: f.target.configuration_digest,
      session_id: f.target.session_id, challenge: f.target.challenge, selection_id: f.selection.selection_id,
      selection_digest: sessionOriginSelectionDigest(f.selection) } };
  return { f, state, identity, api, request, bearer,
    run: () => identity.run(context, bearer, () => api.handle(request)) };
}

test('public origin response preserves full source under independent origin OIDC/OPA and three ABP checks', async () => {
  const f = await fixture(); const response = await f.run(); const data = (response.body as any).data;
  assert.equal(response.status, 200); assert.equal(response.headers['cache-control'], 'no-store');
  assert.equal(data.protocol_version, sessionOriginProtocol); assert.deepEqual(data.request, f.request.body);
  assert.equal(data.origin.original_records.length, 2);
  assert.equal(data.origin.original_record_json, f.f.snapshot.records[1]!.record_json);
  assert.equal(data.origin.migration_inventory_json, f.f.snapshot.migration_inventory_json);
  assert.equal(data.origin.approval_expires_at, f.f.grant.expires_at);
  assert.equal(JSON.parse(data.origin.session.session_json).status, 'ended');
  assert.match(data.authorization.authorization_ref, /^planemem-session-origin:[a-f0-9]{64}$/);
  assert.equal(JSON.stringify(response.body).includes(f.bearer), false);
  assert.equal(f.state.verifications, 3); assert.equal(f.state.decisions, 2); assert.equal(f.state.approvals, 3);
  assert.equal(f.state.audits, 2); assert.equal(f.state.reads, 1);
  for (const input of f.state.inputs) {
    assert.equal(input.action, sessionOriginOperation); assert.equal(input.selection_id, f.f.selection.selection_id);
    assert.equal(input.selection_digest, f.request.body!.selection_digest);
  }
});

test('current-read capability and header admin cannot disclose original factory evidence', async () => {
  const f = await fixture(); f.state.claims.scope = 'context.read';
  f.request.context.capability = ['context.read']; f.request.context.roles = ['admin'];
  const result = await f.run(); assert.notEqual(result.status, 200); assert.equal(f.state.reads, 0);
  assert.equal(result.headers['cache-control'], 'no-store');
});

test('selection mismatch is rejected before original database access', async () => {
  for (const key of ['selection_id', 'selection_digest']) {
    const f = await fixture(); f.request.body![key] = key === 'selection_id' ? '00000000-0000-0000-0000-000000000001' : '0'.repeat(64);
    const response = await f.run(); assert.notEqual(response.status, 200); assert.equal(f.state.reads, 0);
    assert.equal(JSON.stringify(response.body).includes('record_json'), false);
  }
});

test('same key always re-reads and binds the newly requested challenge', async () => {
  const f = await fixture(); const first = await f.run(); assert.equal(first.status, 200);
  f.request.body!.challenge = '9'.repeat(64);
  const second = await f.run(); assert.equal(second.status, 200);
  assert.equal(f.state.reads, 2); assert.equal((second.body as any).data.origin.target.challenge, '9'.repeat(64));
  assert.equal((first.body as any).data.origin.target.challenge, 'b'.repeat(64));
});

test('source approval revoked during final OPA wait cannot escape the terminal source check', async () => {
  const f = await fixture(); f.state.afterDecision = async call => { if (call === 2) f.f.grant.approval_digest = '0'.repeat(64); };
  const response = await f.run(); assert.notEqual(response.status, 200);
  assert.equal(f.state.approvals, 3); assert.equal(f.state.reads, 1);
  assert.equal(JSON.stringify(response.body).includes('original_records'), false);
});

test('final policy audit failure, OPA denial or changed verified claims suppress all source fields', async () => {
  for (const phase of ['policy', 'opa', 'identity']) {
    const f = await fixture();
    f.state.afterPolicy = async call => {
      if (call !== 2) return;
      if (phase === 'policy') throw new Error('fixture audit boundary failed');
      if (phase === 'opa') f.state.allowed = false;
      if (phase === 'identity') f.state.claims.scope = 'context.read';
    };
    const response = await f.run(); assert.notEqual(response.status, 200);
    assert.equal(JSON.stringify(response.body).includes('original_record_json'), false);
  }
});

test('captured origin authority cannot be used outside the original authenticated request', async () => {
  const f = await fixture(); let authority!: ReturnType<SessionCurrentIdentityScope['forOriginRequest']>;
  const command: CommandRequest = { operation: sessionOriginOperation, context: f.request.context, input: f.request.body! };
  await f.identity.run(f.request.context, f.bearer, async () => { authority = f.identity.forOriginRequest(command); });
  await assert.rejects(authority.authorize(f.f.target)); assert.equal(f.state.decisions, 0);
});

test('missing explicit reader or source returns an uncached failure', async () => {
  const f = await fixture();
  const router = new CommandRouter(); const unconfigured = new ApiGateway(router);
  registerSessionOriginRoute(router, unconfigured);
  const response = await unconfigured.handle(f.request); assert.notEqual(response.status, 200);
  assert.equal(response.headers['cache-control'], 'no-store');
});

test('cancellation during origin OPA is propagated and the started decision is fully settled', async () => {
  const f = await fixture(); const controller = new AbortController(); f.request.signal = controller.signal;
  let enter!: () => void; const entered = new Promise<void>(resolve => { enter = resolve; });
  let release!: () => void; const pending = new Promise<void>(resolve => { release = resolve; });
  let completed = false;
  f.state.afterDecision = async call => { if (call === 2) { enter(); await pending; } };
  const response = f.run().finally(() => { completed = true; });
  await entered; controller.abort(); await Promise.resolve(); assert.equal(completed, false);
  release(); assert.notEqual((await response).status, 200); assert.equal(f.state.approvals, 2);
});

test('origin selection digest has explicit stable key ordering', () => {
  const f = originFixture();
  const reordered = Object.fromEntries(Object.entries(f.selection).reverse()) as unknown as typeof f.selection;
  assert.equal(sessionOriginSelectionDigest(f.selection), sessionOriginSelectionDigest(reordered));
  assert.notEqual(sessionOriginSelectionDigest(f.selection), sessionOriginSelectionDigest({ ...f.selection, writer_fence_digest: '0'.repeat(64) }));
});

test('bridge-enabled current response also rechecks source approval after final external authorization', async () => {
  const f = await fixture(); let authorizations = 0; let approvals = 0;
  const bridge = new SessionOriginBridge({ read: async () => f.f.snapshot }, { authorize: async target => {
    approvals++; return { ...structuredClone(f.f.grant), target: { ...target } };
  } });
  const reader = new SessionCurrentReader(bridge, f.f.target, { authorize: async target => {
    if (++authorizations === 2) f.f.grant.approval_digest = '0'.repeat(64);
    return { target: { ...target }, identity_digest: 'a'.repeat(64), authorization_ref: 'fixture-current-grant',
      expires_at: f.f.grant.expires_at };
  } });
  const request: CommandRequest = { operation: sessionCurrentOperation, context: f.request.context,
    input: { protocol_version: sessionCurrentProtocol, endpoint_ref: f.f.target.endpoint_ref,
      configuration_digest: f.f.target.configuration_digest, session_id: f.f.target.session_id, challenge: f.f.target.challenge } };
  await assert.rejects(reader.read(request, async () => {}));
  assert.equal(authorizations, 2); assert.equal(approvals, 3);
});
