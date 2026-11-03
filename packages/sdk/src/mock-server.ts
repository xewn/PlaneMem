import { ContractError, type ProjectEntity, validateEntity } from '@planemem/contracts';
import type { WcpRequest, WcpTransport } from './client.js';
import { isMockSyncPath, type MockSyncSession, type MockSyncStore } from './mock-sync.js';

export interface MockWcpServerOptions {
  onRequest?: (request: WcpRequest) => void;
  sync?: { store: MockSyncStore; session: MockSyncSession };
}

export class MockWcpServer implements WcpTransport {
  private readonly idempotentResponses = new Map<string, ProjectEntity>();
  private readonly sync: WcpTransport | undefined;

  constructor(private readonly options: MockWcpServerOptions = {}) {
    this.sync = options.sync?.store.connect(options.sync.session);
  }

  async request<T = unknown>(request: WcpRequest): Promise<T> {
    this.options.onRequest?.(request);
    if (this.sync && isMockSyncPath(request.path)) return this.sync.request<T>(request);
    if (request.method !== 'POST' || request.path !== '/v1/projects') {
      throw new ContractError('MOCK_ROUTE_NOT_FOUND', 'Mock route not found', {
        trace_id: request.headers.traceparent ?? 'trace_unknown',
        retryable: false,
      });
    }
    const validation = validateEntity('Project', request.body);
    if (!validation.valid) {
      throw new ContractError(validation.error.code, validation.error.message, {
        ...validation.error.details,
        trace_id: validation.error.trace_id,
        retryable: validation.error.retryable,
      });
    }
    const key = request.headers['idempotency-key'];
    if (!key) {
      throw new ContractError(
        'MOCK_IDEMPOTENCY_REQUIRED',
        'Mock request requires Idempotency-Key',
        {
          trace_id: request.headers.traceparent ?? 'trace_unknown',
          retryable: false,
        },
      );
    }
    const previous = this.idempotentResponses.get(key);
    if (previous) {
      return previous as T;
    }
    const project = request.body as ProjectEntity;
    this.idempotentResponses.set(key, project);
    return project as T;
  }
}
