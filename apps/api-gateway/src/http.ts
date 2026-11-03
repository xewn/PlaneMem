import { fingerprint, stableValue } from './idempotency.js';
import { ContractError, serializeError, type ErrorEnvelope } from '@planemem/contracts';
import {
  CommandRouter,
  type CommandRequest,
  type CommandResult,
  type RequestContext,
} from './router.js';

export interface HttpRequest {
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  path: string;
  body?: Record<string, unknown>;
  headers: Record<string, string | undefined>;
  context: RequestContext;
}

export interface HttpResponse {
  status: number;
  headers: Record<string, string>;
  body: unknown;
}

export class ApiGateway {
  private readonly routes = new Map<string, string>();
  private readonly routeTemplates: Array<{
    method: HttpRequest['method'];
    pattern: RegExp;
    operation: string;
    parameters: string[];
  }> = [];
  private readonly counters = new Map<string, { count: number; window_started: number }>();
  private readonly idempotentResponses = new Map<
    string,
    { fingerprint: string; result: Promise<CommandResult> }
  >();

  constructor(
    private readonly router: CommandRouter,
    private readonly rateLimit = 100,
  ) {}

  route(method: HttpRequest['method'], path: string, operation: string): void {
    this.routes.set(`${method} ${path}`, operation);
  }

  routeTemplate(method: HttpRequest['method'], template: string, operation: string): void {
    const parameters: string[] = [];
    const pattern = new RegExp(
      `^${template
        .split('/')
        .map((segment) => {
          if (segment.startsWith('{') && segment.endsWith('}')) {
            parameters.push(segment.slice(1, -1));
            return '([^/]+)';
          }
          return escapeRegExp(segment);
        })
        .join('/')}\$`,
    );
    this.routeTemplates.push({ method, pattern, operation, parameters });
  }

