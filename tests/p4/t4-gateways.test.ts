import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { ApiGateway, CommandRouter, type RequestContext } from '@planemem/api-gateway';
import { McpGateway, type McpContext } from '@planemem/mcp-gateway';
import { runWorkctx } from '@planemem/workctx-cli';
import { ClientAdapter } from '../../integrations/codex/adapter.js';

const root = process.cwd();
const context: RequestContext = {
  tenant_id: 'tenant-p4',
  workspace_id: 'workspace-p4',
  project_id: 'project-p4',
  actor_id: 'actor-p4',
  client_id: 'codex',
  trace_id: 'trace-p4',
  capability: ['context.read'],
  schema_version: 1,
};

function result(data: unknown, trace_id = context.trace_id) {
  return {
    schema_version: 1 as const,
    trace_id,
    source_refs: [{ type: 'fixture', id: 'p4' }],
    data,
  };
}

test('P4-C01/T4.1 keeps REST policy, trace and error semantics centralized', async () => {
  const router = new CommandRouter((request) =>
    request.context.capability.includes('context.read')
      ? { allowed: true }
      : { allowed: false, reason: 'missing context.read' },
  );
  router.register('context.search', (request) =>
    result({ query: request.input.query }, request.context.trace_id),
  );
  const api = new ApiGateway(router, 2);
  api.route('POST', '/v1/context/search', 'context.search');
  const response = await api.handle({
    method: 'POST',
    path: '/v1/context/search',
    body: { query: 'release' },
    headers: {},
    context,
  });
  assert.equal(response.status, 200);
  assert.equal((response.body as { trace_id: string }).trace_id, context.trace_id);
  const denied = await api.handle({
    method: 'POST',
    path: '/v1/context/search',
    body: {},
    headers: {},
    context: { ...context, actor_id: 'actor-denied', capability: [] },
  });
  assert.equal(denied.status, 403);
  assert.equal((denied.body as { code: string }).code, 'DENIED');
  const limited = await api.handle({
    method: 'POST',
    path: '/v1/context/search',
    body: {},
    headers: {},
    context,
  });
  assert.equal(limited.status, 200);
  assert.equal(
    (
      await api.handle({
        method: 'POST',
        path: '/v1/context/search',
        body: {},
        headers: {},
        context,
      })
    ).status,
    429,
  );
  assert.equal(api.health().ready, true);
});

test('P4-C01/T4.1 makes idempotent writes replayable without duplicate effects', async () => {
  let effects = 0;
  const router = new CommandRouter();
  router.register('context.index', (request) => {
    effects += 1;
    return result({ id: request.input.id }, request.context.trace_id);
  });
  const api = new ApiGateway(router);
  api.route('POST', '/v1/context/index', 'context.index');
  const request = {
    method: 'POST' as const,
    path: '/v1/context/index',
    body: { id: 'memory-1' },
    headers: {},
    context: { ...context, idempotency_key: 'idem-p4-1' },
  };
  const first = await api.handle(request);
  const replay = await api.handle({ ...request, context: { ...request.context } });
  assert.equal(first.status, 200);
  assert.equal(replay.status, 200);
  assert.deepEqual(replay.body, first.body);
  assert.equal(effects, 1);

  const conflict = await api.handle({
    ...request,
    body: { id: 'memory-2' },
    context: { ...request.context },
  });
  assert.equal(conflict.status, 409);
  assert.equal((conflict.body as { code: string }).code, 'IDEMPOTENCY_KEY_REUSED');
  assert.equal(effects, 1);
});

