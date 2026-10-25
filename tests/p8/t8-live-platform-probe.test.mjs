import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import test from 'node:test';

import { runLivePlatformProbe } from '../../tools/live-platform-probe.mjs';

async function readBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return chunks.length === 0 ? {} : JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

test('P8-E03/T8.2 verifies the deployed runtime HTTP boundary and idempotent search flow', async () => {
  let webhookAccepted = false;
  const server = createServer(async (request, response) => {
    const body = await readBody(request);
    response.setHeader('content-type', 'application/json');
    if (request.url === '/health') {
      response.end(
        JSON.stringify({ service: 'planemem-platform', version: '0.1.0', status: 'ok' }),
      );
      return;
    }
    if (request.url === '/health/ready') {
      response.end(
        JSON.stringify({
          service: 'planemem-platform',
          version: '0.1.0',
          status: 'ready',
          ready: true,
        }),
      );
      return;
    }
    if (request.url === '/version') {
      response.end(JSON.stringify({ version: '0.1.0' }));
      return;
    }
    if (request.url === '/v1/context/index') {
      response.end(
        JSON.stringify({
          schema_version: 1,
          trace_id: request.headers.traceparent,
          source_refs: body.source_refs,
          data: body,
        }),
      );
      return;
    }
    if (request.url === '/v1/context/search') {
      response.end(
        JSON.stringify({
          schema_version: 1,
          trace_id: request.headers.traceparent,
          source_refs: [{ type: 'probe', id: 'live-platform-probe' }],
          data: {
            query: body.query,
            hits: [
              {
                id: 'live-platform-probe-context',
                tenant_id: request.headers['x-tenant-id'],
                workspace_id: request.headers['x-workspace-id'],
                project_id: request.headers['x-project-id'],
              },
            ],
          },
        }),
      );
      return;
    }
    if (request.url === '/v1/plane/webhook') {
      const status = webhookAccepted ? 'duplicate' : 'accepted';
      webhookAccepted = true;
      response.end(JSON.stringify({ status, effect_applied: status === 'accepted' }));
      return;
    }
    if (request.url === '/mcp') {
      if (body.method === 'initialize') {
        response.end(
          JSON.stringify({
            jsonrpc: '2.0',
            id: body.id,
            result: { serverInfo: { name: 'planemem-mcp' } },
          }),
        );
        return;
      }
      if (body.method === 'tools/list') {
        response.end(
          JSON.stringify({
            jsonrpc: '2.0',
            id: body.id,
            result: { tools: [{ name: 'context_search' }] },
          }),
        );
        return;
      }
      if (body.method === 'tools/call') {
        response.end(
          JSON.stringify({
            jsonrpc: '2.0',
            id: body.id,
            result: {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify({
                    data: { hits: [{ id: 'plane:Project:live-plane-project' }] },
                  }),
                },
              ],
            },
          }),
        );
        return;
      }
      if (body.method === 'resources/read') {
        response.end(
          JSON.stringify({
            jsonrpc: '2.0',
            id: body.id,
            result: {
              contents: [{ uri: 'wcp://context/plane:Project:live-plane-project' }],
            },
          }),
        );
        return;
      }
    }
    response.statusCode = 404;
    response.end(JSON.stringify({ error: 'not found' }));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.equal(typeof address, 'object');

  try {
    const result = await runLivePlatformProbe({
      base_url: `http://127.0.0.1:${address.port}`,
      trace_id: 'trace-test-live-platform-probe',
    });
    assert.equal(result.status, 'passed');
    assert.equal(result.idempotency.same_response, true);
    assert.equal(
      result.steps.every((step) => step.status === 'passed'),
      true,
    );
    assert.equal(result.steps.length, 12);
    assert.deepEqual(result.transports, { plane_webhook: 'passed', mcp_http_jsonrpc: 'passed' });
    assert.equal(result.scope.project_id, '01HF7YAT000000000000000003');
  } finally {
    server.close();
    await once(server, 'close');
  }
});
