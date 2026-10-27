import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { fileURLToPath } from 'node:url';
import { AuditService, type AuditRecord } from '@planemem/audit-service';
import type { PolicyDecision } from '@planemem/auth';
import { ContractError, serializeError } from '@planemem/contracts';
import { validateEvent, type CanonicalEvent } from '@planemem/events';
import { PolicyService } from '@planemem/policy-service';
import {
  createMemoryService,
  AiMemoryMcpProvider,
  type AiMemoryMcpProviderOptions,
  type MemoryProviderMode,
  type MemoryScope,
  type MemoryServiceConfiguration,
  type MemoryServiceAdapter,
} from '@planemem/context-service';
import {
  PlaneProjection,
  verifyWebhook,
  type ObservedState,
  type ProjectionScope,
  type WebhookHeaders,
} from '@planemem/plane-connector';
import { SearchService, type SearchHit } from '@planemem/search-service';
import { ContinuationService, SessionService } from '@planemem/session-service';
import postgres from 'postgres';
import { ApiGateway, type HttpRequest } from './http.js';
import { CommandRouter, type RequestContext } from './router.js';
import {
  eventExists,
  hydrateRuntimeState,
  persistContextHit,
  persistPlaneEvent,
} from './runtime-persistence.js';
import { PostgresSessionStore } from './session-persistence.js';
import { createSessionCommands, sessionOperations } from './session-commands.js';
import { PostgresOperationTransactions } from './continuity-persistence.js';
import { PostgresPreparedMemoryStore } from './memory-continuity-persistence.js';
import { MemoryContinuityOperations } from './memory-continuity.js';
import {
  ContinuityOperations,
  continuityCapabilityReport,
  memoryContinuityActions,
  type ContinuityRequest,
} from './continuity-operations.js';

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
  /** Optional long-term memory projection. Omit it to keep the offline context-only mode. */
  memory_service?: MemoryServiceAdapter;
  memory_provider_mode?: MemoryProviderMode;
  memory_enabled?: boolean;
  memory_required?: boolean;
  ai_memory_server_url?: string;
  ai_memory_token?: string;
  /** Proxy credential for the original-operation protocol's actor and client binding. */
  ai_memory_proxy_token?: string;
  memory_actor_id?: string;
  memory_client_id?: string;
  continuity_endpoint_ref?: string;
  continuity_configuration_digest?: string;
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
  persist_audit?: ((record: AuditRecord) => Promise<void>) | undefined;
  memory_service?: MemoryServiceAdapter;
  memory_required: boolean;
  sessions: SessionService;
  continuation: ContinuationService;
  pending_plane_persistence: Map<
    string,
    { event: CanonicalEvent<Record<string, unknown>>; state: ObservedState; hit: SearchHit }
  >;
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
  const memoryMode = resolveMemoryMode(
    options.memory_provider_mode ?? process.env.MEMORY_PROVIDER_MODE,
  );
  const memory =
    options.memory_service ??
    (memoryMode ? createConfiguredMemory(options, memoryMode) : undefined);
  const memoryRequired = options.memory_required ?? process.env.MEMORY_REQUIRED === 'true';
  const resources = new Map<string, RuntimeResource>();
  const projection = new PlaneProjection();
  const auditDb = process.env.DATABASE_URL
    ? postgres(process.env.DATABASE_URL, { max: 1, connect_timeout: 5 })
    : undefined;
  const sessionStore = auditDb ? new PostgresSessionStore(auditDb) : undefined;
  const sessions = new SessionService(sessionStore);
  const continuation = new ContinuationService(sessions, sessionStore);
  const policy = new PolicyService({
    opa_url: options.opa_url ?? process.env.OPA_URL,
    fetch_impl: options.policy_fetch ?? fetch,
  });
  const audit = new AuditService();
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
      const action = operationPolicyAction(request.operation, request.input);
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
  router.register('project.state', async (request) => {
    const projectId = requireString(request.input.project_id, 'project_id');
    const state = projection.getObservedState(
      'Project',
      projectId,
      projectionScope(request.context),
    );
    if (state === undefined)
      throw new ContractError('NOT_FOUND', 'Project state was not observed from Plane', {
        project_id: projectId,
        trace_id: request.context.trace_id,
        retryable: false,
      });
    return {
      schema_version: 1,
      trace_id: request.context.trace_id,
      source_refs: state.source_refs,
      data: state,
    };
  });
  router.register('workitem.context', async (request) => {
    const scope = projectionScope(request.context);
    const workItemId = requireString(request.input.work_item_id, 'work_item_id');
    const state = projection.getObservedState('WorkItem', workItemId, scope);
    if (state === undefined)
      throw new ContractError('NOT_FOUND', 'Work item state was not observed from Plane', {
        work_item_id: workItemId,
        trace_id: request.context.trace_id,
        retryable: false,
      });

    const title = String(state.fields.title ?? state.external_id);
    const indexed = search.findById({ ...scope, id: `plane:WorkItem:${state.external_id}` });
    const stateHit: SearchHit = indexed ?? {
      schema_version: 1,
      tenant_id: state.tenant_id,
      workspace_id: state.workspace_id,
      project_id: state.project_id,
      id: `plane:WorkItem:${state.external_id}`,
      title,
      snippet: `${title} (${state.status ?? 'observed'})`,
      revision: state.plane_version,
      score: 1,
      rank_source: 'fts',
      source_refs: state.source_refs,
    };
    let memoryHits: SearchHit[] = [];
    let degraded = memory === undefined;
    if (memory !== undefined) {
      try {
        const recalled = await memory.recall({
          ...toMemoryScope(request.context),
          query: title,
          trace_id: request.context.trace_id,
        });
        memoryHits = recalled.map((hit, index) => ({
          schema_version: 1,
          tenant_id: hit.tenant_id,
          workspace_id: hit.workspace_id,
          project_id: hit.project_id,
          id: hit.page_ref,
          title: 'ai-memory',
          snippet: hit.snippet,
          revision: hit.revision,
          score: 1 / (index + 1),
          rank_source: 'fts',
          source_refs: hit.source_refs,
        }));
      } catch (error) {
        if (memoryRequired) throw error;
        degraded = true;
      }
    }
    const hits = [stateHit, ...memoryHits].slice(0, 20);
    const sourceRefs = uniqueSourceRefs([
      ...state.source_refs,
      ...hits.flatMap((hit) => hit.source_refs),
    ]);
    return {
      schema_version: 1,
      trace_id: request.context.trace_id,
      source_refs: sourceRefs,
      data: {
        work_item: state,
        context_pack: {
          schema_version: 1,
          query: title,
          trace_id: request.context.trace_id,
          degraded,
          hits,
          source_refs: sourceRefs,
        },
      },
    };
  });
  router.register('context.index', async (request) => {
    const input = request.input;
    const sourceRefs = requireSourceRefs(input.source_refs);
    const memoryRefs: Array<{ type: string; id: string }> = [];
    if (memory) {
      try {
        const memoryRef = await memory.capture({
          ...toMemoryScope(request.context),
          content: `${requireString(input.title, 'title')}\n\n${requireString(input.snippet, 'snippet')}`,
          trace_id: request.context.trace_id,
        });
        memoryRefs.push({ type: 'ai-memory', id: memoryRef.page_ref });
      } catch (error) {
        if (memoryRequired) throw error;
      }
    }
    const hit = search.index({
      tenant_id: request.context.tenant_id,
      workspace_id: request.context.workspace_id,
      project_id: request.context.project_id,
      id: requireString(input.id, 'id'),
      title: requireString(input.title, 'title'),
      snippet: requireString(input.snippet, 'snippet'),
      revision: requireInteger(input.revision, 'revision'),
      score: requireNumber(input.score, 'score'),
      source_refs: [...sourceRefs, ...memoryRefs],
      ...(input.rank_source === undefined
        ? {}
        : { rank_source: requireRankSource(input.rank_source) }),
    });
    registerResource(resources, hit);
    if (auditDb) {
      try {
        await persistContextHit(auditDb, hit, request.context.trace_id);
      } catch (error) {
        throw new ContractError(
          'CONTEXT_PERSISTENCE_UNAVAILABLE',
          error instanceof Error ? error.message : 'Context persistence is unavailable',
          { trace_id: request.context.trace_id, retryable: true },
        );
      }
    }
    return {
      schema_version: 1,
      trace_id: request.context.trace_id,
      source_refs: hit.source_refs,
      data: hit,
    };
  });
  router.register('context.search', async (request) => {
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
    if (!memory)
      return {
        schema_version: 1,
        trace_id: request.context.trace_id,
        source_refs: result.source_refs,
        data: result,
      };

    try {
      const memoryHits = await memory.recall({
        ...toMemoryScope(request.context),
        query: requireString(request.input.query, 'query'),
        trace_id: request.context.trace_id,
      });
      const budget =
        request.input.budget === undefined ? 20 : requireInteger(request.input.budget, 'budget');
      const projectedMemoryHits = memoryHits.map((hit, index) => ({
        schema_version: 1 as const,
        tenant_id: hit.tenant_id,
        workspace_id: hit.workspace_id,
        project_id: hit.project_id,
        id: hit.page_ref,
        title: 'ai-memory',
        snippet: hit.snippet,
        revision: hit.revision,
        score: 1 / (index + 1),
        rank_source: 'fts' as const,
        source_refs: hit.source_refs,
      }));
      const hits = [...result.hits, ...projectedMemoryHits].slice(0, budget);
      return {
        schema_version: 1,
        trace_id: request.context.trace_id,
        source_refs: hits.flatMap((hit) => hit.source_refs),
        data: { ...result, hits, source_refs: hits.flatMap((hit) => hit.source_refs) },
      };
    } catch (error) {
      if (memoryRequired) throw error;
      return {
        schema_version: 1,
        trace_id: request.context.trace_id,
        source_refs: result.source_refs,
        data: { ...result, degraded: true },
      };
    }
  });
  router.register('context.handoff.create', async (request) => {
    if (!memory)
      throw new ContractError('MEMORY_PROVIDER_OFF', 'Memory provider is not configured', {
        trace_id: request.context.trace_id,
        retryable: true,
      });
    const handoff = await memory.create_handoff(
      requireString(request.input.page_ref, 'page_ref'),
      toMemoryScope(request.context),
      request.context.trace_id,
    );
    return {
      schema_version: 1,
      trace_id: request.context.trace_id,
      source_refs: [{ type: 'ai-memory', id: handoff.page_ref }],
      data: handoff,
    };
  });
  router.register('context.handoff.claim', async (request) => {
    if (!memory)
      throw new ContractError('MEMORY_PROVIDER_OFF', 'Memory provider is not configured', {
        trace_id: request.context.trace_id,
        retryable: true,
      });
    const result = await memory.claim_handoff(
      requireString(request.input.handoff_ref, 'handoff_ref'),
      request.input.claim_client_id === undefined
        ? request.input.client_id === undefined
          ? request.context.client_id
          : requireString(request.input.client_id, 'client_id')
        : requireString(request.input.claim_client_id, 'claim_client_id'),
    );
    return {
      schema_version: 1,
      trace_id: request.context.trace_id,
      source_refs: [{ type: 'ai-memory', id: result.page_ref }],
      data: result,
    };
  });

  const transactionRunner = auditDb ? new PostgresOperationTransactions(auditDb) : undefined;
  const offlineCommands = createSessionCommands(sessions, continuation);
  for (const operation of sessionOperations)
    router.register(operation, (request) =>
      transactionRunner
        ? transactionRunner.executeLegacy(request)
        : offlineCommands.execute(request),
    );
  const continuityConfiguration = {
    endpoint_ref: options.continuity_endpoint_ref ?? process.env.CONTINUITY_ENDPOINT_REF ?? '',
    configuration_digest:
      options.continuity_configuration_digest ?? process.env.CONTINUITY_CONFIGURATION_DIGEST ?? '',
  };
  const continuityOperations =
    transactionRunner &&
    continuityConfiguration.endpoint_ref &&
    /^[a-f0-9]{64}$/.test(continuityConfiguration.configuration_digest)
      ? new ContinuityOperations(transactionRunner, continuityConfiguration)
      : undefined;
  const memoryProxyToken = options.ai_memory_proxy_token ?? process.env.AI_MEMORY_ACTOR_PROXY_TOKEN;
  const memoryConnection =
    memoryMode === 'ai-memory-mcp' ? configuredMemoryConnection(options) : undefined;
  const memoryContinuity =
    auditDb &&
    continuityOperations &&
    memoryConnection &&
    memoryProxyToken &&
    (options.memory_enabled ?? process.env.MEMORY_ENABLED !== 'false') &&
    !options.memory_service
      ? new MemoryContinuityOperations(
          new PostgresPreparedMemoryStore(auditDb),
          continuityConfiguration,
          memoryConnection.serverUrl,
          (caller) =>
            new AiMemoryMcpProvider({
              ...memoryConnection,
              token: memoryProxyToken,
              actor_id: caller.actor_id,
              client_id: caller.client_id,
            }).originalOperations(),
        )
      : undefined;
  router.register('session.continuity.capabilities', async (request) => ({
    schema_version: 1,
    trace_id: request.context.trace_id,
    source_refs: [],
    data: await continuityCapabilityReport(
      continuityConfiguration,
      transactionRunner,
      memoryContinuity ? { isReady: () => memoryContinuity.isReady(request.context) } : undefined,
    ),
  }));
  for (const operation of ['execute', 'query', 'close'] as const)
    router.register(`session.continuity.${operation}`, async (request) => {
      const handler = memoryContinuityActions.includes(request.input.action as never)
        ? memoryContinuity
        : continuityOperations;
      if (!handler)
        throw new ContractError(
          'OPERATION_UNAVAILABLE',
          'Durable operation service is not configured',
          { trace_id: request.context.trace_id, retryable: false },
        );
      const proof = await handler[operation](
        request.input as unknown as ContinuityRequest,
        request.context,
      );
      return {
        schema_version: 1,
        trace_id: request.context.trace_id,
        source_refs: proof?.source_refs ?? [],
        data: proof,
      };
    });

  const api = new ApiGateway(router, options.rate_limit ?? 100);
  api.handlerOwnsIdempotency(
    ...sessionOperations,
    ...['capabilities', 'execute', 'query', 'close'].map(
      (operation) => `session.continuity.${operation}`,
    ),
  );
  api.route('GET', '/v1/continuity/capabilities', 'session.continuity.capabilities');
  for (const operation of ['execute', 'query', 'close'])
    api.route('POST', `/v1/continuity/${operation}`, `session.continuity.${operation}`);
  api.routeTemplate('GET', '/v1/projects/{project_id}/state', 'project.state');
  api.routeTemplate('GET', '/v1/work-items/{work_item_id}/context', 'workitem.context');
  api.route('POST', '/v1/context/index', 'context.index');
  api.route('POST', '/v1/context/search', 'context.search');
  api.route('POST', '/v1/context/handoff', 'context.handoff.create');
  api.route('POST', '/v1/context/handoff/claim', 'context.handoff.claim');
  api.route('POST', '/v1/sessions', 'session.start');
  api.routeTemplate('POST', '/v1/sessions/{session_id}/runs', 'session.run.start');
  api.routeTemplate('POST', '/v1/sessions/{session_id}/tool-calls', 'session.tool.call');
  api.routeTemplate('POST', '/v1/sessions/{session_id}/end', 'session.end');
  api.routeTemplate('POST', '/v1/sessions/{session_id}/checkpoint', 'session.checkpoint');
  api.routeTemplate('POST', '/v1/sessions/{session_id}/handoff', 'session.handoff');
  api.routeTemplate('POST', '/v1/sessions/{session_id}/resume', 'session.resume');
  api.routeTemplate('POST', '/v1/handoffs/{handoff_id}/claim', 'session.handoff.claim');

  let server: Server | undefined;
  let runtimeInitialized: Promise<void> | undefined;

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
      persist_audit: persistAudit,
      memory_required: memoryRequired,
      sessions,
      continuation,
      ...(memory ? { memory_service: memory } : {}),
      pending_plane_persistence: new Map(),
    });
  };

  return {
    start: async () => {
      if (auditDb && !runtimeInitialized) {
        runtimeInitialized = (async () => {
          await sessions.hydrate();
          await continuation.hydrate();
          await hydrateRuntimeState({
            db: auditDb,
            search,
            projection,
            registerResource: (hit) => registerResource(resources, hit),
          });
        })();
        await runtimeInitialized;
      }
      return new Promise<string>((resolve, reject) => {
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
      });
    },
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

export function operationPolicyAction(operation: string, input?: Record<string, unknown>): string {
  return operation === 'session.continuity.capabilities'
    ? 'context.read'
    : operation.startsWith('session.continuity.') &&
        memoryContinuityActions.includes(input?.action as never)
      ? 'context.write'
      : operation.startsWith('session.')
        ? 'session.write'
        : operation === 'context.index' || operation.startsWith('context.handoff')
          ? 'context.write'
          : 'context.read';
}

export function httpOperationTrace(headers: IncomingMessage['headers']): string {
  // Explicit operation correlation survives HttpClient/OpenTelemetry transport tracing.
  const value = headers['x-trace-id'] ?? headers.traceparent;
  return (Array.isArray(value) ? value[0] : value) ?? 'trace_http_unknown';
}

function toRouterDecision(
  decision: PolicyDecision,
): { allowed: true } | { allowed: false; reason: string } {
  return decision.allowed ? { allowed: true } : { allowed: false, reason: decision.reason };
}

function runtimeAuditSnapshot(audit: AuditService): AuditRecord[] {
  return audit.snapshot();
}

function resolveMemoryMode(value: string | undefined): MemoryProviderMode | undefined {
  if (value === undefined || value.trim() === '') return undefined;
  if (value === 'in-memory' || value === 'ai-memory-mcp') return value;
  throw new Error(`Unsupported MEMORY_PROVIDER_MODE: ${value}`);
}

function createConfiguredMemory(
  options: PlatformServerOptions,
  mode: MemoryProviderMode,
): MemoryServiceAdapter {
  const configuration: MemoryServiceConfiguration = {
    mode,
    enabled: options.memory_enabled ?? process.env.MEMORY_ENABLED !== 'false',
  };
  if (mode === 'ai-memory-mcp') {
    configuration.ai_memory = configuredMemoryConnection(options);
  }
  return createMemoryService(configuration);
}

function configuredMemoryConnection(options: PlatformServerOptions): AiMemoryMcpProviderOptions {
  const aiMemory: AiMemoryMcpProviderOptions = {
    serverUrl: options.ai_memory_server_url ?? process.env.AI_MEMORY_URL ?? '',
    actor_id: options.memory_actor_id ?? process.env.MEMORY_ACTOR_ID ?? 'planemem-api-gateway',
    client_id: options.memory_client_id ?? process.env.MEMORY_CLIENT_ID ?? 'planemem-api-gateway',
  };
  const token =
    options.ai_memory_token ?? process.env.AI_MEMORY_TOKEN ?? process.env.AI_MEMORY_AUTH_TOKEN;
  if (token) aiMemory.token = token;
  return aiMemory;
}

function toMemoryScope(context: RequestContext): MemoryScope {
  return {
    tenant_id: context.tenant_id as MemoryScope['tenant_id'],
    workspace_id: context.workspace_id as MemoryScope['workspace_id'],
    project_id: context.project_id as MemoryScope['project_id'],
  };
}

async function handleRequest(
  request: IncomingMessage,
  response: ServerResponse,
  api: ApiGateway,
  runtime: RuntimeState,
): Promise<void> {
  const url = new URL(request.url ?? '/', `http://${runtime.host}:${runtime.port}`);
  if (request.method === 'GET' && url.pathname === '/health') {
    const health = {
      service: 'planemem-platform',
      version: runtime.version,
      status: 'ok',
      ...(runtime.memory_service ? { memory: runtime.memory_service.health() } : {}),
    };
    writeJson(response, 200, health);
    return;
  }
  if (request.method === 'GET' && url.pathname === '/health/ready') {
    const memoryHealth = runtime.memory_service?.health();
    const ready = !runtime.memory_required || !memoryHealth || memoryHealth.ready;
    writeJson(response, ready ? 200 : 503, {
      service: 'planemem-platform',
      version: runtime.version,
      status: ready ? 'ready' : 'not_ready',
      ready,
      ...(memoryHealth ? { memory: memoryHealth } : {}),
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
      `# planemem runtime\nplanemem_search_vector_enabled ${runtime.search.health().vector_enabled ? 1 : 0}\nplanemem_audit_records_total ${runtime.audit.health().metrics.records}\n${runtime.memory_service ? `planemem_memory_provider_ready ${runtime.memory_service.health().ready ? 1 : 0}\n` : ''}`,
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

  if ((request.method !== 'GET' && request.method !== 'POST') || !url.pathname.startsWith('/v1/')) {
    writeJson(response, 404, errorEnvelope('NOT_FOUND', 'Route does not exist', request));
    return;
  }

  const traceId = httpOperationTrace(request.headers);
  let body: RuntimeBody = {};
  if (request.method === 'POST') {
    try {
      body = await readJson(request);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Request body must be valid JSON';
      writeJson(response, 400, errorEnvelope('INVALID_JSON', message, request, traceId));
      return;
    }
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
  let consumed;
  try {
    const persistedDuplicate = runtime.audit_db
      ? await eventExists(runtime.audit_db, event.event_id)
      : false;
    const pending = runtime.pending_plane_persistence.get(event.event_id);
    consumed = persistedDuplicate
      ? { status: 'duplicate' as const, event_id: event.event_id, effect_applied: false }
      : pending
        ? { status: 'accepted' as const, event_id: event.event_id, effect_applied: true }
        : runtime.projection.applyPlaneEvent(event);
    if (consumed.status === 'accepted') {
      let state = pending?.state;
      let hit = pending?.hit;
      if (state === undefined || hit === undefined) {
        state = runtime.projection.getObservedState(
          event.aggregate_type === 'project' ? 'Project' : 'WorkItem',
          String((event.payload as Record<string, unknown>).external_id ?? event.aggregate_id),
        );
      }
      if (state !== undefined && hit === undefined) {
        const payload = event.payload as Record<string, unknown>;
        const title = String(payload.title ?? payload.name ?? state.external_id);
        const snippet = `${title} (${state.authority})`;
        hit = runtime.search.index({
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
      if (runtime.audit_db && state !== undefined && hit !== undefined) {
        try {
          const inserted = await persistPlaneEvent(runtime.audit_db, event, state, hit);
          if (!inserted) {
            consumed = {
              status: 'duplicate' as const,
              event_id: event.event_id,
              effect_applied: false,
            };
          } else {
            runtime.pending_plane_persistence.delete(event.event_id);
          }
        } catch (error) {
          runtime.pending_plane_persistence.set(event.event_id, { event, state, hit });
          throw error;
        }
      }
    }
    const auditRecord = runtime.audit.recordAudit({
      tenant_id: event.tenant_id as never,
      workspace_id: event.workspace_id as never,
      project_id: (event.project_id ?? event.aggregate_id) as never,
      actor_id: 'plane-webhook',
      client_id: 'plane',
      action: 'plane.webhook',
      resource: `plane:${event.aggregate_type}:${event.aggregate_id}`,
      result: consumed.status === 'rejected' ? 'error' : 'allowed',
      classification: event.sensitivity,
      details: { status: consumed.status, event_id: event.event_id },
      trace_id: event.trace_id,
      source_refs: event.source_refs,
      idempotency_key: `plane-webhook-${verification.delivery_id}`,
    });
    if (runtime.persist_audit) await runtime.persist_audit(auditRecord);
  } catch (error) {
    writeJson(
      response,
      503,
      errorEnvelope(
        'RUNTIME_PERSISTENCE_UNAVAILABLE',
        error instanceof Error ? error.message : 'Runtime persistence is unavailable',
        request,
        event.trace_id,
      ),
    );
    return;
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

function projectionScope(context: RequestContext): ProjectionScope {
  return {
    tenant_id: context.tenant_id,
    workspace_id: context.workspace_id,
    project_id: context.project_id,
  };
}

function uniqueSourceRefs(
  refs: Array<{ type: string; id: string }>,
): Array<{ type: string; id: string }> {
  return refs.filter(
    (ref, index, all) =>
      all.findIndex((candidate) => candidate.type === ref.type && candidate.id === ref.id) ===
      index,
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

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
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
