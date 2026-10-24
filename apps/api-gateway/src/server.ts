import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { fileURLToPath } from 'node:url';
import { AuditService, type AuditRecord } from '@planemem/audit-service';
import type { PolicyDecision } from '@planemem/auth';
import { ContractError, serializeError } from '@planemem/contracts';
import { validateEvent, type CanonicalEvent } from '@planemem/events';
import { PolicyService } from '@planemem/policy-service';
import { PlaneProjection, verifyWebhook, type WebhookHeaders } from '@planemem/plane-connector';
import { SearchService, type SearchHit } from '@planemem/search-service';
import postgres from 'postgres';
import { ApiGateway, type HttpRequest } from './http.js';
import { OidcTokenError, OidcTokenVerifier, type OidcClaims } from './oidc.js';
import { CommandRouter, type RequestContext } from './router.js';
import { WorkbenchRepository, type WorkbenchDatabase } from './workbench/repository.js';

export interface PlatformServerOptions {
  host?: string;
  port?: number;
  version?: string;
  vector_enabled?: boolean;
  rate_limit?: number;
  plane_webhook_secret?: string;
  opa_url?: string;
  policy_fetch?: typeof fetch;
  on_audit?: (record: AuditRecord) => void;
  audit_persist?: (record: AuditRecord) => Promise<void>;
  workbench_db?: WorkbenchDatabase;
  oidc_issuer?: string;
  oidc_audience?: string;
  oidc_fetch?: typeof fetch;
  oidc_verify?: ((authorization: string | undefined) => Promise<OidcClaims>) | undefined;
}

export interface PlatformServer {
  start(): Promise<string>;
  stop(): Promise<void>;
  auditRecords(): AuditRecord[];
}

interface RuntimeBody {
  [key: string]: unknown;
}

interface RuntimeResource {
  uri: string;
  mimeType: string;
  text: string;
  tenant_id: string;
  workspace_id: string;
  project_id: string;
}

interface RuntimeState {
  host: string;
  port: number;
  version: string;
  search: SearchService;
  resources: Map<string, RuntimeResource>;
  projection: PlaneProjection;
  plane_webhook_secret: string | undefined;
  audit: AuditService;
  audit_db?: ReturnType<typeof postgres> | undefined;
  workbench: WorkbenchRepository;
  oidc_verify?: ((authorization: string | undefined) => Promise<OidcClaims>) | undefined;
}

const DEFAULT_VERSION = '0.1.0';
const MAX_BODY_BYTES = 1024 * 1024;

