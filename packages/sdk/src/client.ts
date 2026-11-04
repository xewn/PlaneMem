import {
  ContractError,
  type WorkbenchAuditQuery,
  type SessionRegistryQuery,
  type HandoffRegistryQuery,
  type AuditExportDocument,
  parseArtifactReadQuery,
  parseArtifactReadEnvelope,
  parseArtifactReceiptQuery,
  parseArtifactReceiptEnvelope,
  parseArtifactUploadEnvelope,
  ARTIFACT_UPLOAD_MAX_BYTES,
  ARTIFACT_UPLOAD_REQUEST_BYTES,
  ARTIFACT_DOWNLOAD_DEFAULT_BYTES,
  ARTIFACT_DOWNLOAD_MAX_BYTES,
  parseArtifactDownloadHeaders,
  assertArtifactReceiptIdentity,
  type ArtifactReceiptQuery,
  parseObservedReadInput,
  parseObservedSnapshot,
  parseObservedWorkItemListQuery,
  parseObservedWorkItemPage,
  type ObservedWorkItemListQuery,
  parseObservedWorkItemContext,
  type ObservedReadKind,
  type ObservedSnapshot,
  type ObservedWorkItemContext,
  type ObservedScope,
  parsePlaneInboxListQuery,
  parsePlaneInboxRecordQuery,
  parsePlaneInboxPage,
  parsePlaneInboxRecord,
  type PlaneInboxListQuery,
  parsePlaneInboxSummary,
  parsePlaneInboxDiagnosis,
  parsePlaneInboxIdentity,
  parsePlaneInboxRetryQuery,
  parsePlaneInboxRetryInput,
  parsePlaneInboxRetryReceipt,
  parsePlaneInboxRetryLookup,
  type PlaneInboxRetryInput,
  type PlaneInboxRetryReceipt,
  type PlaneInboxRetryLookup,
  type PlaneInboxIdentity,
  parseLegacyContextStatusQuery,
  parseLegacyContextListQuery,
  parseLegacyContextListPage,
  type LegacyContextListQuery,
  type LegacyContextListPage,
  parseLegacyContextStatus,
  parseLegacyContextMutation,
  parseLegacyContextMutationReceipt,
  type LegacyContextAction,
  type LegacyContextMutation,
  type LegacyContextStatus,
  type LegacyContextMutationReceipt,
  parseWorkbenchOverview,
  type WorkbenchOverview,
  parseProjectSearchQuery,
  parseProjectSearchPage,
  type ProjectSearchQuery,
  type ProjectSearchPage,
  parseWorkItemProjection,
  parseWorkItemProjectionQuery,
  parseWorkItemListQuery,
  parseWorkItemProjectionList,
  type WorkItemListQuery,
  type WorkItemProjection,
  buildEtag,
  isSyncIdentifier,
  isUlid,
  parseEtag,
  type ProjectEntity,
  type RequestContext,
  type SyncUploadEvent,
  type ContextPackReceipt,
  type CheckpointReceiptQuery,
  type ResumeReceiptQuery,
  parseResumeBinding,
  parseResumeCommand,
  parseResumeEnvelope,
  parseResumeReceiptEnvelope,
  type ResumeBinding,
  parseCheckpointBinding,
  parseHandoffReadQuery,
  parseHandoffReadEnvelope,
  parseCheckpointSaveCommand,
  parseCheckpointSaveEnvelope,
  parseCheckpointReceiptEnvelope,
  type CheckpointBinding,
  parseHandoffClaimBinding,
  parseHandoffClaimEnvelope,
  type HandoffClaimReceiptQuery,
  type HandoffClaimBinding,
  parseHandoffCreateBinding,
  parseHandoffCreateEnvelope,
  type HandoffCreateBinding,
  type HandoffCreateCommand,
  type HandoffCreateReceiptQuery,
  parseSessionStartBinding,
  parseSessionStartEnvelope,
  type SessionStartBinding,
  type SessionStartCommand,
  type SessionStartReceiptQuery,
  type SessionCommandIdentity,
  type SessionCommandReceiptQuery,
  parseSessionCommandBinding,
  parseSessionActivityCreateCommand,
  parseSessionActivityCreateEnvelope,
  parseSessionCommandReceiptEnvelope,
  type SessionCommandBinding,
  type SessionActivityCreateOperation,
  parseSessionFinishCommand,
  parseSessionFinishEnvelope,
  type SessionFinishOperation,
  parseSessionRunQuery,
  parseSessionStateQuery,
  parseSessionStateEnvelope,
  parseSessionToolCallQuery,
  parseSessionRunPage,
  parseSessionRunDetail,
  parseSessionToolCallPage,
  parseSessionToolCallDetail,
  type SessionRunQuery,
  type SessionToolCallQuery,
  type SessionRunPage,
  type SessionRunDetail,
  type SessionToolCallPage,
  type SessionToolCallDetail,
  type CompileContextPackRequest,
  type ContextItemReadDocument,
  type ArchivedContextItemDocument,
  type ContextItemMutationReceipt,
  type CreateContextItemRequest,
  type UpdateContextItemRequest,
  type ContextItemListQuery,
  type ContextItemHistoryQuery,
  type ContextItemHistoryPage,
  type ContextItemRevision,
  parseContextItemListQuery,
  parseCreateContextItem,
  parseUpdateContextItem,
  parseConfirmContextItem,
  parseCreateProposal,
  parseProposalListQuery,
  type CreateProposalRequest,
  type ProposalMutationReceipt,
  type ProposalDetail,
  type ProposalPage,
  type ProposalListQuery,
  type ProposalReviewOptions,
  validateEntity,
  validateIdempotencyKey,
  validateRequestContext,
  validateSourceRef,
} from '@planemem/contracts';
import type {
  WcpCheckpointContent,
  WcpConflictDecision,
  WcpConflictResolution,
  WcpEnvelope,
  WcpMemoryRef,
  WcpSession,
  WcpVersionedWriteOptions,
  WcpWriteOptions,
} from './continuity.js';

import { readAuditRecords, exportReviewedAuditView, type WcpAuditOptions } from './audit.js';
import { readAdminSnapshot, type WcpAdminOptions } from './admin.js';
import {
  readArtifactUploadContext,
  type WcpArtifactUploadContextOptions,
} from './artifact-upload-context.js';
import { uploadSyncEvents, type WcpSyncUploadOptions } from './sync-upload.js';
import { readSyncChanges, iterateSyncChanges, type WcpSyncChangesOptions } from './sync-changes.js';
import {
  readSyncCursor,
  acknowledgeSync,
  type WcpSyncCursorOptions,
  type WcpSyncAckOptions,
} from './sync-cursor.js';
import type { SyncChangesQuery } from '@planemem/contracts';
import { readSyncEventReceipt, type WcpSyncEventReceiptOptions } from './sync-event-receipt.js';
import type { SyncEventReceiptQuery } from '@planemem/contracts';
import {
  readSyncCommandContext,
  type WcpSyncCommandContextOptions,
} from './sync-command-context.js';
import { readSessionRegistry, type WcpSessionRegistryOptions } from './session-registry.js';
import {
  readSessionCommandContext,
  type WcpSessionCommandContextOptions,
} from './session-command-context.js';
import {
  readCheckpointRegistry,
  type WcpCheckpointRegistryOptions,
} from './checkpoint-registry.js';
import type { CheckpointRegistryQuery } from '@planemem/contracts';
import { readHandoffRegistry, type WcpHandoffRegistryOptions } from './handoff-registry.js';
import { readConflict, type WcpConflictReadOptions } from './conflict-read.js';
import { readConflictRegistry, type WcpConflictRegistryOptions } from './conflict-registry.js';
import type { ConflictRegistryQuery } from '@planemem/contracts';
import type { ConflictReceiptQuery } from '@planemem/contracts';
import { readConflictReceipt, type WcpConflictReceiptOptions } from './conflict-receipt.js';
import {
  readProposalCreateReceipt,
  type WcpProposalCreateReceiptOptions,
} from './proposal-create-receipt.js';
import type { ProposalCreateReceiptQuery } from '@planemem/contracts';
import {
  readProposalReviewReceipt,
  type WcpProposalReviewReceiptOptions,
} from './proposal-review-receipt.js';
import type { ProposalReviewReceiptQuery } from '@planemem/contracts';
import {
  submitConflictDecision,
  type WcpConflictSubmissionOptions,
} from './conflict-submission.js';
import {
  readConflictCommandContext,
  type WcpConflictCommandContextOptions,
} from './conflict-command-context.js';
import {
  readCheckpointDetail,
  readCheckpointHistory,
  readWorkbenchCheckpointHistory,
  type WcpCheckpointReadOptions,
} from './checkpoint-reads.js';

export interface WcpRequest {
  method: 'GET' | 'POST';
  path: string;
  headers: Record<string, string>;
  /** JSON-compatible data, or native FormData for artifact uploads. */
  body?: unknown;
  response_type?: 'json' | 'bytes' | 'bounded-json';
  /** Required for bytes/bounded-json; applied while reading, before returning any content. */
  max_response_bytes?: number;
  /** Supported by bounded-json; cancellation stops local waiting, not remote side effects. */
  signal?: AbortSignal;
}

export interface WcpBinaryResponse {
  status: number;
  headers: Record<string, string>;
  content: Uint8Array;
}

export interface WcpTransport {
  request<T = unknown>(request: WcpRequest): Promise<T>;
}