  async handle(request: HttpRequest): Promise<HttpResponse> {
    const trace_id = request.context.trace_id;
    const key = `${request.context.actor_id}:${request.path}`;
    const now = Date.now();
    const bucket = this.counters.get(key);
    if (!bucket || now - bucket.window_started >= 60_000)
      this.counters.set(key, { count: 1, window_started: now });
    else if (bucket.count >= this.rateLimit)
      return this.errorResponse(
        new ContractError('RATE_LIMITED', 'Request rate limit exceeded', {
          trace_id,
          retryable: true,
        }),
        trace_id,
      );
    else bucket.count += 1;
    let route;
    try {
      route = this.resolveRoute(request.method, request.path);
    } catch (error) {
      if (!(error instanceof URIError)) throw error;
      return this.errorResponse(
        new ContractError('INVALID_INPUT', 'Invalid path parameter encoding', { trace_id }),
        trace_id,
      );
    }
    if (!route)
      return this.errorResponse(
        new ContractError('NOT_FOUND', 'Route does not exist', {
          path: request.path,
          trace_id,
          retryable: false,
        }),
        trace_id,
      );
    if (
      ['session.handoff', 'session.handoff.receipt'].includes(route.operation) &&
      route.parameters.session_id !== undefined &&
      request.body?.session_id !== undefined &&
      request.body.session_id !== route.parameters.session_id
    )
      return this.errorResponse(
        new ContractError('INVALID_INPUT', 'The original session differs from the route', {
          trace_id,
        }),
        trace_id,
      );
    if (['sync.append', 'sync.ack', 'sync.changes', 'sync.cursor'].includes(route.operation)) {
      const supplied = (name: string) =>
        Object.entries(request.headers)
          .filter(([key, value]) => key.toLowerCase() === name && value !== undefined)
          .map(([, value]) => value);
      const actors = supplied('x-expected-actor-id');
      const clients = supplied('x-expected-client-id');
      const paired = route.operation === 'sync.append' || route.operation === 'sync.ack';
      if (
        (actors.length || clients.length) &&
        (request.context.authenticated_client !== true ||
          actors.length > 1 ||
          clients.length > 1 ||
          (paired && (actors.length !== 1 || clients.length !== 1)) ||
          (actors.length > 0 && actors[0] !== request.context.actor_id) ||
          (clients.length > 0 && clients[0] !== request.context.client_id))
      )
        return this.errorResponse(
          new ContractError('DENIED', 'Original sync identity differs from the verified sender', {
            trace_id,
          }),
          trace_id,
        );
    }
    const command: CommandRequest = {
      operation: route.operation,
      input: { ...(request.body ?? {}), ...route.parameters },
      context: request.context,
    };
    if (
      route.operation === 'proposal.create.receipt' &&
      Object.entries(request.headers).some(
        ([name, value]) =>
          value !== undefined &&
          [
            'idempotency-key',
            'if-match',
            'if-match-version',
            'if-none-match',
            'if-modified-since',
            'if-unmodified-since',
            'range',
            'if-range',
            'content-encoding',
          ].includes(name.toLowerCase()),
      )
    )
      return this.errorResponse(
        new ContractError(
          'INVALID_INPUT',
          'Creation receipt queries do not accept write or cache conditions',
          { trace_id },
        ),
        trace_id,
      );
    if (
      route.operation === 'conflict.read' &&
      request.body?.conflict_id !== undefined &&
      request.body.conflict_id !== route.parameters.conflict_id
    )
      return this.errorResponse(
        new ContractError('INVALID_INPUT', 'Conflict query differs from the route', { trace_id }),
        trace_id,
      );
    try {
      const result = await this.router.execute(command, (run) =>
        // Durable stores recheck source visibility and freshness when replaying a receipt.
        command.operation === 'audit.export' ||
        command.operation.startsWith('conflict.') ||
        command.operation.startsWith('sync.') ||
        command.operation.startsWith('context.pack.') ||
        command.operation.startsWith('context.item.') ||
        command.operation.startsWith('proposal.') ||
        command.operation.startsWith('mcp.') ||
        command.operation.startsWith('plane.inbox.') ||
        command.operation.startsWith('artifact.') ||
        command.operation === 'workbench.query' ||
        command.operation === 'project.state' ||
        command.operation === 'workitem.state' ||
        command.operation === 'workitem.observed.list' ||
        command.operation === 'workitem.context' ||
        command.operation === 'project.search' ||
        command.operation === 'context.search' ||
        command.operation === 'context.index' ||
        command.operation.startsWith('context.index.') ||
        command.operation === 'session.checkpoint.receipt' ||
        command.operation === 'session.start.receipt' ||
        command.operation === 'session.command-context' ||
        command.operation === 'session.command.receipt' ||
        command.operation === 'session.read' ||
        command.operation === 'session.checkpoint.read' ||
        command.operation === 'session.checkpoints.list' ||
        command.operation === 'session.handoff.read' ||
        command.operation === 'session.runs.list' ||
        command.operation === 'session.run.read' ||
        command.operation === 'session.tool.read' ||
        command.operation === 'session.tools.list' ||
        command.operation === 'session.resume.receipt' ||
        command.operation === 'session.handoff.claim.receipt' ||
        command.operation === 'session.handoff.receipt'
          ? run()
          : this.runIdempotently(
              request,
              run,
              [
                'session.checkpoint',
                'session.start',
                'session.resume',
                'session.handoff.claim',
                'session.handoff',
                'session.run.start',
                'session.run.finish',
                'session.tool.call',
                'session.tool.finish',
                'session.end',
              ].includes(command.operation),
            ),
      );
      return {
        status: 200,
        headers: {
          'content-type': 'application/json',
          'cache-control': 'private, no-store',
          'x-trace-id': result.trace_id,
          ...(result.etag ? { etag: result.etag } : {}),
        },
        body: result,
      };
    } catch (error) {
      return this.errorResponse(error, trace_id);
    }
  }