export function createPlatformServer(options: PlatformServerOptions = {}): PlatformServer {
  const host = options.host ?? '127.0.0.1';
  const port = options.port ?? Number(process.env.PORT ?? 3000);
  const version = options.version ?? process.env.APP_VERSION ?? DEFAULT_VERSION;
  const search = new SearchService({
    vector_enabled: options.vector_enabled ?? process.env.VECTOR_ENABLED === 'true',
  });
  const resources = new Map<string, RuntimeResource>();
  const projection = new PlaneProjection();
  const policy = new PolicyService({
    opa_url: options.opa_url ?? process.env.OPA_URL,
    fetch_impl: options.policy_fetch ?? fetch,
  });
  const audit = new AuditService();
  const auditDb = process.env.DATABASE_URL
    ? postgres(process.env.DATABASE_URL, { max: 1, connect_timeout: 5 })
    : undefined;
  const workbenchDb: WorkbenchDatabase | undefined =
    options.workbench_db ??
    (auditDb
      ? {
          query: <T>(text: string, params: unknown[] = []) =>
            auditDb.unsafe<T[]>(text, params as (string | number | boolean | null | Date)[]),
        }
      : undefined);
  const workbench = new WorkbenchRepository(workbenchDb);
  const oidcVerifier =
    options.oidc_verify === undefined &&
    (options.oidc_issuer ?? process.env.AUTH_SERVER_ISSUER) !== undefined
      ? new OidcTokenVerifier({
          issuer: options.oidc_issuer ?? process.env.AUTH_SERVER_ISSUER ?? '',
          ...((options.oidc_audience ?? process.env.AUTH_SERVER_AUDIENCE)
            ? { audience: options.oidc_audience ?? process.env.AUTH_SERVER_AUDIENCE }
            : {}),
          fetch_impl: options.oidc_fetch ?? fetch,
        })
      : undefined;
  const persistAudit =
    options.audit_persist ??
    (auditDb
      ? async (record: AuditRecord) => {
          await auditDb`
            INSERT INTO wcp_audit_records
              (audit_id, tenant_id, workspace_id, project_id, actor_id, client_id, action, resource,
               result, classification, details, trace_id, source_refs, occurred_at)
            VALUES
              (${record.audit_id}, ${record.tenant_id}, ${record.workspace_id}, ${record.project_id},
               ${record.actor_id}, ${record.client_id}, ${record.action}, ${record.resource},
               ${record.result}, ${record.classification}, ${JSON.stringify(record.details)}::jsonb,
               ${record.trace_id}, ${JSON.stringify(record.source_refs)}::jsonb, ${record.occurred_at})
            ON CONFLICT (audit_id) DO UPDATE SET
              details = EXCLUDED.details,
              trace_id = EXCLUDED.trace_id
          `;
        }
      : undefined);
  let auditSequence = 0;
  const router = new CommandRouter(
    async (request) => {
      const authContext = {
        tenant_id: request.context.tenant_id,
        workspace_id: request.context.workspace_id,
        project_id: request.context.project_id,
        actor_id: request.context.actor_id,
        client_id: request.context.client_id,
        roles: request.context.roles ?? [],
        capabilities: request.context.capability,
        token_expires_at:
          request.context.token_expires_at ?? new Date(Date.now() + 5 * 60_000).toISOString(),
        trace_id: request.context.trace_id,
      };
      const action = request.operation === 'context.index' ? 'context.write' : 'context.read';
      const decision = await policy.authorizeWithOpa({
        action,
        resource: {
          tenant_id: request.context.tenant_id,
          workspace_id: request.context.workspace_id,
          project_id: request.context.project_id,
        },
        context: authContext,
      });
      return toRouterDecision(decision);
    },
    async (request, decision) => {
      const record = audit.recordAudit({
        tenant_id: request.context.tenant_id as never,
        workspace_id: request.context.workspace_id as never,
        project_id: request.context.project_id as never,
        actor_id: request.context.actor_id,
        client_id: request.context.client_id,
        action: request.operation,
        resource: `runtime:${request.operation}`,
        result: decision.allowed ? 'allowed' : 'denied',
        classification: 'internal',
        details: decision.allowed ? {} : { reason: decision.reason },
        trace_id: request.context.trace_id,
        source_refs: [],
        idempotency_key: `runtime-audit-${request.context.trace_id}-${auditSequence++}`,
      });
      options.on_audit?.(record);
      if (persistAudit) {
        try {
          await persistAudit(record);
        } catch {
          throw new ContractError(
            'AUDIT_PERSISTENCE_UNAVAILABLE',
            'Audit persistence is unavailable',
            {
              trace_id: record.trace_id,
              retryable: true,
              source: 'audit-sink',
            },
          );
        }
      }
    },
  );
  router.register('context.index', (request) => {
    const input = request.input;
    const hit = search.index({
      tenant_id: request.context.tenant_id,
      workspace_id: request.context.workspace_id,
      project_id: request.context.project_id,
      id: requireString(input.id, 'id'),
      title: requireString(input.title, 'title'),
      snippet: requireString(input.snippet, 'snippet'),
      revision: requireInteger(input.revision, 'revision'),
      score: requireNumber(input.score, 'score'),
      source_refs: requireSourceRefs(input.source_refs),
      ...(input.rank_source === undefined
        ? {}
        : { rank_source: requireRankSource(input.rank_source) }),
    });
    registerResource(resources, hit);
    return {
      schema_version: 1,
      trace_id: request.context.trace_id,
      source_refs: hit.source_refs,
      data: hit,
    };
  });
  router.register('context.search', (request) => {
    const result = search.search({
      tenant_id: request.context.tenant_id,
      workspace_id: request.context.workspace_id,
      project_id: request.context.project_id,
      query: requireString(request.input.query, 'query'),
      trace_id: request.context.trace_id,
      ...(request.input.budget === undefined
        ? {}
        : { budget: requireInteger(request.input.budget, 'budget') }),
      ...(request.input.use_vector === undefined
        ? {}
        : { use_vector: requireBoolean(request.input.use_vector, 'use_vector') }),
    });
    return {
      schema_version: 1,
      trace_id: request.context.trace_id,
      source_refs: result.source_refs,
      data: result,
    };
  });
  router.register('workbench.query', async (request) => {
    const operation = requireString(request.input.operation, 'operation');
    const scope = {
      tenant_id: request.context.tenant_id,
      workspace_id: request.context.workspace_id,
      project_id: request.context.project_id,
    };
    const trace_id = request.context.trace_id;
    switch (operation) {
      case 'overview':
        return workbench.listOverview(scope, trace_id);
      case 'work_items':
        return workbench.listWorkItems(
          scope,
          trace_id,
          request.input.status === undefined
            ? undefined
            : requireString(request.input.status, 'status'),
        );
      case 'context':
        return workbench.listContext(scope, trace_id);
      case 'sessions':
        return workbench.listSessions(scope, trace_id);
      case 'handoffs':
        return workbench.listHandoffs(scope, trace_id);
      case 'conflicts':
        return workbench.listConflicts(scope, trace_id);
      case 'audit':
        return workbench.listAudit(scope, trace_id);
      case 'admin':
        return workbench.adminHealth(
          scope,
          trace_id,
          request.input.release === undefined
            ? version
            : requireString(request.input.release, 'release'),
        );
      default:
        throw new ContractError(
          'WORKBENCH_OPERATION_UNSUPPORTED',
          'Workbench operation is unsupported',
          {
            operation,
            trace_id,
            retryable: false,
          },
        );
    }
  });

  const api = new ApiGateway(router, options.rate_limit ?? 100);
  api.route('POST', '/v1/context/index', 'context.index');
  api.route('POST', '/v1/context/search', 'context.search');
  api.route('POST', '/v1/workbench/query', 'workbench.query');

  let server: Server | undefined;

  const requestHandler = (request: IncomingMessage, response: ServerResponse): void => {
    void handleRequest(request, response, api, {
      host,
      port,
      version,
      search,
      resources,
      projection,
      plane_webhook_secret: options.plane_webhook_secret ?? process.env.PLANE_WEBHOOK_SECRET,
      audit,
      audit_db: auditDb,
      workbench,
      oidc_verify: options.oidc_verify ?? oidcVerifier?.verifyAuthorization.bind(oidcVerifier),
    });
  };

  return {
    start: () =>
      new Promise<string>((resolve, reject) => {
        if (server?.listening) {
          const address = server.address();
          if (address && typeof address !== 'string') resolve(`http://${host}:${address.port}`);
          else reject(new Error('Platform server has an invalid listening address'));
          return;
        }
        server = createServer(requestHandler);
        const onError = (error: Error) => reject(error);
        server.once('error', onError);
        server.listen(port, host, () => {
          server?.off('error', onError);
          const address = server?.address();
          if (!address || typeof address === 'string') {
            reject(new Error('Platform server has an invalid listening address'));
            return;
          }
          resolve(`http://${host}:${address.port}`);
        });
      }),
    stop: () =>
      new Promise<void>((resolve, reject) => {
        if (!server?.listening) {
          void (auditDb ? auditDb.end({ timeout: 5 }) : Promise.resolve()).then(resolve, reject);
          return;
        }
        server.close((error) => {
          server = undefined;
          if (error) {
            reject(error);
            return;
          }
          void (auditDb ? auditDb.end({ timeout: 5 }) : Promise.resolve()).then(resolve, reject);
        });
      }),
    auditRecords: () => runtimeAuditSnapshot(audit),
  };
}

