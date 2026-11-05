import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { ApiGateway, type HttpRequest } from '../../apps/api-gateway/src/http.js';
import { CommandRouter, type RequestContext } from '../../apps/api-gateway/src/router.js';
import { operationPolicyAction } from '../../apps/api-gateway/src/server.js';
import {
  parseSessionCurrentRequest, registerSessionCurrentRoute, SessionCurrentReader, sessionCurrentPath, sessionCurrentProtocol,
  sessionCurrentOperation, type SessionCurrentGrant, type SessionCurrentTarget,
} from '../../apps/api-gateway/src/session-current.js';

const configuration = { endpoint_ref: 'current-session-fixture', configuration_digest: 'a'.repeat(64) };
const context: RequestContext = {
  schema_version: 1, tenant_id: '01HF7YAT000000000000000001',
  workspace_id: '01HF7YAT000000000000000002', project_id: '01HF7YAT000000000000000003',
  actor_id: 'current-reader', client_id: 'current-client', trace_id: 'current-read-trace',
  capability: ['context.read'], idempotency_key: 'deliberately-reused-key',
};
const sessionId = '01HF7YAT000000000000000004';

test('wire request rejects duplicate, escaped duplicate, alias, nested and invalid UTF-8 input', () => {
  assert.deepEqual(parseSessionCurrentRequest(Buffer.from('{"a":"escaped \\" quote"}')), { a: 'escaped " quote' });
  for (const raw of ['{"a":"x","a":"y"}', '{"a":"x","\\u0061":"y"}',
    '{"a":"x","A":"y"}', '{"a":{"b":"x"}}', '{"a":4}', '[]', '{"a":"' + 'x'.repeat(4096) + '"}'])
    assert.throws(() => parseSessionCurrentRequest(Buffer.from(raw)));
  assert.throws(() => parseSessionCurrentRequest(Uint8Array.from([0x7b, 0x22, 0xff, 0x22, 0x7d])));
});

// Explicit in-memory storage/authority/policy fixtures. These do not authenticate production users
// or prove PostgreSQL persistence. No listeners, model calls or remote operations are used here.
function fixture() {
  const state = {
    allow: true, reads: 0, authorizations: 0, policies: 0, audits: 0, missing: false,
    afterRead: async () => {}, afterPolicy: async () => {},
    mutateGrant: (_grant: SessionCurrentGrant, _call: number) => {},
    expires: new Date(Date.now() + 60_000).toISOString(),
    image: {
      schema_version: 1, tenant_id: context.tenant_id, workspace_id: context.workspace_id,
      project_id: context.project_id, actor_id: context.actor_id, client_id: context.client_id,
      session_id: sessionId, status: 'running', version: 1,
      started_at: '2026-11-05T00:00:00.000Z', trace_id: 'original-start',
      source_refs: [{ type: 'session', id: context.client_id }],
    } as Record<string, unknown>,
  };
  const router = new CommandRouter(async () => {
    state.policies++;
    await state.afterPolicy();
    return state.allow ? { allowed: true } : { allowed: false, reason: 'fixture-revoked' };
  }, () => { state.audits++; });
  const api = new ApiGateway(router);
  const store = { read: async () => {
    state.reads++;
    const snapshot = state.missing ? null : {
      session_json: JSON.stringify(state.image), observed_at: new Date().toISOString(),
    };
    await state.afterRead();
    return snapshot;
  } };
  const authority = { authorize: async (target: Readonly<SessionCurrentTarget>) => {
    state.authorizations++;
    const grant: SessionCurrentGrant = {
      target: { ...target }, identity_digest: 'b'.repeat(64),
      authorization_ref: 'explicit-fixture-authority', expires_at: state.expires,
    };
    state.mutateGrant(grant, state.authorizations);
    return grant;
  } };
  registerSessionCurrentRoute(router, api, new SessionCurrentReader(store, configuration, authority));
  const request: HttpRequest = {
    method: 'POST', path: sessionCurrentPath, headers: {},
    context: { ...structuredClone(context), token_expires_at: state.expires },
    body: { protocol_version: sessionCurrentProtocol, ...configuration,
      session_id: sessionId, challenge: 'c'.repeat(64) },
  };
  return { state, api, request, store };
}

test('current observations re-read after a change even with the same idempotency key', async () => {
  const f = fixture();
  const first = await f.api.handle(f.request);
  assert.equal(first.status, 200);
  const original = (first.body as any).data.session_json;
  f.state.image.status = 'ended';
  f.state.image.version = 2;
  f.state.image.ended_at = '2026-11-05T00:01:00.000Z';
  const second = await f.api.handle(f.request);
  assert.equal(second.status, 200);
  const data = (second.body as any).data;
  assert.equal(JSON.parse(data.session_json).status, 'ended');
  assert.equal(JSON.parse(original).status, 'running');
  assert.equal(data.session_digest, createHash('sha256').update(data.session_json).digest('hex'));
  assert.equal(data.challenge, f.request.body!.challenge);
  assert.equal(second.headers['cache-control'], 'no-store');
  assert.equal(f.state.reads, 2);
  assert.equal(f.state.authorizations, 4);
  assert.equal(f.state.audits, 4);
  f.state.allow = false;
  const revoked = await f.api.handle(f.request);
  assert.equal(revoked.status, 403);
  assert.equal(revoked.headers['cache-control'], 'no-store');
  assert.equal(f.state.reads, 2);
});

