import assert from 'node:assert/strict';
import test from 'node:test';
import { authenticatedContext } from '../../apps/api-gateway/src/authenticated-context.js';
import { SessionCurrentIdentityScope } from '../../apps/api-gateway/src/session-current-authority.js';
import { SessionCurrentReader, registerSessionCurrentRoute, sessionCurrentPath,
  sessionCurrentProtocol, type SessionCurrentAuthority, type SessionCurrentTarget } from '../../apps/api-gateway/src/session-current.js';
import { ApiGateway, type HttpRequest } from '../../apps/api-gateway/src/http.js';
import { CommandRouter, type CommandRequest } from '../../apps/api-gateway/src/router.js';
import type { OidcClaims } from '../../apps/api-gateway/src/oidc.js';

const config = { endpoint_ref: 'explicit-current-fixture', configuration_digest: 'a'.repeat(64) };
const policyRevision = 'b'.repeat(64);
const decisionUrl = 'https://policy.example.test/v1/data/planemem/session_current/decision';
const token = 'Bearer explicit-unsigned-identity-fixture';

// Actual binding/reader/router code, with explicit OIDC claims and OPA HTTP fixtures.
// These fixtures are NOT real token signature verification, policy evaluation or production grants.
async function fixture() {
  const claims: OidcClaims = {
    iss: 'https://identity.example.test', aud: 'fixture', sub: 'actor-current', client_id: 'client-current',
    tenant_id: '01HF7YAT000000000000000001', workspace_id: '01HF7YAT000000000000000002',
    project_id: '01HF7YAT000000000000000003', scope: 'context.read', exp: Math.floor(Date.now() / 1000) + 120,
  };
  const state = {
    claims, verifications: 0, decisions: 0, reads: 0, audits: 0, allowed: true,
    policyDigest: 'c'.repeat(64), revision: policyRevision,
    afterRead: async () => {}, bodyTransform: (body: string) => body,
    requests: [] as string[],
  };
  const verify = async (authorization: string | undefined) => {
    assert.equal(authorization, token);
    state.verifications++;
    return structuredClone(state.claims);
  };
  const context = await authenticatedContext({
    tenant_id: String(claims.tenant_id), workspace_id: String(claims.workspace_id), project_id: String(claims.project_id),
  }, 'fixture-trace', token, verify, true);
  const source = new SessionCurrentIdentityScope(verify, {
    decision_url: decisionUrl, policy_revision: policyRevision,
    fetch_impl: async (url, init) => {
      assert.equal(url, decisionUrl);
      assert.equal(init?.redirect, 'error');
      assert.equal(init?.credentials, 'omit');
      assert.equal(init?.cache, 'no-store');
      state.decisions++;
      const body = String(init?.body);
      state.requests.push(body);
      assert.equal(body.includes(token), false);
      assert.equal(new Headers(init?.headers).has('authorization'), false);
      return new Response(state.bodyTransform(JSON.stringify({ result: {
        allow: state.allowed, policy_revision: state.revision, policy_digest: state.policyDigest,
        endpoint_ref: config.endpoint_ref, configuration_digest: config.configuration_digest,
        expires_at_epoch_seconds: claims.exp,
      } })), { status: 200, headers: { 'content-type': 'application/json' } });
    },
  });
  const router = new CommandRouter(() => ({ allowed: true }), () => { state.audits++; });
  const api = new ApiGateway(router);
  const reader = new SessionCurrentReader({ read: async target => {
    state.reads++;
    const session_json = JSON.stringify({
      schema_version: 1, tenant_id: target.tenant_id, workspace_id: target.workspace_id,
      project_id: target.project_id, actor_id: target.actor_id, client_id: target.client_id,
      session_id: target.session_id, status: 'running', version: 1,
      started_at: '2026-11-05T00:00:00.000Z', trace_id: 'start-original', source_refs: [],
    });
    await state.afterRead();
    return { session_json, observed_at: new Date().toISOString() };
  } }, config);
  registerSessionCurrentRoute(router, api, reader, request => source.forRequest(request));
  const request: HttpRequest = {
    method: 'POST', path: sessionCurrentPath, headers: {}, context,
    body: { protocol_version: sessionCurrentProtocol, ...config,
      session_id: '01HF7YAT000000000000000004', challenge: 'd'.repeat(64) },
  };
  return { state, source, api, request,
    run: () => source.run(context, token, () => api.handle(request)) };
}

test('real current binding verifies the original credential on both sides of storage', async () => {
  const f = await fixture();
  const response = await f.run();
  assert.equal(response.status, 200);
  assert.equal(f.state.verifications, 3);
  assert.equal(f.state.decisions, 2);
  assert.equal(f.state.reads, 1);
  assert.equal(f.state.audits, 2);
  assert.equal(JSON.stringify(response.body).includes(token), false);
  const firstInput = JSON.parse(f.state.requests[0]!).input;
  assert.equal(firstInput.target.session_id, f.request.body!.session_id);
  assert.equal(firstInput.context.actor_id, f.request.context.actor_id);
  assert.match(firstInput.context.token_digest, /^[a-f0-9]{64}$/);
});