function toRouterDecision(
  decision: PolicyDecision,
): { allowed: true } | { allowed: false; reason: string } {
  return decision.allowed ? { allowed: true } : { allowed: false, reason: decision.reason };
}

function runtimeAuditSnapshot(audit: AuditService): AuditRecord[] {
  return audit.snapshot();
}

async function handleRequest(
  request: IncomingMessage,
  response: ServerResponse,
  api: ApiGateway,
  runtime: RuntimeState,
): Promise<void> {
  const url = new URL(request.url ?? '/', `http://${runtime.host}:${runtime.port}`);
  const traceId =
    header(request, 'traceparent') ?? header(request, 'x-trace-id') ?? 'trace_http_unknown';
  if (request.method === 'GET' && url.pathname === '/health') {
    writeJson(response, 200, {
      service: 'planemem-platform',
      version: runtime.version,
      status: 'ok',
    });
    return;
  }
  if (request.method === 'GET' && url.pathname === '/health/ready') {
    writeJson(response, 200, {
      service: 'planemem-platform',
      version: runtime.version,
      status: 'ready',
      ready: true,
    });
    return;
  }
  if (request.method === 'GET' && url.pathname === '/version') {
    writeJson(response, 200, { version: runtime.version });
    return;
  }
  if (request.method === 'GET' && url.pathname === '/metrics') {
    response.writeHead(200, { 'content-type': 'text/plain; version=0.0.4' });
    response.end(
      `# planemem runtime\nplanemem_search_vector_enabled ${runtime.search.health().vector_enabled ? 1 : 0}\nplanemem_audit_records_total ${runtime.audit.health().metrics.records}\n`,
    );
    return;
  }

  if (request.method === 'POST' && url.pathname === '/v1/plane/webhook') {
    await handlePlaneWebhook(request, response, runtime);
    return;
  }

  if (request.method === 'POST' && url.pathname === '/mcp') {
    await handleMcpRequest(request, response, api, runtime);
    return;
  }

  if (request.method === 'POST' && url.pathname === '/v1/workbench/query') {
    const authorization = header(request, 'authorization');
    if (!authorization?.startsWith('Bearer ') || authorization.slice(7).trim().length === 0) {
      writeJson(
        response,
        401,
        errorEnvelope('UNAUTHENTICATED', 'Bearer token is required', request, traceId),
      );
      return;
    }
    if (runtime.oidc_verify !== undefined) {
      try {
        await runtime.oidc_verify(authorization);
      } catch (error) {
        writeJson(
          response,
          401,
          errorEnvelope(
            'UNAUTHENTICATED',
            error instanceof OidcTokenError ? error.message : 'Bearer token is invalid',
            request,
            traceId,
          ),
        );
        return;
      }
    }
  }

  if (request.method !== 'POST' || !url.pathname.startsWith('/v1/')) {
    writeJson(response, 404, errorEnvelope('NOT_FOUND', 'Route does not exist', request));
    return;
  }

  let body: RuntimeBody;
  try {
    body = await readJson(request);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Request body must be valid JSON';
    writeJson(response, 400, errorEnvelope('INVALID_JSON', message, request, traceId));
    return;
  }

  let context: RequestContext;
  try {
    context = requestContext(request, traceId);
  } catch (error) {
    writeJson(response, 400, serializeEnvelope(error, traceId));
    return;
  }

  const method = request.method as HttpRequest['method'];
  const result = await api.handle({
    method,
    path: url.pathname,
    body,
    headers: {
      'content-type': header(request, 'content-type'),
      'idempotency-key': header(request, 'idempotency-key'),
    },
    context,
  });
  writeJson(response, result.status, result.body, result.headers);
}

