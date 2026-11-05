import { ContractError, type ProjectEntity, validateEntity } from '@planemem/contracts';
import type { WcpRequest, WcpTransport } from './client.js';
import {
  isMockSessionPath,
  type MockSessionAccess,
  type MockSessionStore,
} from './mock-sessions.js';
import { isMockSessionWorkbenchRequest } from './mock-session-workbench.js';
import {
  isMockObservedPath,
  type MockObservedStore,
  type MockObservedSession,
} from './mock-observed.js';
import type { MockWorkItemSession, MockWorkItemStore } from './mock-work-items.js';
import { isMockAuditRequest, type MockAuditSession, type MockAuditStore } from './mock-audit.js';
import { isMockAdminRequest, type MockAdminSession, type MockAdminStore } from './mock-admin.js';
import {
  isMockContextPackPath,
  type MockContextPackSession,
  type MockContextPackStore,
} from './mock-context-packs.js';
import {
  isMockContextReadPath,
  isMockContextDirectoryRequest,
  type MockContextHistorySession,
  type MockContextHistoryStore,
} from './mock-context-history.js';
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
  observed?: { store: MockObservedStore; session: MockObservedSession };
  sessions?: { store: MockSessionStore; session: MockSessionAccess };
  onRequest?: (request: WcpRequest) => void;
  artifacts?: { store: MockArtifactStore; session: MockArtifactSession };
  sync?: { store: MockSyncStore; session: MockSyncSession };
  proposals?: { store: MockProposalStore; session: MockProposalSession };
  work_items?: { store: MockWorkItemStore; session: MockWorkItemSession };
  context_history?: { store: MockContextHistoryStore; session: MockContextHistorySession };
  context_packs?: { store: MockContextPackStore; session: MockContextPackSession };
  audit?: { store: MockAuditStore; session: MockAuditSession };
  admin?: { store: MockAdminStore; session: MockAdminSession };
}

export class MockWcpServer implements WcpTransport {
  private readonly observed: WcpTransport | undefined;
  private readonly sessions: WcpTransport | undefined;
  private readonly idempotentResponses = new Map<string, ProjectEntity>();
  private readonly sync: WcpTransport | undefined;
  private readonly proposals: WcpTransport | undefined;
  private readonly artifacts: WcpTransport | undefined;
  private readonly workItems: WcpTransport | undefined;
  private readonly contextHistory: WcpTransport | undefined;
  private readonly contextPacks: WcpTransport | undefined;
  private readonly audit: WcpTransport | undefined;
  private readonly admin: WcpTransport | undefined;

  constructor(private readonly options: MockWcpServerOptions = {}) {
    this.observed = options.observed?.store.connect(options.observed.session);
    this.sessions = options.sessions?.store.connect(options.sessions.session);
    this.sync = options.sync?.store.connect(options.sync.session);
    this.proposals = options.proposals?.store.connect(options.proposals.session);
    this.artifacts = options.artifacts?.store.connect(options.artifacts.session);
    this.workItems = options.work_items?.store.connect(options.work_items.session);
    this.contextHistory = options.context_history?.store.connect(options.context_history.session);
    this.contextPacks = options.context_packs?.store.connect(options.context_packs.session);
    this.audit = options.audit?.store.connect(options.audit.session);
    this.admin = options.admin?.store.connect(options.admin.session);
  }

  async request<T = unknown>(request: WcpRequest): Promise<T> {
    this.options.onRequest?.(request);
    if (this.observed && isMockObservedPath(request.path)) return this.observed.request<T>(request);
    if (
      this.sessions &&
      (isMockSessionPath(request.path) || isMockSessionWorkbenchRequest(request))
    )
      return this.sessions.request<T>(request);
    if (this.audit && isMockAuditRequest(request)) return this.audit.request<T>(request);
    if (this.admin && isMockAdminRequest(request)) return this.admin.request<T>(request);
    if (this.contextPacks && isMockContextPackPath(request.path))
      return this.contextPacks.request<T>(request);
    if (
      this.contextHistory &&
      (isMockContextReadPath(request.path) || isMockContextDirectoryRequest(request))
    )
      return this.contextHistory.request<T>(request);
    if (
      this.workItems &&
      typeof request.path === 'string' &&
      request.path.split('?')[0] === '/v1/workbench/query'
    )
      return this.workItems.request<T>(request);
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