  private async runIdempotently(
    request: HttpRequest,
    run: () => Promise<CommandResult>,
    refreshReceipt = false,
  ): Promise<CommandResult> {
    const key = request.context.idempotency_key;
    if (!key) return run();
    const { tenant_id, workspace_id, project_id, actor_id, client_id, trace_id } = request.context;
    const storageKey = JSON.stringify([
      tenant_id,
      workspace_id,
      project_id,
      actor_id,
      client_id,
      request.method,
      request.path,
      key,
    ]);
    const fingerprint = requestFingerprint(request);
    const previous = this.idempotentResponses.get(storageKey);
    if (previous) {
      if (previous.fingerprint !== fingerprint)
        throw new ContractError(
          'IDEMPOTENCY_KEY_REUSED',
          'Idempotency key was used for another request',
          { trace_id },
        );
      // Keep the original request fingerprint, but recheck saved context on every use.
      return refreshReceipt ? run() : previous.result;
    }
    const result = run();
    this.idempotentResponses.set(storageKey, { fingerprint, result });
    try {
      return await result;
    } catch (error) {
      this.idempotentResponses.delete(storageKey);
      throw error;
    }
  }

  private resolveRoute(
    method: HttpRequest['method'],
    path: string,
  ): { operation: string; parameters: Record<string, string> } | undefined {
    const exact = this.routes.get(`${method} ${path}`);
    if (exact !== undefined) return { operation: exact, parameters: {} };
    for (const template of this.routeTemplates) {
      if (template.method !== method) continue;
      const match = template.pattern.exec(path);
      if (!match) continue;
      const parameters = Object.fromEntries(
        template.parameters.map((name, index) => [
          name,
          decodeURIComponent(match[index + 1] ?? ''),
        ]),
      );
      return { operation: template.operation, parameters };
    }
    return undefined;
  }

  health(): { service: 'api-gateway'; version: '0.1.0'; status: 'ok'; ready: true } {
    return { service: 'api-gateway', version: '0.1.0', status: 'ok', ready: true };
  }