async function handlePlaneWebhook(
  request: IncomingMessage,
  response: ServerResponse,
  runtime: RuntimeState,
): Promise<void> {
  const traceId =
    header(request, 'x-trace-id') ?? header(request, 'traceparent') ?? 'trace_webhook_unknown';
  if (!runtime.plane_webhook_secret) {
    writeJson(
      response,
      503,
      errorEnvelope(
        'WEBHOOK_SECRET_NOT_CONFIGURED',
        'Plane webhook secret is not configured',
        request,
        traceId,
      ),
    );
    return;
  }
  let rawBody: string;
  try {
    rawBody = await readRaw(request);
  } catch (error) {
    writeJson(
      response,
      400,
      errorEnvelope(
        'WEBHOOK_BODY_INVALID',
        error instanceof Error ? error.message : 'Webhook body is invalid',
        request,
        traceId,
      ),
    );
    return;
  }
  const headers: WebhookHeaders = { 'x-trace-id': traceId };
  const deliveryId = header(request, 'x-plane-delivery-id');
  const eventId = header(request, 'x-plane-event-id');
  const timestamp = header(request, 'x-plane-timestamp');
  const signature = header(request, 'x-plane-signature');
  if (deliveryId !== undefined) headers['x-plane-delivery-id'] = deliveryId;
  if (eventId !== undefined) headers['x-plane-event-id'] = eventId;
  if (timestamp !== undefined) headers['x-plane-timestamp'] = timestamp;
  if (signature !== undefined) headers['x-plane-signature'] = signature;
  const verification = await verifyWebhook(rawBody, headers, runtime.plane_webhook_secret);
  if (!verification.valid) {
    writeJson(response, 401, verification.error);
    return;
  }
  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch (error) {
    writeJson(
      response,
      400,
      errorEnvelope(
        'WEBHOOK_BODY_INVALID',
        error instanceof Error ? error.message : 'Webhook body must be valid JSON',
        request,
        verification.trace_id,
      ),
    );
    return;
  }
  const validated = validateEvent(body);
  if (!validated.valid) {
    writeJson(response, 400, validated.error);
    return;
  }
  const event = validated.event;
  if (event.event_id !== verification.event_id) {
    writeJson(
      response,
      400,
      errorEnvelope(
        'WEBHOOK_EVENT_ID_MISMATCH',
        'Webhook header event id does not match the canonical event',
        request,
        event.trace_id,
      ),
    );
    return;
  }
  const consumed = runtime.projection.applyPlaneEvent(event);
  if (consumed.status === 'accepted') {
    const state = runtime.projection.getObservedState(
      event.aggregate_type === 'project' ? 'Project' : 'WorkItem',
      String((event.payload as Record<string, unknown>).external_id ?? event.aggregate_id),
    );
    if (state !== undefined) {
      const payload = event.payload as Record<string, unknown>;
      const title = String(payload.title ?? payload.name ?? state.external_id);
      const snippet = `${title} (${state.authority})`;
      const hit = runtime.search.index({
        tenant_id: event.tenant_id,
        workspace_id: event.workspace_id,
        project_id: event.project_id ?? event.aggregate_id,
        id: `plane:${state.entity_kind}:${state.external_id}`,
        title,
        snippet,
        revision: event.aggregate_version,
        score: 1,
        source_refs: event.source_refs,
      });
      registerResource(runtime.resources, hit);
    }
  }
  writeJson(response, 200, {
    schema_version: 1,
    status: consumed.status,
    event_id: event.event_id,
    delivery_id: verification.delivery_id,
    effect_applied: consumed.effect_applied,
    trace_id: event.trace_id,
    source_refs: event.source_refs,
    ...(consumed.error === undefined ? {} : { error: consumed.error }),
  });
}