test('a forged initial authenticated flag does not replace actual identity verification', async () => {
  const f = await fixture();
  f.request.context.actor_id = 'forged-actor';
  assert.equal((await f.run()).status, 403);
  assert.equal(f.state.reads, 0);
  assert.equal(f.state.decisions, 0);
});

test('OIDC identity, policy revision, policy contents and allow changes after the read reject', async () => {
  for (const mutate of [
    (f: Awaited<ReturnType<typeof fixture>>) => { f.state.claims.sub = 'another-actor'; },
    (f: Awaited<ReturnType<typeof fixture>>) => { f.state.claims.scope = 'other'; },
    (f: Awaited<ReturnType<typeof fixture>>) => { f.state.allowed = false; },
    (f: Awaited<ReturnType<typeof fixture>>) => { f.state.policyDigest = 'e'.repeat(64); },
    (f: Awaited<ReturnType<typeof fixture>>) => { f.state.revision = 'f'.repeat(64); },
  ]) {
    const f = await fixture();
    f.state.afterRead = async () => mutate(f);
    const response = await f.run();
    assert.equal(response.status, 403);
    assert.equal(f.state.reads, 1);
    assert.equal(JSON.stringify(response.body).includes('session_json'), false);
  }
});

test('missing private binding and expired binding cannot be reused', async () => {
  const f = await fixture();
  assert.equal((await f.api.handle(f.request)).status, 403);
  let captured!: SessionCurrentAuthority;
  let target!: SessionCurrentTarget;
  const command: CommandRequest = {
    operation: 'session.current.read', input: f.request.body!, context: f.request.context,
  };
  await f.source.run(f.request.context, token, async () => {
    captured = f.source.forRequest(command);
    target = {
      protocol_version: sessionCurrentProtocol, ...config,
      tenant_id: command.context.tenant_id, workspace_id: command.context.workspace_id,
      project_id: command.context.project_id, actor_id: command.context.actor_id,
      client_id: command.context.client_id, trace_id: command.context.trace_id,
      session_id: String(command.input.session_id), challenge: String(command.input.challenge),
    };
    await assert.rejects(() => f.source.run(f.request.context, token, async () => {}));
  });
  await assert.rejects(() => captured.authorize(target));
  assert.equal(f.state.reads, 0);
});

test('wrong, ambiguous or oversized policy responses never authorize a source read', async () => {
  for (const change of [
    (raw: string) => raw.replace('"allow":true', '"allow":false'),
    (raw: string) => raw.replace('"allow":true', '"allow":false,"allow":true'),
    (raw: string) => raw.replace('"policy_digest":', '"Policy_Digest":"bad","policy_digest":'),
    (raw: string) => raw.replace(config.endpoint_ref, 'other-endpoint'),
    (_raw: string) => '{"result":{}}',
    (raw: string) => ' '.repeat(8192) + raw,
  ]) {
    const f = await fixture();
    f.state.bodyTransform = change;
    assert.equal((await f.run()).status, 403);
    assert.equal(f.state.reads, 0);
  }
});

test('cancelled request cannot obtain an OPA grant', async () => {
  const f = await fixture();
  const controller = new AbortController();
  f.request.signal = controller.signal;
  f.state.afterRead = async () => { controller.abort(); };
  assert.equal((await f.run()).status, 403);
  assert.equal(f.state.decisions, 1);
});

test('concurrent requests in the same identity scope keep their target and trace private', async () => {
  const f = await fixture();
  let arrived = 0;
  let release!: () => void;
  const bothReading = new Promise<void>(resolve => { release = resolve; });
  f.state.afterRead = async () => { if (++arrived === 2) release(); await bothReading; };
  const other = structuredClone(f.request);
  other.context.trace_id = 'other-trace';
  other.body!.challenge = 'e'.repeat(64);
  const results = await Promise.all([
    f.run(), f.source.run(other.context, token, () => f.api.handle(other)),
  ]);
  assert.deepEqual(results.map(result => result.status), [200, 200]);
  assert.equal((results[0]!.body as any).data.trace_id, 'fixture-trace');
  assert.equal((results[1]!.body as any).data.trace_id, 'other-trace');
  assert.equal((results[1]!.body as any).data.challenge, 'e'.repeat(64));
  assert.deepEqual((results[0]!.body as any).data.authorization, (results[1]!.body as any).data.authorization);
  assert.equal(f.state.decisions, 4);
});

test('protected OPA target has no implicit URL or revision fallback', () => {
  for (const url of [
    decisionUrl.replace('https:', 'http:'), decisionUrl + '?override=true',
    decisionUrl.replace('policy.example.test', 'user:secret@policy.example.test'),
    'https://policy.example.test/v1/data/planemem/authz',
  ]) assert.throws(() => new SessionCurrentIdentityScope(async () => { throw new Error(); }, {
    decision_url: url, policy_revision: policyRevision,
  }));
});