  private errorResponse(error: unknown, trace_id: string): HttpResponse {
    const serialized = JSON.parse(serializeError(error)) as ErrorEnvelope;
    if (serialized.trace_id === 'trace_unknown') serialized.trace_id = trace_id;
    const status =
      serialized.code === 'DENIED' ||
      serialized.code === 'ARTIFACT_ACCESS_DENIED' ||
      serialized.code === 'HANDOFF_ACCESS_DENIED' ||
      serialized.code === 'CONFLICT_ACCESS_DENIED'
        ? 403
        : serialized.code === 'NOT_FOUND' ||
            serialized.code === 'COMMAND_NOT_FOUND' ||
            serialized.code === 'ARTIFACT_NOT_FOUND' ||
            serialized.code === 'ARTIFACT_VERSION_NOT_FOUND' ||
            serialized.code === 'SESSION_NOT_FOUND' ||
            serialized.code === 'RUN_NOT_FOUND' ||
            serialized.code === 'TOOL_CALL_NOT_FOUND' ||
            serialized.code === 'WORK_ITEM_NOT_FOUND' ||
            serialized.code === 'CONFLICT_NOT_FOUND' ||
            serialized.code === 'HANDOFF_NOT_FOUND' ||
            serialized.code === 'CHECKPOINT_NOT_FOUND' ||
            serialized.code === 'CONTEXT_PACK_NOT_FOUND' ||
            serialized.code === 'CONTEXT_ITEM_NOT_FOUND' ||
            serialized.code === 'PROPOSAL_NOT_FOUND'
          ? 404
          : serialized.code === 'CONTEXT_PACK_EXPIRED' ||
              serialized.code === 'OBSERVED_RECORD_DELETED' ||
              serialized.code === 'PROPOSAL_EXPIRED' ||
              serialized.code === 'CONTEXT_ITEM_EXPIRED'
            ? 410
            : serialized.code === 'ARTIFACT_TOO_LARGE' ||
                serialized.code === 'CHECKPOINT_READ_TOO_LARGE' ||
                serialized.code === 'CONFLICT_READ_TOO_LARGE'
              ? 413
              : serialized.code === 'RATE_LIMITED'
                ? 429
                : serialized.code === 'INTERNAL_ERROR' ||
                    serialized.code === 'ARTIFACT_STORED_INVALID' ||
                    serialized.code === 'SYNC_EVENT_INVALID' ||
                    serialized.code === 'SYNC_CHANGES_INVALID' ||
                    serialized.code === 'SYNC_CURSOR_INVALID' ||
                    serialized.code === 'INVALID_CONFLICT_EVENT' ||
                    serialized.code === 'CONTEXT_PACK_INVALID' ||
                    serialized.code === 'SESSION_RECEIPT_INVALID' ||
                    serialized.code === 'SESSION_ACTIVITY_INVALID' ||
                    serialized.code === 'CONFLICT_READ_INVALID' ||
                    serialized.code === 'CONFLICT_REGISTRY_INVALID' ||
                    serialized.code === 'CONFLICT_RECEIPT_INVALID' ||
                    serialized.code === 'SESSION_REGISTRY_INVALID' ||
                    serialized.code === 'HANDOFF_REGISTRY_INVALID' ||
                    serialized.code === 'CHECKPOINT_REGISTRY_INVALID' ||
                    serialized.code === 'SESSION_COMMAND_CONTEXT_INVALID' ||
                    serialized.code === 'CONFLICT_COMMAND_CONTEXT_INVALID' ||
                    serialized.code === 'SYNC_COMMAND_CONTEXT_INVALID' ||
                    serialized.code === 'SYNC_EVENT_RECEIPT_INVALID' ||
                    serialized.code === 'WORK_ITEM_PROJECTION_INVALID' ||
                    serialized.code === 'WORKBENCH_OVERVIEW_INVALID' ||
                    serialized.code === 'WORKBENCH_AUDIT_INVALID' ||
                    serialized.code === 'SEARCH_RESULT_INVALID' ||
                    serialized.code === 'OBSERVED_STATE_INVALID' ||
                    serialized.code === 'PLANE_INBOX_INVALID' ||
                    serialized.code === 'PLANE_PROJECTION_MISMATCH' ||
                    serialized.code === 'MCP_RESOURCE_INVALID' ||
                    serialized.code === 'MEMORY_RESULT_INVALID' ||
                    serialized.code === 'CONTEXT_ITEM_INVALID' ||
                    serialized.code === 'PROPOSAL_INVALID' ||
                    serialized.code === 'WORKBENCH_ADMIN_INVALID'
                  ? 500
                  : serialized.code === 'MEMORY_PROVIDER_OFF' ||
                      serialized.code === 'ARTIFACT_STORAGE_UNAVAILABLE' ||
                      serialized.code === 'ARTIFACT_OBJECT_UNAVAILABLE' ||
                      serialized.code === 'ARTIFACT_OBJECT_MISSING' ||
                      serialized.code === 'MEMORY_MCP_ERROR' ||
                      serialized.code === 'MEMORY_MCP_TOOL_ERROR' ||
                      serialized.code === 'MEMORY_MCP_UNAVAILABLE' ||
                      serialized.code === 'AUDIT_PERSISTENCE_UNAVAILABLE' ||
                      serialized.code === 'AUDIT_EXPORT_BUSY' ||
                      serialized.code === 'AUDIT_EXPORT_TIMEOUT' ||
                      serialized.code === 'CONFLICT_STORAGE_UNAVAILABLE' ||
                      serialized.code === 'SYNC_STORAGE_UNAVAILABLE' ||
                      serialized.code === 'WORKBENCH_DATABASE_UNAVAILABLE' ||
                      serialized.code === 'SEARCH_STORAGE_UNAVAILABLE' ||
                      serialized.code === 'OBSERVED_STATE_UNAVAILABLE' ||
                      serialized.code === 'PLANE_INBOX_UNAVAILABLE' ||
                      serialized.code === 'MCP_STORAGE_UNAVAILABLE' ||
                      serialized.code === 'MEMORY_UNAVAILABLE' ||
                      serialized.code === 'CONTEXT_PERSISTENCE_UNAVAILABLE' ||
                      serialized.code === 'RUNTIME_PERSISTENCE_UNAVAILABLE' ||
                      serialized.code === 'CONTEXT_PACK_STORAGE_UNAVAILABLE' ||
                      serialized.code === 'SESSION_RECEIPT_STORAGE_UNAVAILABLE' ||
                      serialized.code === 'SESSION_STORAGE_UNAVAILABLE' ||
                      serialized.code === 'CONTEXT_ITEM_STORAGE_UNAVAILABLE' ||
                      serialized.code === 'PROPOSAL_STORAGE_UNAVAILABLE'
                    ? 503
                    : serialized.code.includes('CONFLICT') ||
                        serialized.code === 'CURSOR_GAP' ||
                        serialized.code === 'CURSOR_REGRESSION' ||
                        serialized.code === 'HANDOFF_EXPIRED' ||
                        serialized.code === 'HANDOFF_CLAIM_REQUIRED' ||
                        serialized.code === 'MEMORY_MCP_PRECONDITION_FAILED' ||
                        serialized.code === 'IDEMPOTENCY_KEY_REUSED' ||
                        serialized.code === 'EVENT_ID_REUSED' ||
                        serialized.code === 'SESSION_RESUME_LEGACY_UNVERIFIED' ||
                        serialized.code === 'ARTIFACT_LEGACY_UNVERIFIED' ||
                        serialized.code === 'HANDOFF_CLAIM_LEGACY_UNVERIFIED' ||
                        serialized.code === 'HANDOFF_CREATE_LEGACY_UNVERIFIED' ||
                        serialized.code === 'SESSION_START_LEGACY_UNVERIFIED' ||
                        serialized.code === 'CONTEXT_PACK_STALE' ||
                        serialized.code === 'CONTEXT_ITEM_NOT_ARCHIVED' ||
                        serialized.code === 'CONTEXT_ITEM_NOT_PROPOSED' ||
                        serialized.code === 'CONTEXT_ITEM_SOURCE_STALE' ||
                        serialized.code === 'CONTEXT_ITEM_SOURCE_UNAVAILABLE' ||
                        serialized.code === 'PROPOSAL_SOURCE_STALE' ||
                        serialized.code === 'PROPOSAL_SOURCE_UNAVAILABLE' ||
                        serialized.code === 'PROPOSAL_ALREADY_REVIEWED'
                      ? 409
                      : 400;
    return {
      status,
      headers: {
        'content-type': 'application/json',
        'cache-control': 'private, no-store',
        'x-trace-id': serialized.trace_id,
      },
      body: serialized,
    };
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function requestFingerprint(request: HttpRequest): string {
  return JSON.stringify({
    method: request.method,
    path: request.path,
    body: stableValue(request.body ?? {}),
    expected_version: request.context.expected_version,
    tenant_id: request.context.tenant_id,
    workspace_id: request.context.workspace_id,
    project_id: request.context.project_id,
    actor_id: request.context.actor_id,
    client_id: request.context.client_id,
    capability: [...request.context.capability].sort(),
  });
}

export function commandReceipt(request: CommandRequest, key: string) {
  const input: Record<string, unknown> = {
    ...request.input,
    expected_version: request.context.expected_version ?? request.input.expected_version,
  };
  delete input.idempotency_key;
  return {
    key: fingerprint([request.context.actor_id, request.context.client_id, key]),
    fingerprint: fingerprint(input),
  };
}