async function handleMcpRequest(
  request: IncomingMessage,
  response: ServerResponse,
  api: ApiGateway,
  runtime: RuntimeState,
): Promise<void> {
  const traceId =
    header(request, 'traceparent') ?? header(request, 'x-trace-id') ?? 'trace_mcp_unknown';
  let body: RuntimeBody;
  try {
    body = await readJson(request);
  } catch (error) {
    writeJson(response, 400, errorEnvelope('INVALID_JSON', String(error), request, traceId));
    return;
  }
  let context: RequestContext;
  try {
    context = requestContext(request, traceId);
  } catch (error) {
    writeJson(response, 400, serializeEnvelope(error, traceId));
    return;
  }
  const id = body.id ?? null;
  const method = typeof body.method === 'string' ? body.method : undefined;
  const params = isRecord(body.params) ? body.params : {};
  if (method === undefined) {
    writeJson(response, 200, mcpError(id, -32600, 'JSON-RPC method is required', traceId));
    return;
  }
  try {
    let result: Record<string, unknown>;
    switch (method) {
      case 'server/discover':
        result = {
          schema_version: 1,
          supportedVersions: ['2025-11-25', '2024-11-11'],
          capabilities: { tools: {}, resources: {}, prompts: {} },
          instructions: 'PlaneMem authorized context tools and resources.',
          trace_id: context.trace_id,
        };
        break;
      case 'initialize':
        result = {
          schema_version: 1,
          protocolVersion:
            typeof params.protocolVersion === 'string' ? params.protocolVersion : '2024-11-05',
          serverInfo: { name: 'planemem-mcp', version: runtime.version },
          capabilities: { tools: {}, resources: {}, prompts: {} },
          trace_id: context.trace_id,
        };
        break;
      case 'notifications/initialized':
        writeJson(response, 200, { jsonrpc: '2.0', id, result: {}, trace_id: context.trace_id });
        return;
      case 'tools/list':
        result = {
          schema_version: 1,
          tools: [
            {
              name: 'context_search',
              description: 'Search authorized project context',
              inputSchema: {
                type: 'object',
                required: ['query'],
                properties: { query: { type: 'string' } },
              },
            },
            {
              name: 'context_index',
              description: 'Index an authorized context hit',
              inputSchema: {
                type: 'object',
                required: ['id', 'title', 'snippet', 'revision', 'score', 'source_refs'],
              },
            },
          ],
          trace_id: context.trace_id,
        };
        break;
      case 'tools/call': {
        const name = requireString(params.name, 'name');
        const input = isRecord(params.arguments) ? params.arguments : {};
        const operation =
          name === 'context_search'
            ? 'context.search'
            : name === 'context_index'
              ? 'context.index'
              : undefined;
        if (!operation) {
          writeJson(response, 200, mcpError(id, -32601, 'MCP tool not found', context.trace_id));
          return;
        }
        const httpResult = await api.handle({
          method: 'POST',
          path: operation === 'context.search' ? '/v1/context/search' : '/v1/context/index',
          body: input,
          headers: { 'content-type': 'application/json' },
          context,
        });
        const text = JSON.stringify(httpResult.body);
        result = {
          schema_version: 1,
          content: [{ type: 'text', text }],
          trace_id: context.trace_id,
          ...(httpResult.status >= 400 ? { isError: true } : {}),
        };
        break;
      }
      case 'resources/list':
        result = {
          schema_version: 1,
          resources: [...runtime.resources.values()]
            .filter((resource) => sameScope(resource, context))
            .map(({ uri, mimeType }) => ({ uri, mimeType, name: uri })),
          trace_id: context.trace_id,
        };
        break;
      case 'resources/read': {
        const uri = requireString(params.uri, 'uri');
        const resource = runtime.resources.get(uri);
        if (!resource || !sameScope(resource, context)) {
          writeJson(
            response,
            200,
            mcpError(id, -32004, 'MCP resource not found', context.trace_id),
          );
          return;
        }
        result = {
          schema_version: 1,
          contents: [{ uri: resource.uri, mimeType: resource.mimeType, text: resource.text }],
          trace_id: context.trace_id,
        };
        break;
      }
      case 'prompts/list':
        result = {
          schema_version: 1,
          prompts: [{ name: 'resume', description: 'Resume context' }],
          trace_id: context.trace_id,
        };
        break;
      case 'prompts/get':
        result = {
          schema_version: 1,
          description: 'Resume context using untrusted historical material',
          messages: [
            {
              role: 'user',
              content: { type: 'text', text: 'Untrusted historical context follows.' },
            },
          ],
          trace_id: context.trace_id,
        };
        break;
      default:
        writeJson(response, 200, mcpError(id, -32601, 'MCP method not found', context.trace_id));
        return;
    }
    writeJson(response, 200, { jsonrpc: '2.0', id, result });
  } catch (error) {
    writeJson(
      response,
      200,
      mcpError(
        id,
        -32602,
        error instanceof Error ? error.message : 'MCP request failed',
        context.trace_id,
      ),
    );
  }
}

