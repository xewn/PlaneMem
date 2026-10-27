import assert from 'node:assert/strict';
import test from 'node:test';
import { AiMemoryMcpProvider } from '@planemem/context-service';

const ws = '11111111-1111-4111-8111-111111111111';
const project = '22222222-2222-4222-8222-222222222222';
const id = '33333333-3333-4333-8333-333333333333';
const command = {
  action: 'page.write' as const,
  arguments: {
    workspace: 'factory',
    project: 'product',
    path: 'proof.md',
    body: 'Original evidence',
    operation: {
      protocol: 'ai-memory.operation.v1' as const,
      workspace_id: ws,
      project_id: project,
      operation_key: 'original-1',
      specification_digest: 'a'.repeat(64),
      attempt: 1,
    },
  },
};
function receipt() {
  return {
    protocol: 'ai-memory.operation.v1',
    receipt_id: id,
    recorded_at_us: 1793094825123456,
    outcome: 'succeeded',
    request: {
      attempt: 1,
      binding: {
        workspace_id: ws,
        project_id: project,
        operation_key: 'original-1',
        specification_digest: 'a'.repeat(64),
        request_digest: 'b'.repeat(64),
        actor: 'user:alice',
        client_id: 'worker-a',
        action: 'page.write',
      },
    },
    result: { page_id: id, path: 'actors/u-alice/proof.md', body_sha256: 'c'.repeat(64) },
  };
}
function fixture(answer: (name: string, args: any) => unknown) {
  const calls: any[] = [];
  const provider = new AiMemoryMcpProvider({
    serverUrl: 'http://memory.test',
    actor_id: 'alice',
    client_id: 'worker-a',
    token: 'test-proxy',
    fetch_impl: async (url, init) => {
      calls.push({
        url: String(url),
        body: init?.body ? JSON.parse(String(init.body)) : null,
        headers: new Headers(init?.headers),
      });
      if (String(url).includes('/api/v1/projects'))
        return Response.json([
          {
            workspace_name: 'factory',
            project_name: 'product',
            workspace_id: ws,
            project_id: project,
          },
        ]);
      const body = JSON.parse(String(init?.body));
      const result =
        body.method === 'initialize'
          ? {}
          : body.method === 'tools/list'
            ? answer('tools/list', {})
            : {
                content: [
                  {
                    type: 'text',
                    text: JSON.stringify(answer(body.params.name, body.params.arguments)),
                  },
                ],
              };
      return Response.json({ jsonrpc: '2.0', id: body.id, result });
    },
  });
  return { operations: provider.originalOperations(), calls };
}

test('original MCP commands preserve the stamp and authenticated identity', async () => {
  const f = fixture(() => receipt());
  const result = await f.operations.execute(command, 'trace-original');
  assert.deepEqual(result, receipt());
  assert.deepEqual(f.calls.at(-1).body.params.arguments, command.arguments);
  assert.equal(f.calls.at(-1).headers.get('x-memory-actor-user'), 'alice');
  assert.equal(f.calls.at(-1).headers.get('x-memory-actor-client'), 'worker-a');
});

test('original query remains unknown without issuing an execute or close', async () => {
  const f = fixture(() => ({
    protocol: 'ai-memory.operation.v1',
    outcome: 'unknown',
    receipt: null,
  }));
  assert.equal(await f.operations.query(command, 'trace-query'), null);
  const mutations = f.calls.filter((c) => c.body?.method === 'tools/call');
  assert.equal(mutations.length, 1);
  assert.equal(mutations[0].body.params.name, 'memory_operation_query');
  assert.deepEqual(mutations[0].body.params.arguments, command);
});

test('original receipts cannot substitute another actor, client, attempt or object', async () => {
  for (const edit of [
    (r: any) => {
      r.request.binding.actor = 'user:bob';
    },
    (r: any) => {
      r.request.binding.client_id = 'worker-b';
    },
    (r: any) => {
      r.request.attempt = 2;
    },
    (r: any) => {
      r.request.binding.project_id = id;
    },
    (r: any) => {
      r.recorded_at_us = Number.MAX_SAFE_INTEGER + 1;
    },
  ]) {
    const invalid = receipt();
    edit(invalid);
    await assert.rejects(
      () => fixture(() => invalid).operations.execute(command, 'trace-invalid'),
      /original receipt/,
    );
  }
  assert.deepEqual(
    await fixture(() => receipt()).operations.execute(command, 'trace-valid'),
    receipt(),
  );
});

test('scope preparation resolves exact project UUIDs through the public read API', async () => {
  const f = fixture(() => ({}));
  assert.deepEqual(await f.operations.resolveScope('factory', 'product', 'trace-resolve'), {
    workspace: 'factory',
    project: 'product',
    workspace_id: ws,
    project_id: project,
  });
  await assert.rejects(() => f.operations.resolveScope('factory', 'replacement', 'trace-missing'));
  assert.equal(f.calls.filter((c) => c.body?.method === 'tools/call').length, 0);
});

test('handoff preparation reads the exact original page version before freezing its summary', async () => {
  const f = fixture(() => ({ page_id: id, path: 'proof.md', body: 'Original page body' }));
  assert.equal(
    await f.operations.readOriginalPage('factory', 'product', 'proof.md', id, 'trace-page'),
    'Original page body',
  );
  await assert.rejects(
    () => f.operations.readOriginalPage('factory', 'product', 'proof.md', ws, 'trace-wrong-page'),
    /page version/,
  );
  assert.equal(
    f.calls
      .filter((c) => c.body?.method === 'tools/call')
      .every((c) => c.body.params.name === 'memory_read_page'),
    true,
  );
});

test('receipt capability checks actual tool schemas and does not assume a version string', async () => {
  let tools: any[] = [];
  const f = fixture(() => ({ tools }));
  assert.equal(await f.operations.isReady('trace-schema'), false);
  tools = ['memory_write_page', 'memory_handoff_begin', 'memory_handoff_accept'].map((name) => ({
    name,
    inputSchema: { properties: { operation: {} } },
  }));
  tools.push(
    ...['memory_operation_query', 'memory_operation_close'].map((name) => ({
      name,
      inputSchema: { properties: { action: {}, arguments: {} } },
    })),
  );
  assert.equal(await f.operations.isReady('trace-schema'), true);
  tools.pop();
  assert.equal(await f.operations.isReady('trace-schema'), false);
});
