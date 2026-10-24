import { ContractError, serializeError, type ErrorEnvelope } from '@planemem/contracts';
import { CommandRouter, type CommandRequest, type RequestContext } from './router.js';

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
  private readonly counters = new Map<string, { count: number; window_started: number }>();
  private readonly idempotentResponses = new Map<
    string,
    { fingerprint: string; response: HttpResponse }
  >();

  constructor(
    private readonly router: CommandRouter,
    private readonly rateLimit = 100,
  ) {}

  route(method: HttpRequest['method'], path: string, operation: string): void {
    this.routes.set(`${method} ${path}`, operation);
  }

  async handle(request: HttpRequest): Promise<HttpResponse> {
    const trace_id = request.context.trace_id;
    const idempotency = idempotencyKey(request);
    if (idempotency) {
      const fingerprint = requestFingerprint(request);
      const previous = this.idempotentResponses.get(idempotency.storageKey);
      if (previous) {
        if (previous.fingerprint !== fingerprint)
          return this.errorResponse(
            new ContractError(
              'IDEMPOTENCY_KEY_REUSED',
              'Idempotency key was used for another request',
              {
                trace_id,
                retryable: false,
              },
            ),
            trace_id,
          );
        return previous.response;
      }
    }
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
    const operation = this.routes.get(`${request.method} ${request.path}`);
    if (!operation)
      return this.errorResponse(
        new ContractError('NOT_FOUND', 'Route does not exist', {
          path: request.path,
          trace_id,
          retryable: false,
        }),
        trace_id,
      );
    const command: CommandRequest = {
      operation,
      input: request.body ?? {},
      context: request.context,
    };
    try {
      const result = await this.router.execute(command);
      const response: HttpResponse = {
        status: 200,
        headers: { 'content-type': 'application/json', 'x-trace-id': result.trace_id },
        body: result,
      };
      if (idempotency) {
        this.idempotentResponses.set(idempotency.storageKey, {
          fingerprint: idempotency.fingerprint,
          response,
        });
      }
      return response;
    } catch (error) {
      return this.errorResponse(error, trace_id);
    }
  }

  health(): { service: 'api-gateway'; version: '0.1.0'; status: 'ok'; ready: true } {
    return { service: 'api-gateway', version: '0.1.0', status: 'ok', ready: true };
  }

  private errorResponse(error: unknown, trace_id: string): HttpResponse {
    const serialized = JSON.parse(serializeError(error)) as ErrorEnvelope;
    if (serialized.trace_id === 'trace_unknown') serialized.trace_id = trace_id;
    const status =
      serialized.code === 'DENIED'
        ? 403
        : serialized.code === 'NOT_FOUND' || serialized.code === 'COMMAND_NOT_FOUND'
          ? 404
          : serialized.code === 'RATE_LIMITED'
            ? 429
            : serialized.code === 'AUDIT_PERSISTENCE_UNAVAILABLE'
              ? 503
              : serialized.code.includes('CONFLICT') || serialized.code === 'IDEMPOTENCY_KEY_REUSED'
                ? 409
                : 400;
    return {
      status,
      headers: { 'content-type': 'application/json', 'x-trace-id': serialized.trace_id },
      body: serialized,
    };
  }
}

function idempotencyKey(
  request: HttpRequest,
): { storageKey: string; fingerprint: string } | undefined {
  const key = request.context.idempotency_key;
  if (!key) return undefined;
  const fingerprint = requestFingerprint(request);
  return {
    storageKey: [
      request.context.tenant_id,
      request.context.actor_id,
      request.method,
      request.path,
      key,
    ].join(':'),
    fingerprint,
  };
}

function requestFingerprint(request: HttpRequest): string {
  return JSON.stringify({
    method: request.method,
    path: request.path,
    body: stableValue(request.body ?? {}),
    tenant_id: request.context.tenant_id,
    workspace_id: request.context.workspace_id,
    project_id: request.context.project_id,
    actor_id: request.context.actor_id,
    client_id: request.context.client_id,
    capability: [...request.context.capability].sort(),
  });
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, stableValue(entry)]),
    );
  }
  return value;
}