function mcpError(
  id: unknown,
  code: number,
  message: string,
  trace_id: string,
): Record<string, unknown> {
  return { jsonrpc: '2.0', id, error: { code, message, data: { trace_id } } };
}

function registerResource(resources: Map<string, RuntimeResource>, hit: SearchHit): void {
  resources.set(`wcp://context/${hit.id}`, {
    uri: `wcp://context/${hit.id}`,
    mimeType: 'text/markdown',
    text: `# ${hit.title}\n\n${hit.snippet}\n`,
    tenant_id: hit.tenant_id,
    workspace_id: hit.workspace_id,
    project_id: hit.project_id,
  });
}

function sameScope(resource: RuntimeResource, context: RequestContext): boolean {
  return (
    resource.tenant_id === context.tenant_id &&
    resource.workspace_id === context.workspace_id &&
    resource.project_id === context.project_id
  );
}

function requestContext(request: IncomingMessage, trace_id: string): RequestContext {
  const context: RequestContext = {
    tenant_id: requiredHeader(request, 'x-tenant-id'),
    workspace_id: requiredHeader(request, 'x-workspace-id'),
    project_id: requiredHeader(request, 'x-project-id'),
    actor_id: requiredHeader(request, 'x-actor-id'),
    client_id: requiredHeader(request, 'x-client-id'),
    trace_id,
    capability: (header(request, 'x-capability') ?? '')
      .split(/[\s,]+/)
      .map((value) => value.trim())
      .filter(Boolean),
    schema_version: 1,
  };
  const roles = header(request, 'x-role');
  if (roles !== undefined) context.roles = roles.split(/[\s,]+/).filter(Boolean);
  const tokenExpiresAt = header(request, 'x-token-expires-at');
  if (tokenExpiresAt !== undefined) context.token_expires_at = tokenExpiresAt;
  const idempotencyKey = header(request, 'idempotency-key');
  const expectedVersion = header(request, 'if-match-version');
  if (idempotencyKey !== undefined) context.idempotency_key = idempotencyKey;
  if (expectedVersion !== undefined) {
    const parsed = Number(expectedVersion);
    if (!Number.isSafeInteger(parsed) || parsed < 0)
      throw new ContractError(
        'INVALID_REQUEST_CONTEXT',
        'if-match-version must be a non-negative integer',
        {
          trace_id,
          retryable: false,
        },
      );
    context.expected_version = parsed;
  }
  return context;
}