test('P4-C02/T4.2 exposes MCP tools/resources/prompts with source fencing and capability listing', async () => {
  const router = new CommandRouter();
  router.register('context.search', (request) =>
    result({ query: request.input.query }, request.context.trace_id),
  );
  const mcp = new McpGateway(router);
  mcp.registerTool({
    name: 'context_search',
    description: 'Search context',
    operation: 'context.search',
  });
  mcp.registerResource('wcp://context/p4', {
    uri: 'wcp://context/p4',
    mimeType: 'text/markdown',
    text: 'fixture context',
  });
  mcp.registerPrompt('resume', (args) => `resume ${String(args.project)}`);
  const mcpContext: McpContext = {
    ...context,
    capabilities: { tools: {}, resources: {}, prompts: {} },
  };
  assert.equal(mcp.initialize('2024-11-05', mcpContext).serverInfo.version, '0.1.0');
  assert.equal(mcp.listTools(mcpContext).tools.length, 1);
  const tool = await mcp.callTool('context_search', { query: 'release' }, mcpContext);
  assert.equal(tool.isError, undefined);
  assert.equal(JSON.parse(tool.content[0]!.text).trace_id, context.trace_id);
  assert.match(
    mcp.getPrompt('resume', { project: 'p4' }, mcpContext).text,
    /Untrusted historical context/,
  );
  assert.equal(
    (await mcp.readResource('wcp://context/p4', mcpContext)).resource.text,
    'fixture context',
  );
  assert.equal((await mcp.callTool('missing', {}, mcpContext)).isError, true);
});

test('P4-U01/T4.3 keeps CLI JSON output parity and deterministic usage errors', async () => {
  const router = new CommandRouter();
  router.register('sync.reconcile', (request) =>
    result({ input: request.input }, request.context.trace_id),
  );
  const ok = await runWorkctx(['sync', '--json', '{"cursor":1}'], router, context);
  assert.equal(ok.exit_code, 0);
  assert.equal(JSON.parse(ok.stdout).trace_id, context.trace_id);
  const usage = await runWorkctx(['unknown'], router, context);
  assert.equal(usage.exit_code, 2);
  const invalid = await runWorkctx(['sync', '--json', '[]'], router, context);
  assert.equal(invalid.exit_code, 1);
  assert.match(invalid.stderr, /USAGE_ERROR/);
});

test('P4-I01/T4.4 negotiates client capabilities and records explicit degradation', () => {
  const adapter = new ClientAdapter('codex');
  const capabilities = adapter.register({
    harness: 'codex',
    mcp_version: '2024-11-05',
    context_budget: 2000,
    hooks: ['session_start'],
    trace_id: 'trace_adapter',
  });
  const negotiated = adapter.negotiate(capabilities, {
    mcp_version: '2024-11-05',
    capabilities: ['resources', 'tools'],
    max_context_budget: 1000,
  });
  assert.equal(negotiated.context_budget, 1000);
  assert.deepEqual(negotiated.degraded.sort(), ['context-pack', 'handoff', 'prompts']);
  assert.equal(adapter.doctor(capabilities).ready, true);
  assert.equal(adapter.finalizeSession(capabilities).finalized, true);
  assert.match(
    fs.readFileSync(path.join(root, 'integrations', 'support-matrix.yaml'), 'utf8'),
    /codex:/,
  );
});

test('durable operation routes recheck current policy and never cache an Unknown query', async () => {
  let allowed = true,
    calls = 0;
  const router = new CommandRouter(() =>
    allowed ? { allowed: true } : { allowed: false, reason: 'changed' },
  );
  router.register('session.continuity.query', (request) => {
    calls++;
    return result(calls === 1 ? null : { outcome: 'ConfirmedEffect' }, request.context.trace_id);
  });
  const api = new ApiGateway(router);
  api.handlerOwnsIdempotency('session.continuity.query');
  api.route('POST', '/v1/continuity/query', 'session.continuity.query');
  const request = {
    method: 'POST' as const,
    path: '/v1/continuity/query',
    body: {},
    headers: {},
    context: { ...context, idempotency_key: 'query-key' },
  };
  assert.equal((await api.handle(request)).status, 200);
  assert.deepEqual((await api.handle(request)).body, result({ outcome: 'ConfirmedEffect' }));
  allowed = false;
  assert.equal((await api.handle(request)).status, 403);
  assert.equal(calls, 2);
});