/** Preserve these identity preconditions with the original command and key. */
export interface WcpPlaneInboxRetryOptions extends WcpWriteOptions {
  expected_actor_id: string;
  expected_client_id: string;
}

export class WcpClient {
  private readonly context: RequestContext;

  constructor(
    private readonly transport: WcpTransport,
    context: RequestContext,
  ) {
    this.context = { ...validateRequestContext(context) };
  }

  /** One current page only; keep original filters when passing next_cursor explicitly. */
  listAuditRecords(query: WorkbenchAuditQuery = {}, options: WcpAuditOptions = {}) {
    return readAuditRecords(this.transport, this.context, query, options);
  }

  /** Project counts and a database read observation; external readiness remains unchecked. */
  getAdminSnapshot(options: WcpAdminOptions = {}) {
    return readAdminSnapshot(this.transport, this.context, options);
  }

  /** Caller-reviewed bounded document; returns verified content in memory, without saving. */
  exportAuditView(document: AuditExportDocument, options: WcpAuditOptions = {}) {
    return exportReviewedAuditView(this.transport, this.context, document, options);
  }

  async startSession(
    input: SessionStartCommand,
    options: WcpWriteOptions,
    expectedIdentity?: SessionCommandIdentity,
  ) {
    if (
      !options ||
      typeof options !== 'object' ||
      Array.isArray(options) ||
      Object.keys(options).some((key) => key !== 'idempotency_key') ||
      this.context.expected_version !== undefined ||
      this.context.if_match !== undefined
    )
      throw this.invalid(
        'Session start uses the original request key without a version precondition',
      );
    const binding = this.sessionStartBinding(
      { request_key: options.idempotency_key, session: input },
      expectedIdentity,
    );
    const result = await this.envelope<unknown>('POST', '/v1/sessions', binding.query.session, {
      'idempotency-key': binding.query.request_key,
      'x-expected-actor-id': binding.identity.actor_id,
      'x-expected-client-id': binding.identity.client_id,
    });
    try {
      return parseSessionStartEnvelope(result, binding, this.context.trace_id, false);
    } catch {
      throw this.invalidResponse();
    }
  }

  /** Query the original start without creating a session. Absence does not prove failure. */
  async getSessionStartReceipt(
    input: SessionStartReceiptQuery,
    expectedIdentity?: SessionCommandIdentity,
  ) {
    const binding = this.sessionStartBinding(input, expectedIdentity);
    const result = await this.envelope<unknown>(
      'POST',
      '/v1/sessions/start/receipt',
      binding.query,
      {
        'x-expected-actor-id': binding.identity.actor_id,
        'x-expected-client-id': binding.identity.client_id,
      },
    );
    try {
      return parseSessionStartEnvelope(result, binding, this.context.trace_id, true);
    } catch {
      throw this.invalidResponse();
    }
  }

  private sessionStartBinding(
    input: unknown,
    expectedIdentity?: SessionCommandIdentity,
  ): SessionStartBinding {
    try {
      const binding = parseSessionStartBinding(
        input,
        expectedIdentity ?? {
          tenant_id: this.context.tenant_id,
          workspace_id: this.context.workspace_id,
          project_id: this.context.project_id,
          actor_id: this.context.actor_id,
          client_id: this.context.client_id,
        },
        this.context,
      );
      if (
        (this.context.actor_id !== undefined &&
          binding.identity.actor_id !== this.context.actor_id) ||
        (this.context.client_id !== undefined &&
          binding.identity.client_id !== this.context.client_id)
      )
        throw new TypeError('The original start identity differs from this client context');
      return binding;
    } catch (error) {
      throw this.invalid(
        error instanceof Error
          ? error.message
          : 'Supply the original start identity and parameters',
      );
    }
  }