function requiredHeader(request: IncomingMessage, name: string): string {
  const value = header(request, name);
  if (!value)
    throw new ContractError('INVALID_REQUEST_CONTEXT', `Missing required header: ${name}`, {
      field: name,
      trace_id: header(request, 'traceparent') ?? 'trace_http_unknown',
      retryable: false,
    });
  return value;
}

function header(request: IncomingMessage, name: string): string | undefined {
  const value = request.headers[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : value;
}

async function readJson(request: IncomingMessage): Promise<RuntimeBody> {
  const raw = await readRaw(request);
  const parsed: unknown = JSON.parse(raw);
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed))
    throw new Error('Request body must be a JSON object');
  return parsed as RuntimeBody;
}

async function readRaw(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.byteLength;
    if (size > MAX_BODY_BYTES) throw new Error('Request body exceeds 1 MiB');
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}

function writeJson(
  response: ServerResponse,
  status: number,
  body: unknown,
  extraHeaders: Record<string, string> = {},
): void {
  response.writeHead(status, { 'content-type': 'application/json', ...extraHeaders });
  response.end(JSON.stringify(body));
}

function errorEnvelope(
  code: string,
  message: string,
  request: IncomingMessage,
  trace_id = header(request, 'traceparent') ?? 'trace_http_unknown',
): Record<string, unknown> {
  return { code, message, details: {}, trace_id, retryable: false };
}

