import { ContractError, type ProjectEntity, validateEntity } from '@planemem/contracts';
import type { WcpRequest, WcpTransport } from './client.js';
import {
  isMockArtifactPath,
  type MockArtifactSession,
  type MockArtifactStore,
} from './mock-artifacts.js';
import { isMockSyncPath, type MockSyncSession, type MockSyncStore } from './mock-sync.js';
import {
  isMockProposalPath,
  type MockProposalSession,
  type MockProposalStore,
} from './mock-proposals.js';

export interface MockWcpServerOptions {
  onRequest?: (request: WcpRequest) => void;
  artifacts?: { store: MockArtifactStore; session: MockArtifactSession };
  sync?: { store: MockSyncStore; session: MockSyncSession };
  proposals?: { store: MockProposalStore; session: MockProposalSession };
}

export class MockWcpServer implements WcpTransport {
  private readonly idempotentResponses = new Map<string, ProjectEntity>();
  private readonly sync: WcpTransport | undefined;
  private readonly proposals: WcpTransport | undefined;
  private readonly artifacts: WcpTransport | undefined;

  constructor(private readonly options: MockWcpServerOptions = {}) {
    this.sync = options.sync?.store.connect(options.sync.session);
    this.proposals = options.proposals?.store.connect(options.proposals.session);
    this.artifacts = options.artifacts?.store.connect(options.artifacts.session);
  }

  async request<T = unknown>(request: WcpRequest): Promise<T> {
    this.options.onRequest?.(request);
    if (this.artifacts && isMockArtifactPath(request.path))
      return this.artifacts.request<T>(request);
    if (this.sync && isMockSyncPath(request.path)) return this.sync.request<T>(request);
    if (this.proposals && isMockProposalPath(request.path))
      return this.proposals.request<T>(request);
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