  createProposal(input: CreateProposalRequest, options: WcpWriteOptions) {
    let body: ReturnType<typeof parseCreateProposal>;
    try {
      body = parseCreateProposal(input);
    } catch (error) {
      throw this.invalid(error instanceof Error ? error.message : 'Invalid proposal');
    }
    return this.command<ProposalMutationReceipt>('/v1/proposals', body, options);
  }
  getProposalCreateReceipt(
    input: ProposalCreateReceiptQuery,
    options: WcpProposalCreateReceiptOptions = {},
  ) {
    return readProposalCreateReceipt(this.transport, this.context, input, options);
  }
  getProposalReviewReceipt(
    input: ProposalReviewReceiptQuery,
    options: WcpProposalReviewReceiptOptions = {},
  ) {
    return readProposalReviewReceipt(this.transport, this.context, input, options);
  }
  listProposals(input: ProposalListQuery = {}) {
    let filters: ProposalListQuery;
    try {
      filters = parseProposalListQuery(input);
    } catch (error) {
      throw this.invalid(error instanceof Error ? error.message : 'Invalid proposal filters');
    }
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(filters))
      if (value !== undefined) query.set(key, String(value));
    return this.envelope<ProposalPage>('GET', '/v1/proposals' + (query.size ? '?' + query : ''));
  }
  getProposal(id: string) {
    return this.envelope<ProposalDetail>('GET', '/v1/proposals/' + this.segment(id));
  }
  confirmProposal(id: string, reason: string, options: ProposalReviewOptions) {
    return this.reviewProposal(id, 'confirm', reason, options);
  }
  rejectProposal(id: string, reason: string, options: ProposalReviewOptions) {
    return this.reviewProposal(id, 'reject', reason, options);
  }
  private reviewProposal(
    id: string,
    decision: 'confirm' | 'reject',
    reason: string,
    options: ProposalReviewOptions,
  ) {
    if (typeof reason !== 'string' || !reason.trim() || reason.length > 2000)
      throw this.invalid('Supply a review reason of at most 2000 characters');
    return this.command<ProposalMutationReceipt>(
      '/v1/proposals/' + this.segment(id) + '/' + decision,
      { reason, expected_revision: options.expected_revision },
      {
        idempotency_key: options.idempotency_key,
        expected_version: options.expected_revision,
      } as WcpVersionedWriteOptions,
      true,
    );
  }

  createContextItem(input: CreateContextItemRequest, options: WcpWriteOptions) {
    let body: Required<CreateContextItemRequest>;
    try {
      body = parseCreateContextItem(input);
    } catch (error) {
      throw this.invalid(error instanceof Error ? error.message : 'Invalid context item');
    }
    return this.command<ContextItemMutationReceipt>('/v1/context-items', body, options);
  }

  getContextItem(itemId: string) {
    return this.envelope<ContextItemReadDocument>(
      'GET',
      '/v1/context-items/' + this.segment(itemId),
    );
  }

  getArchivedContextItem(itemId: string) {
    return this.envelope<ArchivedContextItemDocument>(
      'GET',
      '/v1/context-items/' + this.segment(itemId) + '/archived',
    );
  }

  listContextItemHistory(itemId: string, input: ContextItemHistoryQuery = {}) {
    const query = new URLSearchParams();
    for (const [field, value] of Object.entries(input)) {
      if (value === undefined) continue;
      if (
        !['before_version', 'limit'].includes(field) ||
        typeof value !== 'number' ||
        !Number.isSafeInteger(value) ||
        value < 1 ||
        (field === 'limit' && value > 100)
      )
        throw this.invalid('History accepts a positive before_version and limit between 1 and 100');
      query.set(field, String(value));
    }
    return this.envelope<ContextItemHistoryPage>(
      'GET',
      '/v1/context-items/' + this.segment(itemId) + '/history' + (query.size ? '?' + query : ''),
    );
  }

  getContextItemVersion(itemId: string, version: number) {
    if (!Number.isSafeInteger(version) || version < 1)
      throw this.invalid('version must be a positive safe integer');
    return this.envelope<ContextItemRevision>(
      'GET',
      '/v1/context-items/' + this.segment(itemId) + '/versions/' + version,
    );
  }

  listContextItems(input: ContextItemListQuery = {}) {
    let query: ContextItemListQuery;
    try {
      query = parseContextItemListQuery(input);
    } catch (error) {
      throw this.invalid(error instanceof Error ? error.message : 'Invalid context query');
    }
    return this.envelope<Record<string, unknown>[]>('POST', '/v1/workbench/query', {
      ...query,
      operation: 'context',
    });
  }

  updateContextItem(
    itemId: string,
    input: UpdateContextItemRequest,
    options: WcpVersionedWriteOptions,
  ) {
    let body: UpdateContextItemRequest;
    try {
      body = parseUpdateContextItem(input);
    } catch (error) {
      throw this.invalid(error instanceof Error ? error.message : 'Invalid context update');
    }
    return this.command<ContextItemMutationReceipt>(
      '/v1/context-items/' + this.segment(itemId) + '/update',
      body,
      options,
      true,
    );
  }

  archiveContextItem(itemId: string, options: WcpVersionedWriteOptions) {
    return this.command<ContextItemMutationReceipt>(
      '/v1/context-items/' + this.segment(itemId) + '/archive',
      {},
      options,
      true,
    );
  }

  restoreContextItem(itemId: string, options: WcpVersionedWriteOptions) {
    return this.command<ContextItemMutationReceipt>(
      '/v1/context-items/' + this.segment(itemId) + '/restore',
      {},
      options,
      true,
    );
  }

  confirmContextItem(itemId: string, reason: string, options: WcpVersionedWriteOptions) {
    let body: { reason: string };
    try {
      body = parseConfirmContextItem({ reason });
    } catch (error) {
      throw this.invalid(error instanceof Error ? error.message : 'Invalid confirmation reason');
    }
    return this.command<ContextItemMutationReceipt>(
      '/v1/context-items/' + this.segment(itemId) + '/confirm',
      body,
      options,
      true,
    );
  }

  compileContextPack(input: CompileContextPackRequest, options: WcpWriteOptions) {
    if (
      input.budget_tokens !== undefined &&
      (!Number.isSafeInteger(input.budget_tokens) ||
        input.budget_tokens < 128 ||
        input.budget_tokens > 32768)
    )
      throw this.invalid('budget_tokens must be between 128 and 32768');
    if (
      input.ttl_seconds !== undefined &&
      (!Number.isSafeInteger(input.ttl_seconds) ||
        input.ttl_seconds < 60 ||
        input.ttl_seconds > 86400)
    )
      throw this.invalid('ttl_seconds must be between 60 and 86400');
    return this.command<ContextPackReceipt>('/v1/context-pack/compile', input, options);
  }

  getContextPack(input: { pack_id?: string; format?: 'json' | 'markdown' | 'mcp' } = {}) {
    const query = new URLSearchParams();
    if (input.pack_id !== undefined) {
      if (!isUlid(input.pack_id)) throw this.invalid('pack_id must be a ULID');
      query.set('pack_id', input.pack_id);
    }
    if (input.format !== undefined) {
      if (!['json', 'markdown', 'mcp'].includes(input.format))
        throw this.invalid('Unsupported pack format');
      query.set('format', input.format);
    }
    return this.envelope<ContextPackReceipt>(
      'GET',
      '/v1/context-pack' + (query.size ? '?' + query : ''),
    );
  }

  async startAgentRun(
    sessionId: string,
    input: { model?: string },
    options: WcpVersionedWriteOptions,
    expectedIdentity?: SessionCommandIdentity,
  ) {
    const result = await this.createSessionActivity(
      sessionId,
      'run.start',
      input,
      options,
      expectedIdentity,
    );
    if (!('sequence' in result.data)) throw this.invalidResponse();
    return { ...result, data: result.data };
  }

  async finishAgentRun(
    sessionId: string,
    runId: string,
    status: 'completed' | 'failed',
    options: WcpVersionedWriteOptions & { expected_run_version: number },
    expectedIdentity?: SessionCommandIdentity,
  ) {
    const result = await this.finishSessionCommand(
      sessionId,
      'run.finish',
      this.sessionPath(sessionId, 'runs') + '/' + this.segment(runId) + '/finish',
      { run_id: runId, status, expected_run_version: options?.expected_run_version },
      options,
      expectedIdentity,
    );
    if (!('sequence' in result.data)) throw this.invalidResponse();
    return { ...result, data: result.data };
  }

  async recordToolCall(
    sessionId: string,
    input: { run_id: string; tool_name: string; status: 'started' | 'succeeded' | 'failed' },
    options: WcpVersionedWriteOptions,
    expectedIdentity?: SessionCommandIdentity,
  ) {
    const result = await this.createSessionActivity(
      sessionId,
      'tool.call',
      input,
      options,
      expectedIdentity,
    );
    if (!('tool_call_id' in result.data)) throw this.invalidResponse();
    return { ...result, data: result.data };
  }

  async finishToolCall(
    sessionId: string,
    toolCallId: string,
    status: 'succeeded' | 'failed',
    options: WcpVersionedWriteOptions & { expected_tool_version: number },
    expectedIdentity?: SessionCommandIdentity,
  ) {
    const result = await this.finishSessionCommand(
      sessionId,
      'tool.finish',
      this.sessionPath(sessionId, 'tool-calls') + '/' + this.segment(toolCallId) + '/finish',
      { tool_call_id: toolCallId, status, expected_tool_version: options?.expected_tool_version },
      options,
      expectedIdentity,
    );
    if (!('tool_call_id' in result.data)) throw this.invalidResponse();
    return { ...result, data: result.data };
  }

  async endSession(
    sessionId: string,
    status: 'ended' | 'abandoned' | 'failed',
    options: WcpVersionedWriteOptions,
    expectedIdentity?: SessionCommandIdentity,
  ) {
    const result = await this.finishSessionCommand(
      sessionId,
      'end',
      this.sessionPath(sessionId, 'end'),
      { status },
      options,
      expectedIdentity,
    );
    if (!('ended_at' in result.data)) throw this.invalidResponse();
    return { ...result, data: result.data };
  }

  private async finishSessionCommand(
    sessionId: string,
    operation: SessionFinishOperation,
    path: string,
    input: Record<string, unknown>,
    options: WcpVersionedWriteOptions,
    expectedIdentity?: SessionCommandIdentity,
  ) {
    let command: SessionCommandReceiptQuery['command'];
    try {
      const fields = [
        'idempotency_key',
        'expected_version',
        ...(operation === 'run.finish'
          ? ['expected_run_version']
          : operation === 'tool.finish'
            ? ['expected_tool_version']
            : []),
      ];
      if (
        !options ||
        typeof options !== 'object' ||
        Array.isArray(options) ||
        Object.keys(options).some((key) => !fields.includes(key)) ||
        (this.context.idempotency_key !== undefined &&
          this.context.idempotency_key !== options.idempotency_key) ||
        (this.context.expected_version !== undefined &&
          this.context.expected_version !== options.expected_version) ||
        (this.context.if_match !== undefined &&
          parseEtag(this.context.if_match) !== options.expected_version)
      )
        throw new TypeError('Use only matching original result key and version options');
      command = parseSessionFinishCommand(operation, {
        ...input,
        expected_version: options.expected_version,
      });
    } catch (error) {
      throw this.invalid(
        error instanceof Error ? error.message : 'Invalid original result request',
      );
    }
    const binding = this.sessionCommandBinding(
      sessionId,
      { operation, request_key: options.idempotency_key, command },
      expectedIdentity,
    );
    const result = await this.envelope<unknown>('POST', path, binding.query.command, {
      'idempotency-key': binding.query.request_key,
      'if-match': buildEtag(command.expected_version),
      'x-expected-actor-id': binding.identity.actor_id,
      'x-expected-client-id': binding.identity.client_id,
    });
    try {
      return parseSessionFinishEnvelope(result, binding, this.context.trace_id);
    } catch {
      throw this.invalidResponse();
    }
  }

  async getSessionCommandReceipt(
    sessionId: string,
    input: SessionCommandReceiptQuery,
    expectedIdentity?: SessionCommandIdentity,
  ) {
    const binding = this.sessionCommandBinding(sessionId, input, expectedIdentity);
    const result = await this.envelope<unknown>(
      'POST',
      this.sessionPath(sessionId, 'commands/receipt'),
      binding.query,
      {
        'x-expected-actor-id': binding.identity.actor_id,
        'x-expected-client-id': binding.identity.client_id,
      },
    );
    try {
      return parseSessionCommandReceiptEnvelope(result, binding, this.context.trace_id);
    } catch {
      throw this.invalidResponse();
    }
  }

  private sessionCommandBinding(
    sessionId: string,
    input: unknown,
    expectedIdentity?: SessionCommandIdentity,
  ): SessionCommandBinding {
    try {
      const binding = parseSessionCommandBinding(
        sessionId,
        input,
        expectedIdentity ?? {
          tenant_id: this.context.tenant_id,
          workspace_id: this.context.workspace_id,
          project_id: this.context.project_id,
          actor_id: this.context.actor_id,
          client_id: this.context.client_id,
        },
        this.context,
      );
      if (
        (this.context.actor_id !== undefined &&
          this.context.actor_id !== binding.identity.actor_id) ||
        (this.context.client_id !== undefined &&
          this.context.client_id !== binding.identity.client_id)
      )
        throw new TypeError('The original command identity differs from this client context');
      return binding;
    } catch (error) {
      throw this.invalid(
        error instanceof Error
          ? error.message
          : 'Supply the original command identity and parameters',
      );
    }
  }

  private async createSessionActivity(
    sessionId: string,
    operation: SessionActivityCreateOperation,
    input: object,
    options: WcpVersionedWriteOptions,
    expectedIdentity?: SessionCommandIdentity,
  ) {
    let command: SessionCommandReceiptQuery['command'];
    try {
      const fields = operation === 'run.start' ? ['model'] : ['run_id', 'tool_name', 'status'];
      if (
        !input ||
        typeof input !== 'object' ||
        Array.isArray(input) ||
        Object.keys(input).some((key) => !fields.includes(key)) ||
        !options ||
        typeof options !== 'object' ||
        Array.isArray(options) ||
        Object.keys(options).some(
          (key) => !['idempotency_key', 'expected_version'].includes(key),
        ) ||
        (this.context.idempotency_key !== undefined &&
          this.context.idempotency_key !== options.idempotency_key) ||
        (this.context.expected_version !== undefined &&
          this.context.expected_version !== options.expected_version) ||
        (this.context.if_match !== undefined &&
          parseEtag(this.context.if_match) !== options.expected_version)
      )
        throw new TypeError(
          'Use only declared activity fields and matching original key/version options',
        );
      command = parseSessionActivityCreateCommand(operation, {
        ...input,
        expected_version: options.expected_version,
      });
    } catch (error) {
      throw this.invalid(error instanceof Error ? error.message : 'Invalid activity creation');
    }
    const binding = this.sessionCommandBinding(
      sessionId,
      { operation, request_key: options.idempotency_key, command },
      expectedIdentity,
    );
    const result = await this.envelope<unknown>(
      'POST',
      this.sessionPath(sessionId, operation === 'run.start' ? 'runs' : 'tool-calls'),
      binding.query.command,
      {
        'idempotency-key': binding.query.request_key,
        'if-match': buildEtag(command.expected_version),
        'x-expected-actor-id': binding.identity.actor_id,
        'x-expected-client-id': binding.identity.client_id,
      },
    );
    try {
      return parseSessionActivityCreateEnvelope(result, binding, this.context.trace_id);
    } catch {
      throw this.invalidResponse();
    }
  }

  async createCheckpoint(
    sessionId: string,
    input: WcpCheckpointContent & { memory_ref?: WcpMemoryRef } & (
        | { context_pack_id?: string; context_pack?: never }
        | { context_pack_id?: never; context_pack: object }
      ),
    options: WcpVersionedWriteOptions,
    expectedIdentity?: SessionCommandIdentity,
  ) {
    let command;
    try {
      if (
        !options ||
        typeof options !== 'object' ||
        Array.isArray(options) ||
        Object.keys(options).some(
          (key) => !['idempotency_key', 'expected_version'].includes(key),
        ) ||
        (this.context.idempotency_key !== undefined &&
          this.context.idempotency_key !== options.idempotency_key) ||
        (this.context.expected_version !== undefined &&
          this.context.expected_version !== options.expected_version) ||
        (this.context.if_match !== undefined &&
          parseEtag(this.context.if_match) !== options.expected_version) ||
        !input ||
        typeof input !== 'object' ||
        Array.isArray(input) ||
        ('expected_version' in input && input.expected_version !== options.expected_version)
      )
        throw new TypeError('Use matching original checkpoint key and version options');
      command = parseCheckpointSaveCommand({
        ...input,
        expected_version: options.expected_version,
      });
    } catch (error) {
      throw this.invalid(error instanceof Error ? error.message : 'Invalid original checkpoint');
    }
    const binding = this.checkpointBinding(
      sessionId,
      { request_key: options.idempotency_key, checkpoint: command },
      expectedIdentity,
    );
    const result = await this.envelope<unknown>(
      'POST',
      this.sessionPath(sessionId, 'checkpoint'),
      binding.query.checkpoint,
      {
        'idempotency-key': binding.query.request_key,
        'if-match': buildEtag(binding.query.checkpoint.expected_version),
        'x-expected-actor-id': binding.identity.actor_id,
        'x-expected-client-id': binding.identity.client_id,
      },
    );
    try {
      return parseCheckpointSaveEnvelope(result, binding, this.context.trace_id);
    } catch {
      throw this.invalidResponse();
    }
  }

  async getCheckpointReceipt(
    sessionId: string,
    input: CheckpointReceiptQuery,
    expectedIdentity?: SessionCommandIdentity,
  ) {
    const binding = this.checkpointBinding(sessionId, input, expectedIdentity);
    const result = await this.envelope<unknown>(
      'POST',
      this.sessionPath(sessionId, 'checkpoint/receipt'),
      binding.query,
      {
        'x-expected-actor-id': binding.identity.actor_id,
        'x-expected-client-id': binding.identity.client_id,
      },
    );
    try {
      return parseCheckpointReceiptEnvelope(result, binding, this.context.trace_id);
    } catch {
      throw this.invalidResponse();
    }
  }

  private checkpointBinding(
    sessionId: string,
    input: unknown,
    expectedIdentity?: SessionCommandIdentity,
  ): CheckpointBinding {
    try {
      const binding = parseCheckpointBinding(
        sessionId,
        input,
        expectedIdentity ?? {
          tenant_id: this.context.tenant_id,
          workspace_id: this.context.workspace_id,
          project_id: this.context.project_id,
          actor_id: this.context.actor_id,
          client_id: this.context.client_id,
        },
        this.context,
      );
      if (
        (this.context.actor_id !== undefined &&
          this.context.actor_id !== binding.identity.actor_id) ||
        (this.context.client_id !== undefined &&
          this.context.client_id !== binding.identity.client_id)
      )
        throw new TypeError('The original checkpoint identity differs from this client context');
      return binding;
    } catch (error) {
      throw this.invalid(
        error instanceof Error ? error.message : 'Supply the original checkpoint identity',
      );
    }
  }

  async createHandoff(
    sessionId: string,
    input: HandoffCreateCommand,
    options: WcpWriteOptions,
    expectedIdentity?: SessionCommandIdentity,
  ) {
    if (
      !options ||
      typeof options !== 'object' ||
      Array.isArray(options) ||
      Object.keys(options).some((key) => key !== 'idempotency_key') ||
      this.context.expected_version !== undefined ||
      this.context.if_match !== undefined
    )
      throw this.invalid('Handoff creation uses a request key without a version precondition');
    const binding = this.handoffCreateBinding(
      sessionId,
      {
        request_key: options?.idempotency_key,
        handoff: input,
      },
      expectedIdentity,
    );
    const result = await this.envelope<unknown>(
      'POST',
      this.sessionPath(sessionId, 'handoff'),
      binding.query.handoff,
      {
        'idempotency-key': binding.query.request_key,
        'x-expected-actor-id': binding.identity.actor_id,
        'x-expected-client-id': binding.identity.client_id,
      },
    );
    try {
      return parseHandoffCreateEnvelope(result, binding, this.context.trace_id, false);
    } catch {
      throw this.invalidResponse();
    }
  }

  /** Read the original creation result without creating, claiming or resuming a handoff. */
  async getHandoffCreateReceipt(
    sessionId: string,
    input: HandoffCreateReceiptQuery,
    expectedIdentity?: SessionCommandIdentity,
  ) {
    const binding = this.handoffCreateBinding(sessionId, input, expectedIdentity);
    const result = await this.envelope<unknown>(
      'POST',
      this.sessionPath(sessionId, 'handoff/receipt'),
      binding.query,
      {
        'x-expected-actor-id': binding.identity.actor_id,
        'x-expected-client-id': binding.identity.client_id,
      },
    );
    try {
      return parseHandoffCreateEnvelope(result, binding, this.context.trace_id, true);
    } catch {
      throw this.invalidResponse();
    }
  }

  private handoffCreateBinding(
    sessionId: string,
    input: unknown,
    expectedIdentity?: SessionCommandIdentity,
  ): HandoffCreateBinding {
    try {
      const binding = parseHandoffCreateBinding(
        sessionId,
        input,
        expectedIdentity ?? {
          tenant_id: this.context.tenant_id,
          workspace_id: this.context.workspace_id,
          project_id: this.context.project_id,
          actor_id: this.context.actor_id,
          client_id: this.context.client_id,
        },
        this.context,
      );
      if (
        (this.context.actor_id !== undefined &&
          binding.identity.actor_id !== this.context.actor_id) ||
        (this.context.client_id !== undefined &&
          binding.identity.client_id !== this.context.client_id)
      )
        throw new TypeError('The original creation identity differs from this client context');
      return binding;
    } catch (error) {
      throw this.invalid(
        error instanceof Error
          ? error.message
          : 'Supply the original creation identity and parameters',
      );
    }
  }

  async claimHandoff(
    handoffId: string,
    options: WcpVersionedWriteOptions,
    expectedIdentity?: SessionCommandIdentity,
  ) {
    const binding = this.handoffClaimBinding(
      handoffId,
      {
        request_key: options?.idempotency_key,
        claim: { expected_version: options?.expected_version },
      },
      expectedIdentity,
    );
    const result = await this.envelope<unknown>(
      'POST',
      '/v1/handoffs/' + this.segment(handoffId) + '/claim',
      {},
      {
        'idempotency-key': binding.query.request_key,
        'if-match': buildEtag(binding.query.claim.expected_version),
        'x-expected-actor-id': binding.identity.actor_id,
        'x-expected-client-id': binding.identity.client_id,
      },
    );
    try {
      return parseHandoffClaimEnvelope(result, binding, this.context.trace_id, false);
    } catch {
      throw this.invalidResponse();
    }
  }

  /** Read the original durable claim without claiming again. Absence does not prove failure. */
  async getHandoffClaimReceipt(
    handoffId: string,
    input: HandoffClaimReceiptQuery,
    expectedIdentity?: SessionCommandIdentity,
  ) {
    const binding = this.handoffClaimBinding(handoffId, input, expectedIdentity);
    const result = await this.envelope<unknown>(
      'POST',
      '/v1/handoffs/' + this.segment(handoffId) + '/claim/receipt',
      binding.query,
      {
        'x-expected-actor-id': binding.identity.actor_id,
        'x-expected-client-id': binding.identity.client_id,
      },
    );
    try {
      return parseHandoffClaimEnvelope(result, binding, this.context.trace_id, true);
    } catch {
      throw this.invalidResponse();
    }
  }

  private handoffClaimBinding(
    handoffId: string,
    input: unknown,
    expectedIdentity?: SessionCommandIdentity,
  ): HandoffClaimBinding {
    try {
      const binding = parseHandoffClaimBinding(
        handoffId,
        input,
        expectedIdentity ?? {
          tenant_id: this.context.tenant_id,
          workspace_id: this.context.workspace_id,
          project_id: this.context.project_id,
          actor_id: this.context.actor_id,
          client_id: this.context.client_id,
        },
        this.context,
      );
      if (
        (this.context.actor_id !== undefined &&
          binding.identity.actor_id !== this.context.actor_id) ||
        (this.context.client_id !== undefined &&
          binding.identity.client_id !== this.context.client_id)
      )
        throw new TypeError('The original claim identity differs from this client context');
      return binding;
    } catch (error) {
      throw this.invalid(
        error instanceof Error
          ? error.message
          : 'Supply the original claim identity and parameters',
      );
    }
  }

  async resumeSession(
    sessionId: string,
    input: { handoff_id: string; require_claimed?: boolean },
    options: WcpWriteOptions,
    expectedIdentity?: SessionCommandIdentity,
    expectedCheckpointId?: string,
  ) {
    let command;
    try {
      if (
        !options ||
        typeof options !== 'object' ||
        Array.isArray(options) ||
        Object.keys(options).some((key) => key !== 'idempotency_key') ||
        this.context.expected_version !== undefined ||
        this.context.if_match !== undefined ||
        (this.context.idempotency_key !== undefined &&
          this.context.idempotency_key !== options.idempotency_key)
      )
        throw new TypeError('Resume uses its original request key without a version precondition');
      command = parseResumeCommand(input);
    } catch (error) {
      throw this.invalid(
        error instanceof Error ? error.message : 'Invalid original resume request',
      );
    }
    const binding = this.resumeBinding(
      sessionId,
      { ...command, request_key: options.idempotency_key },
      expectedIdentity,
      expectedCheckpointId,
    );
    const result = await this.envelope<unknown>(
      'POST',
      this.sessionPath(sessionId, 'resume'),
      command,
      {
        'idempotency-key': binding.query.request_key,
        'x-expected-actor-id': binding.identity.actor_id,
        'x-expected-client-id': binding.identity.client_id,
      },
    );
    try {
      return parseResumeEnvelope(result, binding, this.context.trace_id);
    } catch {
      throw this.invalidResponse();
    }
  }

  async getResumeReceipt(
    sessionId: string,
    input: ResumeReceiptQuery,
    expectedIdentity?: SessionCommandIdentity,
    expectedCheckpointId?: string,
  ) {
    const binding = this.resumeBinding(sessionId, input, expectedIdentity, expectedCheckpointId);
    const result = await this.envelope<unknown>(
      'POST',
      this.sessionPath(sessionId, 'resume/receipt'),
      binding.query,
      {
        'x-expected-actor-id': binding.identity.actor_id,
        'x-expected-client-id': binding.identity.client_id,
      },
    );
    try {
      return parseResumeReceiptEnvelope(result, binding, this.context.trace_id);
    } catch {
      throw this.invalidResponse();
    }
  }

  private resumeBinding(
    sessionId: string,
    input: unknown,
    expectedIdentity?: SessionCommandIdentity,
    expectedCheckpointId?: string,
  ): ResumeBinding {
    try {
      const binding = parseResumeBinding(
        sessionId,
        input,
        expectedIdentity ?? {
          tenant_id: this.context.tenant_id,
          workspace_id: this.context.workspace_id,
          project_id: this.context.project_id,
          actor_id: this.context.actor_id,
          client_id: this.context.client_id,
        },
        this.context,
        expectedCheckpointId,
      );
      if (
        (this.context.actor_id !== undefined &&
          this.context.actor_id !== binding.identity.actor_id) ||
        (this.context.client_id !== undefined &&
          this.context.client_id !== binding.identity.client_id)
      )
        throw new TypeError('The original resume identity differs from this client context');
      return binding;
    } catch (error) {
      throw this.invalid(
        error instanceof Error ? error.message : 'Supply the original resume identity',
      );
    }
  }

  async searchProject(input: ProjectSearchQuery) {
    let query;
    try {
      query = parseProjectSearchQuery(input);
    } catch (error) {
      throw this.invalid(error instanceof Error ? error.message : 'Invalid search query');
    }
    const result = await this.envelope<ProjectSearchPage>('POST', '/v1/search', { ...query });
    try {
      const data = parseProjectSearchPage(result.data, query);
      if (!this.matchesScope(data.scope)) throw this.invalidResponse();
      return { ...result, data };
    } catch {
      throw this.invalidResponse();
    }
  }

  async getLegacyContextIndexStatus(id: string) {
    let query;
    try {
      query = parseLegacyContextStatusQuery({ id });
    } catch (error) {
      throw this.invalid(error instanceof Error ? error.message : 'Invalid index ID');
    }
    const result = await this.envelope<LegacyContextStatus>(
      'GET',
      '/v1/context/index/' + this.segment(query.id),
    );
    try {
      const data = parseLegacyContextStatus(result.data, query.id);
      if (!this.matchesScope(data)) throw this.invalidResponse();
      return { ...result, data };
    } catch {
      throw this.invalidResponse();
    }
  }

  async listLegacyContextIndexes(input: LegacyContextListQuery = {}) {
    let query;
    try {
      query = parseLegacyContextListQuery(input);
    } catch (error) {
      throw this.invalid(error instanceof Error ? error.message : 'Invalid index filters');
    }
    const search = new URLSearchParams();
    for (const [field, value] of Object.entries(query)) search.set(field, String(value));
    const result = await this.envelope<LegacyContextListPage>('GET', '/v1/context/index?' + search);
    try {
      const data = parseLegacyContextListPage(result.data, query);
      if (!this.matchesScope(data.scope)) throw this.invalidResponse();
      return { ...result, data };
    } catch {
      throw this.invalidResponse();
    }
  }

  deleteLegacyContextIndex(input: LegacyContextMutation, options: WcpWriteOptions) {
    return this.mutateLegacyContextIndex('delete', input, options);
  }

  restoreLegacyContextIndex(input: LegacyContextMutation, options: WcpWriteOptions) {
    return this.mutateLegacyContextIndex('restore', input, options);
  }

  private async mutateLegacyContextIndex(
    operation: LegacyContextAction,
    input: LegacyContextMutation,
    options: WcpWriteOptions,
  ) {
    let mutation;
    try {
      mutation = parseLegacyContextMutation(input);
    } catch (error) {
      throw this.invalid(error instanceof Error ? error.message : 'Invalid index mutation');
    }
    const result = await this.command<LegacyContextMutationReceipt>(
      '/v1/context/index/' + this.segment(mutation.id) + '/' + operation,
      mutation,
      options,
    );
    try {
      const data = parseLegacyContextMutationReceipt(
        result.data,
        mutation,
        operation,
        options.idempotency_key,
      );
      if (!this.matchesScope(data.record)) throw this.invalidResponse();
      return { ...result, data };
    } catch {
      throw this.invalidResponse();
    }
  }

  /** Administrator-only processing metadata; does not replay or modify events. */
  getPlaneInboxSummary() {
    return this.planeInboxRead('/v1/plane/events/summary', parsePlaneInboxSummary);
  }

  /** Read a version comparison and visible candidates without scheduling processing. */
  async getPlaneInboxDiagnosis(eventId: string) {
    let query;
    try {
      query = parsePlaneInboxRecordQuery({ event_id: eventId });
    } catch (error) {
      throw this.invalid(error instanceof Error ? error.message : 'Invalid event ID');
    }
    return this.planeInboxRead(
      '/v1/plane/events/' + this.segment(query.event_id) + '/diagnosis',
      (data, scope) => parsePlaneInboxDiagnosis(data, scope, query.event_id),
    );
  }

  /** Administrator-only processing metadata; does not replay or modify events. */
  async listPlaneInboxEvents(input: PlaneInboxListQuery = {}) {
    let query;
    try {
      query = parsePlaneInboxListQuery(input);
    } catch (error) {
      throw this.invalid(error instanceof Error ? error.message : 'Invalid event queue query');
    }
    const search = new URLSearchParams();
    for (const [field, value] of Object.entries(query)) search.set(field, String(value));
    return this.planeInboxRead('/v1/plane/events?' + search, (data, scope) =>
      parsePlaneInboxPage(data, scope, query),
    );
  }

  async getPlaneInboxEvent(eventId: string) {
    let query;
    try {
      query = parsePlaneInboxRecordQuery({ event_id: eventId });
    } catch (error) {
      throw this.invalid(error instanceof Error ? error.message : 'Invalid event ID');
    }
    return this.planeInboxRead('/v1/plane/events/' + this.segment(query.event_id), (data, scope) =>
      parsePlaneInboxRecord(data, scope, query.event_id),
    );
  }

  /** A successful response records scheduling only, not application of the event. */
  retryPlaneInboxEvent(input: PlaneInboxRetryInput, options: WcpPlaneInboxRetryOptions) {
    return this.planeInboxRetryRequest(input, options, false);
  }

  /** Query the original request without scheduling it; not-observed does not prove failure. */
  getPlaneInboxRetryReceipt(input: PlaneInboxRetryInput, options: WcpPlaneInboxRetryOptions) {
    return this.planeInboxRetryRequest(input, options, true);
  }

  private planeInboxRetryRequest(
    input: PlaneInboxRetryInput,
    options: WcpPlaneInboxRetryOptions,
    lookup: false,
  ): Promise<WcpEnvelope<PlaneInboxRetryReceipt>>;
  private planeInboxRetryRequest(
    input: PlaneInboxRetryInput,
    options: WcpPlaneInboxRetryOptions,
    lookup: true,
  ): Promise<WcpEnvelope<PlaneInboxRetryLookup>>;
  private async planeInboxRetryRequest(
    input: PlaneInboxRetryInput,
    options: WcpPlaneInboxRetryOptions,
    lookup: boolean,
  ): Promise<WcpEnvelope<PlaneInboxRetryReceipt | PlaneInboxRetryLookup>> {
    let query: ReturnType<typeof parsePlaneInboxRetryQuery>;
    let identity: PlaneInboxIdentity;
    try {
      if (
        !options ||
        typeof options !== 'object' ||
        Array.isArray(options) ||
        Object.keys(options).some(
          (field) =>
            !['idempotency_key', 'expected_actor_id', 'expected_client_id'].includes(field),
        )
      )
        throw new TypeError('Supply the original key and expected actor/client identity only');
      query = parsePlaneInboxRetryQuery({
        ...parsePlaneInboxRetryInput(input),
        request_key: options.idempotency_key,
      });
      identity = parsePlaneInboxIdentity({
        tenant_id: this.context.tenant_id,
        workspace_id: this.context.workspace_id,
        project_id: this.context.project_id,
        actor_id: options.expected_actor_id,
        client_id: options.expected_client_id,
      });
    } catch (error) {
      throw this.invalid(error instanceof Error ? error.message : 'Invalid event retry request');
    }
    const { event_id, ...body } = query;
    const result = await this.envelope<unknown>(
      'POST',
      '/v1/plane/events/' + this.segment(event_id) + '/retry' + (lookup ? '/receipt' : ''),
      body,
      {
        'x-expected-actor-id': identity.actor_id,
        'x-expected-client-id': identity.client_id,
        ...(lookup ? {} : { 'idempotency-key': query.request_key }),
      },
    );
    try {
      if (result.trace_id !== this.context.trace_id || result.source_refs.length !== 0)
        throw new Error();
      const command = {
        event_id,
        expected_revision: query.expected_revision,
        reason: query.reason,
      };
      const data = lookup
        ? parsePlaneInboxRetryLookup(result.data, command, identity, query.request_key)
        : parsePlaneInboxRetryReceipt(result.data, command, identity, query.request_key);
      return { ...result, data };
    } catch {
      throw this.invalidResponse();
    }
  }

  private async planeInboxRead<T>(
    path: string,
    parse: (data: unknown, scope: ObservedScope) => T,
  ): Promise<WcpEnvelope<T>> {
    const project_id = this.context.project_id;
    if (!project_id) throw this.invalid('Event queue reads require project_id');
    const scope = {
      tenant_id: this.context.tenant_id,
      workspace_id: this.context.workspace_id,
      project_id,
    };
    const result = await this.envelope<unknown>('GET', path);
    try {
      if (result.trace_id !== this.context.trace_id || result.source_refs.length !== 0)
        throw this.invalidResponse();
      return { ...result, data: parse(result.data, scope) };
    } catch {
      throw this.invalidResponse();
    }
  }

  /** Page current saved Plane observation metadata, independently of local work items. */
  async listObservedWorkItems(input: ObservedWorkItemListQuery = {}) {
    const { scope } = this.observedQuery('project', {});
    let query;
    try {
      query = parseObservedWorkItemListQuery(input);
    } catch (error) {
      throw this.invalid(
        error instanceof Error ? error.message : 'Invalid observation directory query',
      );
    }
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) search.set(key, String(value));
    const result = await this.envelope<unknown>('GET', '/v1/plane/work-items?' + search);
    try {
      if (result.trace_id !== this.context.trace_id || result.source_refs.length !== 0)
        throw this.invalidResponse();
      return { ...result, data: parseObservedWorkItemPage(result.data, scope, query) };
    } catch {
      throw this.invalidResponse();
    }
  }

  /** Read a saved Plane observation; its version is not a local work item version. */
  async getObservedProjectState() {
    const { id, scope } = this.observedQuery('project', {});
    const result = await this.envelope<ObservedSnapshot>(
      'GET',
      '/v1/projects/' + this.segment(id) + '/state',
    );
    try {
      return this.observedResponse(
        result,
        parseObservedSnapshot(result.data, 'Project', id, scope),
      );
    } catch {
      throw this.invalidResponse();
    }
  }

  async getObservedWorkItemState(workItemId: string) {
    const { id, scope } = this.observedQuery('work-item', { work_item_id: workItemId });
    const result = await this.envelope<ObservedSnapshot>(
      'GET',
      '/v1/work-items/' + this.segment(id) + '/state',
    );
    try {
      return this.observedResponse(
        result,
        parseObservedSnapshot(result.data, 'WorkItem', id, scope),
      );
    } catch {
      throw this.invalidResponse();
    }
  }

  /** The legacy context_pack field contains search hits, not a saved context pack. */
  async getObservedWorkItemContext(workItemId: string) {
    const { id, scope } = this.observedQuery('context', { work_item_id: workItemId });
    const result = await this.envelope<ObservedWorkItemContext>(
      'GET',
      '/v1/work-items/' + this.segment(id) + '/context',
    );
    try {
      return this.observedResponse(
        result,
        parseObservedWorkItemContext(result.data, id, scope, result.trace_id),
      );
    } catch {
      throw this.invalidResponse();
    }
  }

  private observedQuery(kind: ObservedReadKind, input: Record<string, unknown>) {
    const project_id = this.context.project_id;
    if (!project_id) throw this.invalid('Observed reads require project_id');
    try {
      return {
        ...parseObservedReadInput(input, kind, project_id),
        scope: {
          tenant_id: this.context.tenant_id,
          workspace_id: this.context.workspace_id,
          project_id,
        },
      };
    } catch (error) {
      throw this.invalid(error instanceof Error ? error.message : 'Invalid observed read');
    }
  }

  private observedResponse<T extends ObservedSnapshot | ObservedWorkItemContext>(
    result: WcpEnvelope<T>,
    data: T,
  ): WcpEnvelope<T> {
    if (result.trace_id !== this.context.trace_id) throw this.invalidResponse();
    const source_refs = result.source_refs.map((ref) => ({
      type: ref.type,
      id: ref.id,
      ...(ref.revision === undefined ? {} : { revision: ref.revision }),
      ...(ref.uri === undefined ? {} : { uri: ref.uri }),
    }));
    const expected = 'work_item' in data ? data.context_pack.source_refs : data.source_refs;
    if (JSON.stringify(source_refs) !== JSON.stringify(expected)) throw this.invalidResponse();
    return { ...result, source_refs, data };
  }

  async getProjectOverview() {
    const result = await this.envelope<WorkbenchOverview>('POST', '/v1/workbench/query', {
      operation: 'overview',
    });
    try {
      return { ...result, data: parseWorkbenchOverview(result.data) };
    } catch {
      throw this.invalidResponse();
    }
  }

  async listWorkItemProjections(input: WorkItemListQuery = {}) {
    let query;
    try {
      query = parseWorkItemListQuery(input);
    } catch (error) {
      throw this.invalid(error instanceof Error ? error.message : 'Invalid work item query');
    }
    const result = await this.envelope<WorkItemProjection[]>('POST', '/v1/workbench/query', {
      operation: 'work_items',
      ...query,
    });
    try {
      return { ...result, ...parseWorkItemProjectionList(result, query) };
    } catch {
      throw this.invalidResponse();
    }
  }

  async getWorkItemProjection(itemId: string) {
    let query;
    try {
      query = parseWorkItemProjectionQuery({ item_id: itemId });
    } catch (error) {
      throw this.invalid(error instanceof Error ? error.message : 'Invalid work item query');
    }
    const result = await this.envelope<WorkItemProjection>('POST', '/v1/workbench/query', {
      operation: 'work_item',
      ...query,
    });
    try {
      return { ...result, data: parseWorkItemProjection(result.data, itemId) };
    } catch {
      throw this.invalidResponse();
    }
  }

  listSessions(query: SessionRegistryQuery = {}, options: WcpSessionRegistryOptions = {}) {
    return readSessionRegistry(this.transport, this.context, query, options);
  }

  async getSessionState(sessionId: string) {
    let query;
    try {
      query = parseSessionStateQuery({ session_id: sessionId });
    } catch (error) {
      throw this.invalid(error instanceof Error ? error.message : 'Invalid session ID');
    }
    const result = await this.envelope<unknown>(
      'GET',
      '/v1/sessions/' + this.segment(query.session_id),
    );
    try {
      return parseSessionStateEnvelope(
        result,
        query.session_id,
        this.context,
        this.context.trace_id,
      );
    } catch {
      throw this.invalidResponse();
    }
  }

  /** Read the current writer and upload limits; this never reserves or submits an upload. */
  getArtifactUploadContext(options: WcpArtifactUploadContextOptions = {}) {
    return readArtifactUploadContext(this.transport, this.context, options);
  }

  async getArtifact(artifactId: string) {
    return this.readArtifactMetadata({ artifact_id: artifactId });
  }

  /** Save the original identity/command before calling; uncertain outcomes use getArtifactReceipt. */
  async createArtifact(input: ArtifactReceiptQuery, content: Uint8Array) {
    return this.uploadArtifact('artifact.create', input, content);
  }

  /** Append using the original expected_version and key; never substitutes a newer version. */
  async putArtifactVersion(input: ArtifactReceiptQuery, content: Uint8Array) {
    return this.uploadArtifact('artifact.put-version', input, content);
  }

  private async uploadArtifact(
    operation: ArtifactReceiptQuery['command']['operation'],
    input: ArtifactReceiptQuery,
    content: Uint8Array,
  ) {
    const context = { ...this.context };
    let query;
    try {
      query = parseArtifactReceiptQuery(input);
      assertArtifactReceiptIdentity(query.identity, context);
      if (
        query.command.operation !== operation ||
        !(content instanceof Uint8Array) ||
        content.byteLength !== query.command.size ||
        content.byteLength > ARTIFACT_UPLOAD_MAX_BYTES
      )
        throw new TypeError();
    } catch {
      throw this.invalid('Supply the original matching artifact request and exact file bytes');
    }
    const metadata = new Blob([JSON.stringify(query)], { type: 'application/json' });
    if (metadata.size > ARTIFACT_UPLOAD_REQUEST_BYTES)
      throw this.invalid('Original artifact request exceeds the upload metadata limit');
    // Capture bytes and normalized metadata before transport credentials can yield control.
    const snapshot = new Uint8Array(content);
    const form = new FormData();
    form.append('request', metadata, 'request.json');
    form.append(
      'content',
      new Blob([snapshot.buffer], { type: 'application/octet-stream' }),
      'content.bin',
    );
    const headers: Record<string, string> = {
      'idempotency-key': query.command.request_key,
      'x-expected-actor-id': query.identity.actor_id,
      'x-expected-client-id': query.identity.client_id,
    };
    let path = '/v1/artifacts';
    if (query.command.operation === 'artifact.put-version') {
      headers['if-match'] = buildEtag(query.command.expected_version);
      path += '/' + this.segment(query.command.artifact_id) + '/versions';
    }
    const result = await this.envelope<unknown>('POST', path, form, headers);
    try {
      return parseArtifactUploadEnvelope(result, query, context.trace_id);
    } catch {
      throw this.invalidResponse();
    }
  }

  /** Read the original write receipt. Absence never proves failure or authorizes a new request. */
  async getArtifactReceipt(input: ArtifactReceiptQuery) {
    const context = { ...this.context };
    let query;
    try {
      query = parseArtifactReceiptQuery(input);
      assertArtifactReceiptIdentity(query.identity, context);
    } catch {
      throw this.invalid(
        'Supply the original artifact command and matching account, client and project',
      );
    }
    const result = await this.envelope<unknown>(
      'POST',
      '/v1/artifacts/receipt',
      parseArtifactReceiptQuery(query),
      {
        'x-expected-actor-id': query.identity.actor_id,
        'x-expected-client-id': query.identity.client_id,
      },
    );
    try {
      return parseArtifactReceiptEnvelope(result, query, context.trace_id);
    } catch {
      throw this.invalidResponse();
    }
  }

  async getArtifactVersion(artifactId: string, version: number) {
    if (!Number.isSafeInteger(version) || version < 1)
      throw this.invalid('Supply a positive artifact version');
    return this.readArtifactMetadata({ artifact_id: artifactId, version });
  }

  /** Download one immutable version after metadata lookup; release audit does not prove client delivery. */
  async downloadArtifactVersion(
    artifactId: string,
    version: number,
    options: { max_bytes?: number } = {},
  ) {
    const context = { ...this.context };
    if (!context.project_id || !context.actor_id || !context.client_id)
      throw this.invalid('Artifact downloads require a fixed project, account and client identity');
    if (
      !options ||
      typeof options !== 'object' ||
      Array.isArray(options) ||
      Object.keys(options).some((key) => key !== 'max_bytes')
    )
      throw this.invalid('Supply only max_bytes for an artifact download');
    const limit = options.max_bytes ?? ARTIFACT_DOWNLOAD_DEFAULT_BYTES;
    if (!Number.isSafeInteger(limit) || limit < 0 || limit > ARTIFACT_DOWNLOAD_MAX_BYTES)
      throw this.invalid('Invalid artifact download byte limit');
    if (typeof globalThis.crypto?.subtle?.digest !== 'function')
      throw new ContractError(
        'ARTIFACT_INTEGRITY_UNAVAILABLE',
        'SHA-256 verification is unavailable',
        { trace_id: context.trace_id },
      );
    const metadata = await this.getArtifactVersion(artifactId, version);
    const artifact = metadata.data.artifact;
    if (artifact.size > limit)
      throw new ContractError('ARTIFACT_TOO_LARGE', 'Artifact exceeds this download byte limit', {
        trace_id: context.trace_id,
      });
    const response = await this.transport.request<WcpBinaryResponse>({
      method: 'GET',
      path:
        '/v1/artifacts/' +
        this.segment(artifact.artifact_id) +
        '/versions/' +
        artifact.version +
        '/content',
      headers: {
        'x-trace-id': context.trace_id,
        'x-tenant-id': context.tenant_id,
        'x-workspace-id': context.workspace_id,
        'x-project-id': context.project_id,
        'x-expected-actor-id': context.actor_id,
        'x-expected-client-id': context.client_id,
        'x-expected-artifact-sha256': artifact.sha256,
        'x-expected-artifact-size': String(artifact.size),
      },
      response_type: 'bytes',
      max_response_bytes: artifact.size,
    });
    let bytes: Uint8Array;
    let auditId: string;
    try {
      if (
        !response ||
        typeof response !== 'object' ||
        Array.isArray(response) ||
        response.status !== 200 ||
        Object.keys(response).some((key) => !['status', 'headers', 'content'].includes(key)) ||
        !response.headers ||
        typeof response.headers !== 'object' ||
        Array.isArray(response.headers) ||
        !(response.content instanceof Uint8Array) ||
        response.content.byteLength !== artifact.size
      )
        throw new TypeError();
      auditId = parseArtifactDownloadHeaders(
        { ...response.headers },
        artifact,
        context.trace_id,
      ).audit_id;
      bytes = new Uint8Array(response.content);
      const hash = new Uint8Array(
        await globalThis.crypto.subtle.digest('SHA-256', bytes.buffer as ArrayBuffer),
      );
      if (
        Array.from(hash, (byte) => byte.toString(16).padStart(2, '0')).join('') !== artifact.sha256
      )
        throw new TypeError();
    } catch {
      throw this.invalidResponse();
    }
    return {
      schema_version: 1 as const,
      trace_id: context.trace_id,
      source_refs: [{ type: 'artifact', id: artifact.artifact_id, revision: artifact.version }],
      data: {
        artifact,
        audit_id: auditId,
        audit_state: 'release-recorded' as const,
        content_state: 'verified' as const,
      },
      content: bytes,
    };
  }

  private async readArtifactMetadata(input: { artifact_id: string; version?: number }) {
    const context = { ...this.context };
    let query;
    try {
      query = parseArtifactReadQuery(input);
    } catch {
      throw this.invalid('Supply an artifact ULID and a positive version when reading history');
    }
    const path =
      '/v1/artifacts/' +
      this.segment(query.artifact_id) +
      (query.version === undefined ? '' : '/versions/' + query.version);
    const result = await this.envelope<unknown>('GET', path);
    try {
      return parseArtifactReadEnvelope(result, query, context, context.trace_id);
    } catch {
      throw this.invalidResponse();
    }
  }

  async getSessionRun(sessionId: string, runId: string) {
    const result = await this.envelope<SessionRunDetail>(
      'GET',
      this.sessionPath(sessionId, 'runs') + '/' + this.segment(runId),
    );
    try {
      return { ...result, data: parseSessionRunDetail(result.data, sessionId, runId) };
    } catch {
      throw this.invalidResponse();
    }
  }

  async listSessionRuns(sessionId: string, input: SessionRunQuery = {}) {
    let query;
    try {
      query = parseSessionRunQuery(input);
    } catch (error) {
      throw this.invalid(error instanceof Error ? error.message : 'Invalid run query');
    }
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) search.set(key, String(value));
    const result = await this.envelope<SessionRunPage>(
      'GET',
      this.sessionPath(sessionId, 'runs') + '?' + search,
    );
    try {
      return { ...result, data: parseSessionRunPage(result.data, sessionId, query) };
    } catch {
      throw this.invalidResponse();
    }
  }

  async getSessionToolCall(sessionId: string, toolCallId: string) {
    const result = await this.envelope<SessionToolCallDetail>(
      'GET',
      this.sessionPath(sessionId, 'tool-calls') + '/' + this.segment(toolCallId),
    );
    try {
      return { ...result, data: parseSessionToolCallDetail(result.data, sessionId, toolCallId) };
    } catch {
      throw this.invalidResponse();
    }
  }

  async listSessionToolCalls(sessionId: string, input: SessionToolCallQuery = {}) {
    let query;
    try {
      query = parseSessionToolCallQuery(input);
    } catch (error) {
      throw this.invalid(error instanceof Error ? error.message : 'Invalid tool call query');
    }
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) search.set(key, String(value));
    const result = await this.envelope<SessionToolCallPage>(
      'GET',
      this.sessionPath(sessionId, 'tool-calls') + '?' + search,
    );
    try {
      return { ...result, data: parseSessionToolCallPage(result.data, sessionId, query) };
    } catch {
      throw this.invalidResponse();
    }
  }

  async getHandoff(handoffId: string) {
    try {
      parseHandoffReadQuery({ handoff_id: handoffId });
    } catch (error) {
      throw this.invalid(error instanceof Error ? error.message : 'Invalid handoff query');
    }
    const result = await this.envelope<unknown>('GET', '/v1/handoffs/' + this.segment(handoffId));
    try {
      return parseHandoffReadEnvelope(result, handoffId, this.context, this.context.trace_id);
    } catch {
      throw this.invalidResponse();
    }
  }

  listHandoffs(query: HandoffRegistryQuery = {}, options: WcpHandoffRegistryOptions = {}) {
    return readHandoffRegistry(this.transport, this.context, query, options);
  }
  getSessionCommandContext(options: WcpSessionCommandContextOptions = {}) {
    return readSessionCommandContext(this.transport, this.context, options);
  }
  getConflictCommandContext(options: WcpConflictCommandContextOptions = {}) {
    return readConflictCommandContext(this.transport, this.context, options);
  }

  getSessionCheckpoint(
    sessionId: string,
    checkpointId: string,
    options: WcpCheckpointReadOptions = {},
  ) {
    return readCheckpointDetail(
      this.transport,
      this.context,
      { session_id: sessionId, checkpoint_id: checkpointId },
      options,
    );
  }

  listCheckpointRegistry(
    query: CheckpointRegistryQuery = {},
    options: WcpCheckpointRegistryOptions = {},
  ) {
    return readCheckpointRegistry(this.transport, this.context, query, options);
  }

  listCheckpoints(
    input: CheckpointRegistryQuery & { session_id?: string; before_revision?: number } = {},
    options: WcpCheckpointReadOptions = {},
  ) {
    if (!input || typeof input !== 'object' || Array.isArray(input))
      throw this.invalid('Supply a checkpoint directory query or a session history query');
    if (input.session_id === undefined) return this.listCheckpointRegistry(input, options);
    return readWorkbenchCheckpointHistory(this.transport, this.context, input, options);
  }

  async listSessionCheckpoints(
    sessionId: string,
    input: { before_revision?: number } = {},
    options: WcpCheckpointReadOptions = {},
  ) {
    if (
      !input ||
      typeof input !== 'object' ||
      Array.isArray(input) ||
      Object.keys(input).some((key) => key !== 'before_revision')
    )
      throw this.invalid('Supply only before_revision');
    return readCheckpointHistory(
      this.transport,
      this.context,
      { session_id: sessionId, ...input },
      options,
    );
  }

  uploadEvents(events: SyncUploadEvent[], options: WcpSyncUploadOptions) {
    return uploadSyncEvents(this.transport, this.context, events, options);
  }

  /** Read the verified sender before preparing a new offline original; does not bind old rows. */
  getSyncCommandContext(options: WcpSyncCommandContextOptions = {}) {
    return readSyncCommandContext(this.transport, this.context, options);
  }

  /** Read the original event's durable delivery; never uploads, acknowledges or repairs local rows. */
  getSyncEventReceipt(input: SyncEventReceiptQuery, options: WcpSyncEventReceiptOptions = {}) {
    return readSyncEventReceipt(this.transport, this.context, input, options);
  }

  getSyncChanges(input: SyncChangesQuery = {}, options: WcpSyncChangesOptions = {}) {
    return readSyncChanges(this.transport, this.context, input, options);
  }

  /** Reading does not acknowledge: persist/process a page before calling acknowledgeSync. */
  syncPages(input: SyncChangesQuery = {}, options: WcpSyncChangesOptions = {}) {
    return iterateSyncChanges(this.transport, this.context, input, options);
  }

  /** Current state only; use the saved identity after an uncertain acknowledgement. */
  getSyncCursor(options: WcpSyncCursorOptions = {}) {
    return readSyncCursor(this.transport, this.context, options);
  }

  acknowledgeSync(cursor: number, options: WcpSyncAckOptions) {
    return acknowledgeSync(this.transport, this.context, cursor, options);
  }

  listConflicts(query: ConflictRegistryQuery = {}, options: WcpConflictRegistryOptions = {}) {
    return readConflictRegistry(this.transport, this.context, query, options);
  }

  getConflict(conflictId: string, options: WcpConflictReadOptions = {}) {
    return readConflict(this.transport, this.context, conflictId, options);
  }

  getConflictReceipt(input: ConflictReceiptQuery, options: WcpConflictReceiptOptions = {}) {
    return readConflictReceipt(this.transport, this.context, input, options);
  }
  submitConflictDecision(input: ConflictReceiptQuery, options: WcpConflictSubmissionOptions) {
    return submitConflictDecision(this.transport, this.context, input, options);
  }

  resolveConflict(
    conflictId: string,
    decision: WcpConflictDecision,
    options: WcpVersionedWriteOptions,
  ) {
    if (
      !['local', 'server', 'merge'].includes(decision.resolution) ||
      (decision.resolution === 'merge') !== Object.hasOwn(decision, 'merged_value') ||
      (decision.resolution === 'merge' && decision.merged_value === undefined)
    )
      throw this.invalid('Supply merged_value only for a merge decision');
    return this.command<WcpConflictResolution>(
      '/v1/conflicts/' + this.segment(conflictId) + '/resolve',
      decision,
      options,
      true,
    );
  }

  private command<T>(path: string, body: object, options: WcpWriteOptions, versioned = false) {
    const headers: Record<string, string> = {};
    try {
      headers['idempotency-key'] = validateIdempotencyKey(options?.idempotency_key);
    } catch {
      throw this.invalid('Supply an idempotency_key and reuse it when retrying this command');
    }
    if (versioned) {
      const version = (options as WcpVersionedWriteOptions).expected_version;
      if (!Number.isSafeInteger(version) || version < 1)
        throw this.invalid('expected_version must be a positive integer');
      headers['if-match'] = buildEtag(version);
    }
    return this.envelope<T>('POST', path, body, headers);
  }

  private async envelope<T>(
    method: WcpRequest['method'],
    path: string,
    body?: object,
    headers: Record<string, string> = {},
  ) {
    if (!this.context.project_id) throw this.invalid('This operation requires project_id');
    const result = await this.transport.request<unknown>({
      method,
      path,
      headers: {
        'x-trace-id': this.context.trace_id,
        'x-tenant-id': this.context.tenant_id,
        'x-workspace-id': this.context.workspace_id,
        'x-project-id': this.context.project_id,
        ...headers,
      },
      ...(body === undefined ? {} : { body }),
    });
    if (!result || typeof result !== 'object' || Array.isArray(result))
      throw this.invalidResponse();
    const record = result as Record<string, unknown>;
    if (
      record.schema_version !== 1 ||
      typeof record.trace_id !== 'string' ||
      !record.trace_id.trim() ||
      !Array.isArray(record.source_refs) ||
      !Object.hasOwn(record, 'data')
    )
      throw this.invalidResponse();
    try {
      record.source_refs.forEach(validateSourceRef);
      if (
        record.next_cursor !== undefined &&
        (typeof record.next_cursor !== 'string' ||
          !/^[A-Za-z0-9_-]{1,2048}$/.test(record.next_cursor))
      )
        throw new TypeError();
      for (const field of ['revision', 'server_cursor', 'next_before_revision']) {
        const value = record[field];
        if (
          value !== undefined &&
          (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0)
        )
          throw new TypeError();
      }
      if (record.etag !== undefined) {
        const version = parseEtag(record.etag);
        if (record.revision !== undefined && version !== record.revision) throw new TypeError();
      }
    } catch {
      throw this.invalidResponse();
    }
    if (record.data && typeof record.data === 'object' && !Array.isArray(record.data)) {
      const data = record.data as Record<string, unknown>;
      for (const field of ['tenant_id', 'workspace_id', 'project_id'] as const)
        if (data[field] !== undefined && data[field] !== this.context[field])
          throw this.invalidResponse();
    }
    return result as WcpEnvelope<T>;
  }

  private sessionPath(id: string, action: string) {
    return '/v1/sessions/' + this.segment(id) + '/' + action;
  }

  private matchesScope(data: { tenant_id: string; workspace_id: string; project_id: string }) {
    return (
      data.tenant_id === this.context.tenant_id &&
      data.workspace_id === this.context.workspace_id &&
      data.project_id === this.context.project_id
    );
  }

  private segment(value: string) {
    if (!isSyncIdentifier(value) || value === '.' || value === '..')
      throw this.invalid('Invalid resource identifier');
    return encodeURIComponent(value);
  }

  private invalid(message: string) {
    return new ContractError('INVALID_INPUT', message, { trace_id: this.context.trace_id });
  }

  private invalidResponse() {
    return new ContractError(
      'GATEWAY_RESPONSE_INVALID',
      'Gateway returned an invalid WCP response',
      { trace_id: this.context.trace_id },
    );
  }

  async createProject(project: ProjectEntity): Promise<ProjectEntity> {
    const validation = validateEntity('Project', project);
    if (!validation.valid) {
      throw new ContractError(validation.error.code, validation.error.message, {
        ...validation.error.details,
        trace_id: validation.error.trace_id,
        retryable: validation.error.retryable,
      });
    }
    const idempotencyKey = this.context.idempotency_key ?? project.external_id;
    const response = await this.transport.request<ProjectEntity>({
      method: 'POST',
      path: '/v1/projects',
      headers: {
        traceparent: this.context.trace_id,
        'x-trace-id': this.context.trace_id,
        'idempotency-key': idempotencyKey,
        'x-tenant-id': this.context.tenant_id,
        'x-workspace-id': this.context.workspace_id,
        ...(this.context.project_id === undefined
          ? {}
          : { 'x-project-id': this.context.project_id }),
      },
      body: project,
    });
    const responseValidation = validateEntity('Project', response);
    if (!responseValidation.valid) {
      throw new ContractError(responseValidation.error.code, responseValidation.error.message, {
        ...responseValidation.error.details,
        trace_id: responseValidation.error.trace_id,
        retryable: responseValidation.error.retryable,
      });
    }
    return response as ProjectEntity;
  }
}