function serializeEnvelope(error: unknown, trace_id: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(serializeError(error)) as Record<string, unknown>;
    if (parsed.trace_id === 'trace_unknown') parsed.trace_id = trace_id;
    return parsed;
  } catch {
    return errorEnvelope(
      'INTERNAL_ERROR',
      'Unknown error',
      { headers: {} } as IncomingMessage,
      trace_id,
    );
  }
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0)
    throw new ContractError('INVALID_INPUT', `${field} must be a non-empty string`, {
      field,
      trace_id: 'trace_runtime_input',
      retryable: false,
    });
  return value;
}

function requireInteger(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0)
    throw new ContractError('INVALID_INPUT', `${field} must be a non-negative integer`, {
      field,
      trace_id: 'trace_runtime_input',
      retryable: false,
    });
  return value as number;
}

function requireNumber(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value))
    throw new ContractError('INVALID_INPUT', `${field} must be a finite number`, {
      field,
      trace_id: 'trace_runtime_input',
      retryable: false,
    });
  return value;
}

function requireBoolean(value: unknown, field: string): boolean {
  if (typeof value !== 'boolean')
    throw new ContractError('INVALID_INPUT', `${field} must be a boolean`, {
      field,
      trace_id: 'trace_runtime_input',
      retryable: false,
    });
  return value;
}

function requireSourceRefs(value: unknown): Array<{ type: string; id: string }> {
  if (!Array.isArray(value))
    throw new ContractError('INVALID_INPUT', 'source_refs must be an array', {
      trace_id: 'trace_runtime_input',
      retryable: false,
    });
  return value.map((item) => {
    if (typeof item !== 'object' || item === null || Array.isArray(item))
      throw new ContractError('INVALID_INPUT', 'source_refs entries must be objects', {
        trace_id: 'trace_runtime_input',
        retryable: false,
      });
    const entry = item as Record<string, unknown>;
    return {
      type: requireString(entry.type, 'source_refs.type'),
      id: requireString(entry.id, 'source_refs.id'),
    };
  });
}

function requireRankSource(value: unknown): SearchHit['rank_source'] {
  if (value !== 'fts' && value !== 'vector' && value !== 'rrf')
    throw new ContractError('INVALID_INPUT', 'rank_source must be fts, vector or rrf', {
      trace_id: 'trace_runtime_input',
      retryable: false,
    });
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const application = createPlatformServer({
    host: process.env.HOST ?? '0.0.0.0',
  });

  const shutdown = async (): Promise<void> => {
    await application.stop();
    process.exit(0);
  };
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
  void application.start().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
