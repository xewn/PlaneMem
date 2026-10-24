import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildWavemateMcpInput,
  summarizeMcpTraffic,
} from '../../tools/run-wavemate-live-probe.mjs';

test('P8 Wavemate adapter builds a scoped streamable HTTP MCP row', () => {
  const row = buildWavemateMcpInput({
    url: 'http://127.0.0.1:3900/mcp',
    actor_id: 'wavemate-test',
  });
  assert.deepEqual(row, {
    id: 'planemem',
    serverName: 'planemem',
    transport: 'streamable-http',
    url: 'http://127.0.0.1:3900/mcp',
    headers: {
      'x-tenant-id': '01HF7YAT000000000000000001',
      'x-workspace-id': '01HF7YAT000000000000000002',
      'x-project-id': '01HF7YAT000000000000000003',
      'x-actor-id': 'wavemate-test',
      'x-client-id': 'wavemate',
      'x-capability': 'context.read context.write',
    },
    disabled: false,
    scope: 'global',
  });
});

test('P8 Wavemate traffic summary recognizes handshake and MCP tool/resource calls', () => {
  const summary = summarizeMcpTraffic([
    { phase: 'request', body: JSON.stringify({ method: 'server/discover' }) },
    { phase: 'request', body: JSON.stringify({ method: 'initialize' }) },
    { phase: 'request', body: JSON.stringify({ method: 'notifications/initialized' }) },
    { phase: 'request', body: JSON.stringify({ method: 'tools/list' }) },
    { phase: 'request', body: JSON.stringify({ method: 'tools/call' }) },
    { phase: 'request', body: JSON.stringify({ method: 'resources/list' }) },
    { phase: 'request', body: JSON.stringify({ method: 'resources/read' }) },
    { phase: 'response', status: 200, body: JSON.stringify({ result: {} }) },
    { phase: 'response', status: 200, body: JSON.stringify({ result: {} }) },
    { phase: 'response', status: 200, body: JSON.stringify({ result: {} }) },
    { phase: 'response', status: 200, body: JSON.stringify({ result: {} }) },
    { phase: 'response', status: 200, body: JSON.stringify({ result: {} }) },
    { phase: 'response', status: 200, body: JSON.stringify({ result: {} }) },
    { phase: 'response', status: 200, body: JSON.stringify({ result: {} }) },
    { phase: 'response', status: 200, body: JSON.stringify({ error: { code: -32601 } }) },
  ]);
  assert.deepEqual(summary, {
    requests: 7,
    server_discover: 1,
    initialize: 1,
    initialized_notification: 1,
    tools_list: 1,
    tools_call: 1,
    resources_list: 1,
    resources_read: 1,
    successful_responses: 8,
    failed_responses: 0,
    jsonrpc_errors: 1,
  });
});