test('post-read policy revocation and current authority changes disclose no session', async () => {
  const revoked = fixture();
  revoked.state.afterRead = async () => { revoked.state.allow = false; };
  assert.equal((await revoked.api.handle(revoked.request)).status, 403);
  for (const field of ['identity_digest', 'authorization_ref', 'expires_at'] as const) {
    const f = fixture();
    f.state.mutateGrant = (grant, call) => {
      if (call === 2) grant[field] = field === 'expires_at'
        ? new Date(Date.parse(grant.expires_at) + 10_000).toISOString() : 'd'.repeat(64);
    };
    const response = await f.api.handle(f.request);
    assert.equal(response.status, 403);
    assert.equal(JSON.stringify(response.body).includes('session_json'), false);
  }
});

test('unconfigured authority, wrong target and expired grants cause zero source reads', async () => {
  const f = fixture();
  const router = new CommandRouter();
  const api = new ApiGateway(router);
  registerSessionCurrentRoute(router, api, new SessionCurrentReader(f.store, configuration));
  assert.equal((await api.handle(f.request)).status, 503);
  assert.equal(f.state.reads, 0);
  for (const mutate of [
    (grant: SessionCurrentGrant) => { grant.target.actor_id = 'someone-else'; },
    (grant: SessionCurrentGrant) => { grant.target.challenge = 'd'.repeat(64); },
    (grant: SessionCurrentGrant) => { grant.expires_at = '2000-01-01T00:00:00.000Z'; },
  ]) {
    const denied = fixture();
    denied.state.mutateGrant = mutate;
    assert.equal((await denied.api.handle(denied.request)).status, 403);
    assert.equal(denied.state.reads, 0);
  }
});

test('missing is only returned after both authorization and policy passes', async () => {
  const f = fixture();
  f.state.missing = true;
  assert.equal((await f.api.handle(f.request)).status, 404);
  assert.equal(f.state.authorizations, 2);
  assert.equal(f.state.policies, 2);
  f.state.afterRead = async () => { f.state.allow = false; };
  assert.equal((await f.api.handle(f.request)).status, 403);
});

test('missing, malformed and expired request deadlines are not given a default extension', async () => {
  for (const expiry of [undefined, 'not-a-date', '2000-01-01T00:00:00.000Z']) {
    const f = fixture();
    if (expiry === undefined) delete f.request.context.token_expires_at;
    else f.request.context.token_expires_at = expiry;
    assert.equal((await f.api.handle(f.request)).status, 403);
    assert.equal(f.state.reads, 0);
    assert.equal(f.state.authorizations, 0);
  }
});

test('bad coordinates, aliases and unknown input fields fail before reading', async () => {
  for (const delta of [
    { session_id: sessionId.toLowerCase() }, { challenge: 'short' },
    { configuration_digest: 'd'.repeat(64) }, { endpoint_ref: 'other' },
    { protocol_version: 'p02-continuity-v1' }, { Session_id: sessionId }, { payload: {} },
  ]) {
    const f = fixture();
    Object.assign(f.request.body!, delta);
    assert.equal((await f.api.handle(f.request)).status, 400);
    assert.equal(f.state.reads, 0);
  }
});

test('damaged or cross-owner persisted public images are never observations', async () => {
  for (const delta of [
    { actor_id: 'wrong' }, { workspace_id: sessionId }, { version: Number.MAX_SAFE_INTEGER + 1 },
    { status: 'ended' }, { status: 'unknown' }, { started_at: '2026-02-30T00:00:00.000Z' },
    { parent_session_id: 'invalid' }, { Version: 1 },
    { source_refs: [{ type: 'session', id: context.client_id, revision: null }] },
    { source_refs: [{ type: 'session', id: 'x'.repeat(70_000) }] },
  ]) {
    const f = fixture();
    Object.assign(f.state.image, delta);
    const response = await f.api.handle(f.request);
    assert.equal(response.status, 400);
    assert.equal(JSON.stringify(response.body).includes('session_json'), false);
  }
});

test('cancellation during source wait is awaited and yields no observation', async () => {
  const f = fixture();
  const controller = new AbortController();
  f.request.signal = controller.signal;
  let finished = false;
  f.state.afterRead = async () => { controller.abort(); await Promise.resolve(); finished = true; };
  assert.equal((await f.api.handle(f.request)).status, 403);
  assert.equal(finished, true);
  assert.equal(f.state.authorizations, 1);
});

test('actual router audits are repeated and an audit failure prevents disclosure', async () => {
  const f = fixture();
  let audits = 0;
  const router = new CommandRouter(() => ({ allowed: true }), () => {
    if (++audits === 2) throw new Error('explicit audit fixture failure');
  });
  const api = new ApiGateway(router);
  const authority = { authorize: async (target: SessionCurrentTarget): Promise<SessionCurrentGrant> => ({
    target, identity_digest: 'a'.repeat(64), authorization_ref: 'fixture', expires_at: f.state.expires,
  }) };
  registerSessionCurrentRoute(router, api, new SessionCurrentReader(f.store, configuration, authority));
  assert.equal((await api.handle(f.request)).status, 500);
  assert.equal(audits, 2);
  assert.equal(operationPolicyAction(sessionCurrentOperation), 'context.read');
  assert.equal(operationPolicyAction('session.start'), 'session.write');
});
