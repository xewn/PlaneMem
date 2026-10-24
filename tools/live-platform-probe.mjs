import { createHmac } from 'node:crypto';

const DEFAULT_SCOPE = {
  tenant_id: '01HF7YAT000000000000000001',
  workspace_id: '01HF7YAT000000000000000002',
  project_id: '01HF7YAT000000000000000003',
};

function requireOk(condition, message) {
  if (!condition) throw new Error(message);
}

async function request(fetchImpl, baseUrl, path, options = {}) {
  const response = await fetchImpl(`${baseUrl}${path}`, options);
  const raw = await response.text();
  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    throw new Error(`${path} returned non-JSON response (${response.status})`);
  }
  requireOk(response.ok, `${path} returned HTTP ${response.status}`);
  return payload;
}

export async function runLivePlatformProbe({
  base_url = `http://127.0.0.1:${process.env.WORKCTX_PORT ?? '3000'}`,
  trace_id = 'trace-live-platform-probe',
  fetch_impl = globalThis.fetch,
  scope = DEFAULT_SCOPE,
  webhook_secret = process.env.PLANE_WEBHOOK_SECRET ?? 'compose-local-webhook-secret',
} = {}) {
  requireOk(typeof fetch_impl === 'function', 'global fetch is unavailable');
  const steps = [];
  const source_refs = [{ type: 'live-service', id: 'planemem-platform' }];
  let currentStep = 'live.health';
  try {
    const health = await request(fetch_impl, base_url, '/health');
    requireOk(
      health.status === 'ok' && health.service === 'planemem-platform',
      'health contract mismatch',
    );
    steps.push({ name: currentStep, status: 'passed', trace_id });

    currentStep = 'live.readiness';
    const readiness = await request(fetch_impl, base_url, '/health/ready');
    requireOk(
      readiness.ready === true && readiness.status === 'ready',
      'readiness contract mismatch',
    );
    steps.push({ name: currentStep, status: 'passed', trace_id });

    currentStep = 'live.version';
    const version = await request(fetch_impl, base_url, '/version');
    requireOk(
      typeof version.version === 'string' && version.version.length > 0,
      'version contract mismatch',
    );
    steps.push({ name: currentStep, status: 'passed', trace_id });

    const headers = {
      'content-type': 'application/json',
      'x-tenant-id': scope.tenant_id,
      'x-workspace-id': scope.workspace_id,
      'x-project-id': scope.project_id,
      'x-actor-id': 'live-probe-actor',
      'x-client-id': 'live-probe-client',
      traceparent: trace_id,
    };
    const indexBody = {
      id: 'live-platform-probe-context',
      title: 'Live platform probe',
      snippet: 'Runtime HTTP boundary probe',
      revision: 1,
      score: 1,
      source_refs: [{ type: 'probe', id: 'live-platform-probe' }],
    };

    currentStep = 'live.context.index';
    const firstIndex = await request(fetch_impl, base_url, '/v1/context/index', {
      method: 'POST',
      headers: {
        ...headers,
        'x-capability': 'context.write',
        'idempotency-key': 'live-platform-probe-index',
      },
      body: JSON.stringify(indexBody),
    });
    requireOk(firstIndex.data?.id === indexBody.id, 'context index response mismatch');
    steps.push({ name: currentStep, status: 'passed', trace_id });

    currentStep = 'live.context.index.retry';
    const retryIndex = await request(fetch_impl, base_url, '/v1/context/index', {
      method: 'POST',
      headers: {
        ...headers,
        'x-capability': 'context.write',
        'idempotency-key': 'live-platform-probe-index',
      },
      body: JSON.stringify(indexBody),
    });
    const same_response = JSON.stringify(firstIndex) === JSON.stringify(retryIndex);
    requireOk(same_response, 'idempotent retry response differs');
    steps.push({ name: currentStep, status: 'passed', trace_id });

    currentStep = 'live.context.search';
    const search = await request(fetch_impl, base_url, '/v1/context/search', {
      method: 'POST',
      headers: { ...headers, 'x-capability': 'context.read' },
      body: JSON.stringify({ query: indexBody.snippet }),
    });
    const hits = search.data?.hits;
    requireOk(
      Array.isArray(hits) && hits.some((hit) => hit.id === indexBody.id),
      'context search did not return indexed item',
    );
    steps.push({ name: currentStep, status: 'passed', trace_id });

    const webhookEvent = {
      event_id: '01HF7YAT00000000000000000A',
      event_type: 'ProjectCreated',
      schema_version: 1,
      ...scope,
      aggregate_type: 'project',
      aggregate_id: scope.project_id,
      aggregate_version: 1,
      occurred_at: new Date().toISOString(),
      trace_id: `${trace_id}-webhook`,
      source_refs: [{ type: 'plane', id: 'live-plane-project' }],
      sensitivity: 'internal',
      payload: {
        external_id: 'live-plane-project',
        title: 'Live Plane Webhook Probe',
        status: 'active',
      },
    };
    const webhookRaw = JSON.stringify(webhookEvent);
    const webhookTimestamp = Math.floor(Date.now() / 1000).toString();
    const webhookSignature = `v1=${createHmac('sha256', webhook_secret)
      .update(`${webhookTimestamp}.${webhookRaw}`)
      .digest('hex')}`;
    const webhookHeaders = {
      'content-type': 'application/json',
      'x-plane-delivery-id': 'live-plane-delivery',
      'x-plane-event-id': webhookEvent.event_id,
      'x-plane-timestamp': webhookTimestamp,
      'x-plane-signature': webhookSignature,
      'x-trace-id': webhookEvent.trace_id,
    };

    currentStep = 'live.plane.webhook';
    const webhook = await request(fetch_impl, base_url, '/v1/plane/webhook', {
      method: 'POST',
      headers: webhookHeaders,
      body: webhookRaw,
    });
    requireOk(
      (webhook.status === 'accepted' || webhook.status === 'duplicate') &&
        typeof webhook.effect_applied === 'boolean',
      'Plane webhook transport mismatch',
    );
    steps.push({ name: currentStep, status: 'passed', trace_id });

    currentStep = 'live.plane.webhook.duplicate';
    const duplicateWebhook = await request(fetch_impl, base_url, '/v1/plane/webhook', {
      method: 'POST',
      headers: webhookHeaders,
      body: webhookRaw,
    });
    requireOk(
      duplicateWebhook.status === 'duplicate' && duplicateWebhook.effect_applied === false,
      'Plane webhook duplicate was not idempotent',
    );
    steps.push({ name: currentStep, status: 'passed', trace_id });

    currentStep = 'live.mcp.initialize';
    const mcpHeaders = { ...headers, 'x-capability': 'context.read' };
    const initialize = await request(fetch_impl, base_url, '/mcp', {
      method: 'POST',
      headers: mcpHeaders,
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }),
    });
    requireOk(initialize.result?.serverInfo?.name === 'planemem-mcp', 'MCP initialize mismatch');
    steps.push({ name: currentStep, status: 'passed', trace_id });

    currentStep = 'live.mcp.tools.list';
    const toolList = await request(fetch_impl, base_url, '/mcp', {
      method: 'POST',
      headers: mcpHeaders,
      body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' }),
    });
    requireOk(
      Array.isArray(toolList.result?.tools) &&
        toolList.result.tools.some((tool) => tool.name === 'context_search'),
      'MCP tool list mismatch',
    );
    steps.push({ name: currentStep, status: 'passed', trace_id });

    currentStep = 'live.mcp.tools.call';
    const toolCall = await request(fetch_impl, base_url, '/mcp', {
      method: 'POST',
      headers: mcpHeaders,
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: { name: 'context_search', arguments: { query: 'Live Plane Webhook Probe' } },
      }),
    });
    const mcpPayload = JSON.parse(toolCall.result?.content?.[0]?.text ?? '{}');
    requireOk(
      mcpPayload.data?.hits?.some((hit) => hit.id === 'plane:Project:live-plane-project'),
      'MCP tool call did not return webhook projection',
    );
    steps.push({ name: currentStep, status: 'passed', trace_id });

    currentStep = 'live.mcp.resources.read';
    const resource = await request(fetch_impl, base_url, '/mcp', {
      method: 'POST',
      headers: mcpHeaders,
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 4,
        method: 'resources/read',
        params: { uri: 'wcp://context/plane:Project:live-plane-project' },
      }),
    });
    requireOk(
      resource.result?.contents?.[0]?.uri === 'wcp://context/plane:Project:live-plane-project',
      'MCP resource read mismatch',
    );
    steps.push({ name: currentStep, status: 'passed', trace_id });

    return {
      status: 'passed',
      base_url,
      version: version.version,
      scope,
      steps,
      idempotency: { same_response },
      transports: { plane_webhook: 'passed', mcp_http_jsonrpc: 'passed' },
      source_refs,
    };
  } catch (error) {
    steps.push({
      name: currentStep,
      status: 'failed',
      trace_id,
      error: error instanceof Error ? error.message : String(error),
    });
    return {
      status: 'failed',
      base_url,
      scope,
      steps,
      source_refs,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
