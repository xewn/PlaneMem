import { readWorkbenchAuditResponse } from './audit-response';
import { readWorkbenchJsonResponse } from './workbench-response';
import { readConflictResponse } from './conflict-read-response';
import {
  buildEtag,
  ContractError,
  parseConflictReadQuery,
  parseConflictReadEnvelope,
  type ConflictReadRecord,
  parseConflictRegistryQuery,
  parseConflictRegistryEnvelope,
  CONFLICT_REGISTRY_RESPONSE_BYTES,
  parseConflictReceiptQuery,
  parseConflictReceiptEnvelope,
  CONFLICT_RECEIPT_RESPONSE_BYTES,
  parseConflictCommandContextEnvelope,
  CONFLICT_COMMAND_CONTEXT_BYTES,
  type ConflictCommandContextData,
  type ConflictCommandIdentity,
  parseConflictSubmissionResponse,
  type ConflictSubmissionView,
  type ConflictReceiptView,
  parseWorkbenchAdminEnvelope,
  WORKBENCH_ADMIN_RESPONSE_BYTES,
  parseWorkbenchAuditQuery,
  parseWorkbenchAuditEnvelope,
  parseArtifactReadQuery,
  parseArtifactReadEnvelope,
  type ArtifactReadDetail,
  parseArtifactReceiptQuery,
  parseArtifactReceiptEnvelope,
  type ArtifactReceiptView,
  parseCheckpointHistoryQuery,
  parseCheckpointHistoryWorkbenchEnvelope,
  CHECKPOINT_DETAIL_RESPONSE_BYTES,
  CHECKPOINT_HISTORY_RESPONSE_BYTES,
  CHECKPOINT_READ_ERROR_BYTES,
  validateErrorEnvelope,
  parseLegacyContextListQuery,
  parseLegacyContextListPage,
  parseLegacyContextStatusQuery,
  parseLegacyContextStatus,
  parseLegacyContextIdentity,
  parseLegacyContextMutation,
  parseLegacyContextMutationReceipt,
  type LegacyContextListQuery,
  type LegacyContextListPage,
  type LegacyContextStatus,
  type LegacyContextIdentity,
  type LegacyContextAction,
  type LegacyContextMutation,
  type LegacyContextMutationReceipt,
  parseWorkItemProjection,
  parseWorkItemProjectionQuery,
  parseWorkItemListQuery,
  parseWorkItemProjectionList,
  parseSessionRegistryQuery,
  parseSessionRegistryEnvelope,
  SESSION_REGISTRY_RESPONSE_BYTES,
  parseHandoffRegistryQuery,
  parseHandoffRegistryEnvelope,
  HANDOFF_REGISTRY_RESPONSE_BYTES,
  parseCheckpointRegistryQuery,
  parseCheckpointRegistryEnvelope,
  CHECKPOINT_REGISTRY_RESPONSE_BYTES,
  parseSessionCommandContextEnvelope,
  SESSION_COMMAND_CONTEXT_BYTES,
  type SessionCommandContextData,
  type WorkItemListQuery,
  type WorkItemProjection,
  parseWorkbenchOverview,
  type WorkbenchOverview,
  parseProjectSearchQuery,
  parseProjectSearchPage,
  type ProjectSearchQuery,
  type ProjectSearchPage,
  parseObservedReadInput,
  parseObservedRecordId,
  parseObservedSnapshot,
  parseObservedWorkItemListQuery,
  parseObservedWorkItemPage,
  type ObservedWorkItemListQuery,
  type ObservedWorkItemPage,
  parseObservedWorkItemContext,
  validateSourceRef,
  type ObservedReadKind,
  type ObservedScope,
  type ObservedSnapshot,
  type ObservedWorkItemContext,
  parsePlaneInboxListQuery,
  parsePlaneInboxRecordQuery,
  parsePlaneInboxRecord,
  parsePlaneInboxPage,
  type PlaneInboxListQuery,
  parsePlaneInboxSummary,
  parsePlaneInboxDiagnosis,
  parsePlaneInboxIdentity,
  parsePlaneInboxRetryQuery,
  parsePlaneInboxRetryInput,
  parsePlaneInboxRetryReceipt,
  parsePlaneInboxRetryLookup,
  type PlaneInboxIdentity,
  type PlaneInboxRecord,
  type PlaneInboxRetryInput,
  type PlaneInboxRetryReceipt,
  type PlaneInboxRetryLookup,
} from '@planemem/contracts';
import {
  parseSessionRunQuery,
  parseSessionToolCallQuery,
  parseSessionRunPage,
  parseSessionRunDetail,
  parseSessionToolCallPage,
  parseSessionToolCallDetail,
  parseSessionCommandIdentity,
  parseSessionCommandBinding,
  parseSessionCommandReceiptEnvelope,
  parseSessionFinishCommand,
  parseSessionFinishEnvelope,
  type SessionFinishOperation,
  type SessionFinishedRecord,
  type SessionCommandIdentity,
  parseSessionStateQuery,
  parseSessionStateEnvelope,
  parseCheckpointBinding,
  parseCheckpointReadQuery,
  parseCheckpointReadEnvelope,
  parseHandoffReadQuery,
  parseHandoffReadEnvelope,
  type HandoffReadDetail,
  type CheckpointReadDetail,
  parseCheckpointSaveCommand,
  parseCheckpointSaveEnvelope,
  parseCheckpointReceiptEnvelope,
  type CheckpointSavedRecord,
  parseResumeBinding,
  isUlid,
  parseResumeEnvelope,
  parseResumeReceiptEnvelope,
  type ResumeResult,
  type SessionClosureState,
  type SessionRunQuery,
  type SessionToolCallQuery,
  type SessionRunPage,
  type SessionRunDetail,
  type SessionToolCallPage,
  type SessionToolCallDetail,
} from '@planemem/contracts';
import type { CheckpointReceiptLookup } from '@planemem/contracts';
import type { SessionCommandReceiptLookup, SessionCommandReceiptQuery } from '@planemem/contracts';
import type { ResumeReceiptLookup } from '@planemem/contracts';
import type { HandoffClaimRecorded, HandoffClaimReceiptLookup } from '@planemem/contracts';
import {
  parseHandoffCreateBinding,
  parseSessionStartBinding,
  parseSessionStartEnvelope,
  type SessionStartCommand,
  type SessionStartReceiptLookup,
  parseHandoffCreateEnvelope,
  type HandoffCreateReceiptLookup,
} from '@planemem/contracts';
import type { ContextPackReceipt } from '@planemem/contracts';
import type {
  CreateContextItemRequest,
  UpdateContextItemRequest,
  ContextItemMutationReceipt,
  ContextItemReadDocument,
  ArchivedContextItemDocument,
  ContextItemHistoryPage,
  ContextItemRevision,
  ProposalPage,
  ProposalDetail,
  ProposalListQuery,
  ProposalMutationReceipt,
  CreateProposalRequest,
} from '@planemem/contracts';
import { decodeJwtClaims, getSession, type SessionClaims } from './auth';
import { runtimeConfig } from './config';
import {
  activityCreateQuery,
  parseActivityCreateRequest,
  parseActivityCreateResponse,
  type ActivityCreateRequest,
  type ActivityCreateReceipt,
} from './activity-create';

export type WorkbenchOperation =
  | 'overview'
  | 'work_items'
  | 'work_item'
  | 'context'
  | 'sessions'
  | 'session'
  | 'handoffs'
  | 'checkpoints'
  | 'conflicts'
  | 'audit'
  | 'admin';

export interface WorkbenchResponse<T> {
  schema_version: 1;
  data: T;
  trace_id: string;
  source_refs: Array<{ type: string; id: string }>;
  handoff_permissions?: { write_sessions: boolean; claim: boolean };
  session_permissions?: { write_sessions: boolean };
  session_identity?: SessionCommandIdentity;
  conflict_permissions?: { resolve: boolean };
  context_permissions?: {
    compile: boolean;
    write: boolean;
    restricted: boolean;
    propose?: boolean;
  };
  index_permissions?: { write: boolean };
  index_identity?: LegacyContextIdentity;
  plane_inbox_identity?: PlaneInboxIdentity;
  plane_inbox_permissions?: { retry: boolean };
  next_before_revision?: number;
  next_cursor?: string;
  has_more?: boolean;
  scope?: { tenant_id: string; workspace_id: string; project_id: string };
}

export class AuthRequiredError extends Error {
  constructor() {
    super('AUTH_REQUIRED');
    this.name = 'AuthRequiredError';
  }
}

export class WorkbenchApiError extends Error {
  readonly trace_id?: string;
  readonly status?: number;
  readonly code?: string;

  constructor(message: string, trace_id?: string, status?: number, code?: string) {
    super(message);
    this.name = 'WorkbenchApiError';
    this.trace_id = trace_id;
    this.status = status;
    this.code = code;
  }
}

function scopeFromSession(session: SessionClaims) {
  const access = decodeJwtClaims(session.access_token);
  return {
    tenant_id: access.tenant_id ?? session.tenant_id ?? runtimeConfig.tenantId,
    workspace_id: access.workspace_id ?? session.workspace_id ?? runtimeConfig.workspaceId,
    project_id: access.project_id ?? session.project_id ?? runtimeConfig.projectId,
  };
}

/** A transfer proxy uses one session snapshot for scope checks and all its upstream requests. */
export async function getWorkbenchArtifactTransferSession() {
  const session = await getSession();
  if (
    !session ||
    !session.access_token.trim() ||
    !Number.isSafeInteger(session.expires_at) ||
    session.expires_at <= Math.floor(Date.now() / 1000)
  )
    throw new AuthRequiredError();
  const scope = scopeFromSession(session);
  return {
    access_token: session.access_token,
    scope: { ...scope },
    expires_at: session.expires_at,
  };
}

export const getWorkbenchArtifactDownloadSession = getWorkbenchArtifactTransferSession;

export async function queryWorkbench<T>(
  operation: WorkbenchOperation,
  input: Record<string, unknown> = {},
): Promise<WorkbenchResponse<T>> {
  if (operation === 'admin') {
    if (Object.keys(input).length) throw new TypeError('Administration accepts no query fields.');
    return gatewayRequest<T>(
      '/v1/workbench/query',
      { operation },
      undefined,
      'POST',
      undefined,
      (result, scope, trace) => {
        try {
          const response = parseWorkbenchAdminEnvelope(result, scope, trace);
          return { ...response, data: response.data as unknown as T };
        } catch {
          throw new WorkbenchApiError(
            'Administration snapshot did not match this request.',
            trace,
            502,
            'GATEWAY_RESPONSE_INVALID',
          );
        }
      },
    );
  }
  if (operation === 'audit') {
    const query = parseWorkbenchAuditQuery(input);
    return gatewayRequest<T>(
      '/v1/workbench/query',
      { ...query, operation },
      undefined,
      'POST',
      undefined,
      (result, scope, trace) => {
        try {
          const response = parseWorkbenchAuditEnvelope(result, query, scope, trace);
          return { ...response, data: response.data as unknown as T };
        } catch {
          throw new WorkbenchApiError(
            'Audit records did not match this request.',
            trace,
            502,
            'GATEWAY_RESPONSE_INVALID',
          );
        }
      },
    );
  }
  if (operation === 'conflicts') {
    const query = parseConflictRegistryQuery(input);
    return gatewayRequest<T>(
      '/v1/workbench/query',
      { operation, ...query },
      undefined,
      'POST',
      undefined,
      (result, scope, trace) => {
        try {
          const page = parseConflictRegistryEnvelope(result, query, scope, trace);
          return { ...page, data: page.data as unknown as T };
        } catch {
          throw new WorkbenchApiError(
            'Conflict directory did not match the requested page.',
            trace,
            502,
            'GATEWAY_RESPONSE_INVALID',
          );
        }
      },
    );
  }
  if (operation === 'sessions') {
    const query = parseSessionRegistryQuery(input);
    return gatewayRequest<T>(
      '/v1/workbench/query',
      { operation, ...query },
      undefined,
      'POST',
      undefined,
      (result, scope, trace) => {
        try {
          const response = parseSessionRegistryEnvelope(result, query, scope, trace);
          return { ...response, data: response.data as unknown as T };
        } catch {
          throw new WorkbenchApiError(
            'Session registry did not match the requested page.',
            trace,
            502,
            'GATEWAY_RESPONSE_INVALID',
          );
        }
      },
    );
  }
  if (operation === 'handoffs') {
    const query = parseHandoffRegistryQuery(input);
    return gatewayRequest<T>(
      '/v1/workbench/query',
      { ...query, operation },
      undefined,
      'POST',
      undefined,
      (result, scope, trace) => {
        try {
          const page = parseHandoffRegistryEnvelope(result, query, scope, trace);
          return { ...page, data: page.data as unknown as T };
        } catch {
          throw new WorkbenchApiError(
            'Handoff registry did not match the requested page.',
            trace,
            502,
            'GATEWAY_RESPONSE_INVALID',
          );
        }
      },
    );
  }
  if (operation === 'checkpoints' && input.session_id === undefined) {
    const query = parseCheckpointRegistryQuery(input);
    return gatewayRequest<T>(
      '/v1/workbench/query',
      { ...query, operation },
      undefined,
      'POST',
      undefined,
      (result, scope, trace) => {
        try {
          const page = parseCheckpointRegistryEnvelope(result, query, scope, trace);
          return { ...page, data: page.data as unknown as T };
        } catch {
          throw new WorkbenchApiError(
            'Checkpoint registry did not match the requested page.',
            trace,
            502,
            'GATEWAY_RESPONSE_INVALID',
          );
        }
      },
    );
  }
  return gatewayPost('/v1/workbench/query', { ...input, operation });
}

export function getWorkbenchSessionState(sessionId: string, identity?: SessionCommandIdentity) {
  parseSessionStateQuery({ session_id: sessionId });
  return gatewayRequest<SessionClosureState>(
    '/v1/sessions/' + encodeURIComponent(sessionId),
    {},
    undefined,
    'GET',
    identity,
    (result, scope, trace) =>
      sessionDetailResponse(
        result,
        scope,
        trace,
        () => parseSessionStateEnvelope(result, sessionId, scope, trace, identity).data,
        identity,
      ),
  );
}

export function getWorkbenchSessionCommandContext() {
  return gatewayRequest<SessionCommandContextData>(
    '/v1/sessions/command-context',
    {},
    undefined,
    'GET',
    undefined,
    (result, scope, trace) => {
      try {
        const page = parseSessionCommandContextEnvelope(result, scope, trace);
        if (Date.parse(page.data.expires_at) <= Date.now()) throw new TypeError();
        return page;
      } catch {
        throw new WorkbenchApiError(
          'The verified caller context was invalid or expired. Sign in again before recovery.',
          trace,
          502,
          'GATEWAY_RESPONSE_INVALID',
        );
      }
    },
  );
}

export function getWorkbenchArtifact(artifactId: string, version?: number) {
  const query = parseArtifactReadQuery({
    artifact_id: artifactId,
    ...(version === undefined ? {} : { version }),
  });
  const path =
    '/v1/artifacts/' +
    encodeURIComponent(query.artifact_id) +
    (query.version === undefined ? '' : '/versions/' + query.version);
  return gatewayRequest<ArtifactReadDetail>(
    path,
    {},
    undefined,
    'GET',
    undefined,
    (result, scope, trace) => {
      try {
        return parseArtifactReadEnvelope(result, query, scope, trace);
      } catch {
        throw new WorkbenchApiError(
          'The returned file details did not match this request.',
          trace,
          502,
          'GATEWAY_RESPONSE_INVALID',
        );
      }
    },
  );
}

export function getWorkbenchArtifactReceipt(input: unknown) {
  const query = parseArtifactReceiptQuery(input);
  return gatewayRequest<ArtifactReceiptView>(
    '/v1/artifacts/receipt',
    { ...parseArtifactReceiptQuery(query) },
    undefined,
    'POST',
    query.identity,
    (result, _scope, trace) => {
      try {
        return parseArtifactReceiptEnvelope(result, query, trace);
      } catch {
        throw new WorkbenchApiError(
          'The original file receipt could not be confirmed. Keep the saved request.',
          trace,
          502,
          'GATEWAY_RESPONSE_INVALID',
        );
      }
    },
  );
}

export function getWorkbenchConflict(conflictId: string, identity?: ConflictCommandIdentity) {
  const query = parseConflictReadQuery({ conflict_id: conflictId });
  return gatewayRequest<ConflictReadRecord>(
    '/v1/conflicts/' + encodeURIComponent(query.conflict_id),
    {},
    undefined,
    'GET',
    identity,
    (result, scope, trace) => {
      try {
        return parseConflictReadEnvelope(result, query, scope, trace);
      } catch {
        throw new WorkbenchApiError(
          'Invalid complete conflict detail response.',
          trace,
          502,
          'GATEWAY_RESPONSE_INVALID',
        );
      }
    },
  );
}

export function getWorkbenchConflictReceipt(input: unknown) {
  const query = parseConflictReceiptQuery(input);
  return gatewayRequest<ConflictReceiptView>(
    '/v1/conflicts/receipt',
    { ...query },
    undefined,
    'POST',
    query.identity,
    (result, _scope, trace) => {
      try {
        return parseConflictReceiptEnvelope(result, query, trace);
      } catch {
        throw new WorkbenchApiError(
          'The original conflict receipt could not be confirmed. Keep the saved request.',
          trace,
          502,
          'GATEWAY_RESPONSE_INVALID',
        );
      }
    },
  );
}

export function getWorkbenchConflictCommandContext() {
  return gatewayRequest<ConflictCommandContextData>(
    '/v1/conflicts/commands/context',
    {},
    undefined,
    'GET',
    undefined,
    (result, scope, trace) => {
      try {
        const page = parseConflictCommandContextEnvelope(result, scope, trace);
        if (Date.parse(page.data.expires_at) <= Date.now()) throw new TypeError();
        return page;
      } catch {
        throw new WorkbenchApiError(
          'The verified conflict identity is invalid or expired.',
          trace,
          502,
          'GATEWAY_RESPONSE_INVALID',
        );
      }
    },
  );
}

export function getWorkbenchCheckpointHistory(sessionId: string, before?: number) {
  const query = parseCheckpointHistoryQuery({ session_id: sessionId, before_revision: before });
  return gatewayRequest(
    '/v1/workbench/query',
    { operation: 'checkpoints', ...query },
    undefined,
    'POST',
    undefined,
    (result, scope, trace) => {
      try {
        return parseCheckpointHistoryWorkbenchEnvelope(result, query, scope, trace);
      } catch {
        throw new WorkbenchApiError(
          'Invalid complete checkpoint history response.',
          trace,
          502,
          'GATEWAY_RESPONSE_INVALID',
        );
      }
    },
  );
}

export async function searchWorkbenchProject(input: ProjectSearchQuery) {
  const query = parseProjectSearchQuery(input);
  const result = await gatewayPost<ProjectSearchPage>('/v1/search', { ...query });
  try {
    return { ...result, data: parseProjectSearchPage(result.data, query) };
  } catch {
    throw new WorkbenchApiError('Invalid project search response.', result.trace_id);
  }
}

export async function listWorkbenchLegacyIndexes(input: LegacyContextListQuery = {}) {
  const query = parseLegacyContextListQuery(input);
  const search = new URLSearchParams();
  for (const [field, value] of Object.entries(query)) search.set(field, String(value));
  const result = await gatewayRequest<LegacyContextListPage>(
    '/v1/context/index?' + search,
    {},
    undefined,
    'GET',
  );
  try {
    return { ...result, data: parseLegacyContextListPage(result.data, query) };
  } catch {
    throw new WorkbenchApiError('Invalid index directory response.', result.trace_id);
  }
}

export async function getWorkbenchLegacyIndex(
  id: string,
  expectedIdentity?: LegacyContextIdentity,
) {
  const query = parseLegacyContextStatusQuery({ id });
  const result = await gatewayRequest<LegacyContextStatus>(
    '/v1/context/index/' + encodeURIComponent(query.id),
    {},
    undefined,
    'GET',
    expectedIdentity,
  );
  try {
    const data = parseLegacyContextStatus(result.data, query.id);
    const identity = parseLegacyContextIdentity(result.index_identity);
    if (
      identity.tenant_id !== data.tenant_id ||
      identity.workspace_id !== data.workspace_id ||
      identity.project_id !== data.project_id ||
      (expectedIdentity &&
        JSON.stringify(identity) !==
          JSON.stringify(parseLegacyContextIdentity(expectedIdentity))) ||
      typeof result.index_permissions?.write !== 'boolean'
    )
      throw new Error();
    return {
      ...result,
      data,
      index_identity: identity,
      index_permissions: result.index_permissions!,
    };
  } catch {
    throw new WorkbenchApiError('Invalid index status response.', result.trace_id);
  }
}

export async function mutateWorkbenchLegacyIndex(
  operation: LegacyContextAction,
  input: LegacyContextMutation,
  key: string,
  identity: LegacyContextIdentity,
) {
  if (operation !== 'delete' && operation !== 'restore')
    throw new TypeError('Invalid index action');
  const mutation = parseLegacyContextMutation(input);
  const result = await gatewayRequest<LegacyContextMutationReceipt>(
    '/v1/context/index/' + encodeURIComponent(mutation.id) + '/' + operation,
    { ...mutation },
    key,
    'POST',
    identity,
  );
  try {
    const data = parseLegacyContextMutationReceipt(result.data, mutation, operation, key);
    if (
      data.record.tenant_id !== identity.tenant_id ||
      data.record.workspace_id !== identity.workspace_id ||
      data.record.project_id !== identity.project_id
    )
      throw new Error();
    return { ...result, data };
  } catch {
    throw new WorkbenchApiError(
      'The index command receipt could not be confirmed.',
      result.trace_id,
    );
  }
}

export async function getWorkbenchOverview() {
  const result = await queryWorkbench<WorkbenchOverview>('overview');
  try {
    return { ...result, data: parseWorkbenchOverview(result.data) };
  } catch {
    throw new WorkbenchApiError('Invalid project overview response.', result.trace_id);
  }
}

export function getWorkbenchObservedProject() {
  return observedRead('project', undefined, (data, id, scope) =>
    parseObservedSnapshot(data, 'Project', id, scope),
  );
}

export function getWorkbenchPlaneInboxSummary() {
  return planeInboxRead('/v1/plane/events/summary', parsePlaneInboxSummary);
}

export function getWorkbenchPlaneInboxDiagnosis(eventId: string) {
  const query = parsePlaneInboxRecordQuery({ event_id: eventId });
  return planeInboxRead(
    '/v1/plane/events/' + encodeURIComponent(query.event_id) + '/diagnosis',
    (data, scope) => parsePlaneInboxDiagnosis(data, scope, query.event_id),
  );
}

export function listWorkbenchPlaneEvents(input: PlaneInboxListQuery = {}) {
  const query = parsePlaneInboxListQuery(input);
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) search.set(key, String(value));
  return planeInboxRead('/v1/plane/events?' + search, (data, scope) =>
    parsePlaneInboxPage(data, scope, query),
  );
}

export async function getWorkbenchPlaneEvent(
  eventId: string,
  expectedIdentity?: PlaneInboxIdentity,
) {
  const query = parsePlaneInboxRecordQuery({ event_id: eventId });
  const result = await gatewayRequest<PlaneInboxRecord>(
    '/v1/plane/events/' + encodeURIComponent(query.event_id),
    {},
    undefined,
    'GET',
    expectedIdentity,
    (result, scope, trace) => {
      try {
        if (result.trace_id !== trace || result.source_refs.length !== 0) throw new Error();
        return { ...result, data: parsePlaneInboxRecord(result.data, scope, query.event_id) };
      } catch {
        throw new WorkbenchApiError(
          'Invalid event processing response.',
          trace,
          undefined,
          'GATEWAY_RESPONSE_INVALID',
        );
      }
    },
  );
  try {
    const identity = parsePlaneInboxIdentity(result.plane_inbox_identity);
    if (
      identity.tenant_id !== result.data.tenant_id ||
      identity.workspace_id !== result.data.workspace_id ||
      identity.project_id !== result.data.project_id ||
      typeof result.plane_inbox_permissions?.retry !== 'boolean' ||
      (expectedIdentity &&
        JSON.stringify(identity) !== JSON.stringify(parsePlaneInboxIdentity(expectedIdentity)))
    )
      throw new Error();
    return {
      ...result,
      plane_inbox_identity: identity,
      plane_inbox_permissions: { retry: result.plane_inbox_permissions.retry },
    };
  } catch {
    throw new WorkbenchApiError(
      'Invalid event retry identity.',
      result.trace_id,
      undefined,
      'GATEWAY_RESPONSE_INVALID',
    );
  }
}

export function retryWorkbenchPlaneEvent(
  input: PlaneInboxRetryInput,
  key: string,
  identity: PlaneInboxIdentity,
) {
  return planeInboxRetryRequest(input, key, identity, false);
}
export function getWorkbenchPlaneRetryReceipt(
  input: PlaneInboxRetryInput,
  key: string,
  identity: PlaneInboxIdentity,
) {
  return planeInboxRetryRequest(input, key, identity, true);
}
function planeInboxRetryRequest(
  input: PlaneInboxRetryInput,
  key: string,
  identity: PlaneInboxIdentity,
  lookup: false,
): Promise<WorkbenchResponse<PlaneInboxRetryReceipt>>;
function planeInboxRetryRequest(
  input: PlaneInboxRetryInput,
  key: string,
  identity: PlaneInboxIdentity,
  lookup: true,
): Promise<WorkbenchResponse<PlaneInboxRetryLookup>>;
function planeInboxRetryRequest(
  input: PlaneInboxRetryInput,
  key: string,
  expectedIdentity: PlaneInboxIdentity,
  lookup: boolean,
) {
  const query = parsePlaneInboxRetryQuery({
    ...parsePlaneInboxRetryInput(input),
    request_key: key,
  });
  const identity = parsePlaneInboxIdentity(expectedIdentity);
  const { event_id, request_key, ...command } = query;
  return gatewayRequest<PlaneInboxRetryReceipt | PlaneInboxRetryLookup>(
    '/v1/plane/events/' + encodeURIComponent(event_id) + '/retry' + (lookup ? '/receipt' : ''),
    { ...command, request_key },
    lookup ? undefined : request_key,
    'POST',
    identity,
    (result, _scope, trace) => {
      try {
        if (result.trace_id !== trace || result.source_refs.length !== 0) throw new Error();
        const original = { event_id, ...command };
        const data = lookup
          ? parsePlaneInboxRetryLookup(result.data, original, identity, request_key)
          : parsePlaneInboxRetryReceipt(result.data, original, identity, request_key);
        return { ...result, data };
      } catch {
        throw new WorkbenchApiError(
          'The original retry response could not be confirmed.',
          trace,
          undefined,
          'GATEWAY_RESPONSE_INVALID',
        );
      }
    },
  );
}

function planeInboxRead<T>(path: string, parse: (data: unknown, scope: ObservedScope) => T) {
  return gatewayRequest<T>(path, {}, undefined, 'GET', undefined, (result, scope, trace) => {
    try {
      if (result.trace_id !== trace || result.source_refs.length !== 0) throw new Error();
      return { ...result, data: parse(result.data, scope) };
    } catch {
      throw new WorkbenchApiError(
        'Invalid event processing response.',
        trace,
        undefined,
        'GATEWAY_RESPONSE_INVALID',
      );
    }
  });
}

export function getWorkbenchObservedWorkItem(itemId: string) {
  return observedRead('work-item', parseObservedRecordId(itemId), (data, id, scope) =>
    parseObservedSnapshot(data, 'WorkItem', id, scope),
  );
}

export function listWorkbenchObservedWorkItems(input: ObservedWorkItemListQuery = {}) {
  const query = parseObservedWorkItemListQuery(input);
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) search.set(key, String(value));
  return gatewayRequest<ObservedWorkItemPage>(
    '/v1/plane/work-items?' + search,
    {},
    undefined,
    'GET',
    undefined,
    (result, scope, trace) => {
      try {
        if (result.trace_id !== trace || result.source_refs.length !== 0) throw new Error();
        return { ...result, data: parseObservedWorkItemPage(result.data, scope, query) };
      } catch {
        throw new WorkbenchApiError(
          'Invalid observation directory response.',
          trace,
          undefined,
          'GATEWAY_RESPONSE_INVALID',
        );
      }
    },
  );
}

export function getWorkbenchObservedContext(itemId: string) {
  return observedRead('context', parseObservedRecordId(itemId), parseObservedWorkItemContext);
}

function observedRead<T extends ObservedSnapshot | ObservedWorkItemContext>(
  kind: ObservedReadKind,
  itemId: string | undefined,
  parse: (data: unknown, id: string, scope: ObservedScope, trace: string) => T,
) {
  const requestedId = (scope: ObservedScope) =>
    parseObservedReadInput(
      kind === 'project' ? {} : { work_item_id: itemId },
      kind,
      scope.project_id,
    ).id;
  return gatewayRequest<T>(
    (scope) => {
      const id = encodeURIComponent(requestedId(scope));
      return kind === 'project'
        ? `/v1/projects/${id}/state`
        : `/v1/work-items/${id}/${kind === 'context' ? 'context' : 'state'}`;
    },
    {},
    undefined,
    'GET',
    undefined,
    (result, scope, trace) => {
      try {
        if (result.trace_id !== trace) throw new Error();
        const data = parse(result.data, requestedId(scope), scope, trace);
        const source_refs = result.source_refs.map((raw) => {
          const ref = validateSourceRef(raw);
          return {
            type: ref.type,
            id: ref.id,
            ...(ref.revision === undefined ? {} : { revision: ref.revision }),
            ...(ref.uri === undefined ? {} : { uri: ref.uri }),
          };
        });
        const expected = 'work_item' in data ? data.context_pack.source_refs : data.source_refs;
        if (JSON.stringify(source_refs) !== JSON.stringify(expected)) throw new Error();
        return { ...result, data, source_refs };
      } catch {
        throw new WorkbenchApiError(
          'Invalid Plane observation response.',
          trace,
          undefined,
          'GATEWAY_RESPONSE_INVALID',
        );
      }
    },
  );
}

export async function listWorkbenchWorkItems(input: WorkItemListQuery = {}) {
  const query = parseWorkItemListQuery(input);
  const result = await queryWorkbench<WorkItemProjection[]>('work_items', { ...query });
  try {
    return { ...result, ...parseWorkItemProjectionList(result, query) };
  } catch {
    throw new WorkbenchApiError('Invalid work item list response.', result.trace_id);
  }
}

export async function getWorkbenchWorkItem(itemId: string) {
  const query = parseWorkItemProjectionQuery({ item_id: itemId });
  const result = await queryWorkbench<WorkItemProjection>('work_item', query);
  try {
    return { ...result, data: parseWorkItemProjection(result.data, itemId) };
  } catch {
    throw new WorkbenchApiError('Invalid work item detail response.', result.trace_id);
  }
}

export function createWorkbenchHandoff(
  sessionId: string,
  checkpointId: string,
  target: string | undefined,
  key: string,
  identity: SessionCommandIdentity,
) {
  return handoffCreationRequest(sessionId, checkpointId, target, key, identity, false);
}

export function getWorkbenchHandoffCreateReceipt(
  sessionId: string,
  checkpointId: string,
  target: string | undefined,
  key: string,
  identity: SessionCommandIdentity,
) {
  return handoffCreationRequest(sessionId, checkpointId, target, key, identity, true);
}

function handoffCreationRequest(
  sessionId: string,
  checkpointId: string,
  target: string | undefined,
  key: string,
  expectedIdentity: SessionCommandIdentity,
  lookup: boolean,
): Promise<WorkbenchResponse<HandoffCreateReceiptLookup>> {
  const identity = parseSessionCommandIdentity(expectedIdentity);
  const binding = parseHandoffCreateBinding(
    sessionId,
    {
      request_key: key,
      handoff: {
        checkpoint_id: checkpointId,
        ...(target === undefined ? {} : { target_client: target }),
      },
    },
    identity,
    identity,
  );
  return gatewayRequest<HandoffCreateReceiptLookup>(
    `/v1/sessions/${encodeURIComponent(sessionId)}/handoff${lookup ? '/receipt' : ''}`,
    lookup ? { ...binding.query } : { ...binding.query.handoff },
    lookup ? undefined : key,
    'POST',
    identity,
    (result, _scope, trace) => {
      try {
        const parsed = parseHandoffCreateEnvelope(result, binding, trace, lookup);
        const data = 'create_receipt' in parsed.data ? parsed.data.create_receipt : parsed.data;
        return { schema_version: 1, trace_id: trace, source_refs: [], data };
      } catch {
        throw new WorkbenchApiError(
          'The original handoff creation could not be confirmed. Keep its request and check the receipt.',
          trace,
          undefined,
          'GATEWAY_RESPONSE_INVALID',
        );
      }
    },
  );
}

export function startWorkbenchSession(
  session: SessionStartCommand,
  key: string,
  identity: SessionCommandIdentity,
) {
  return sessionStartRequest(session, key, identity, false);
}
export function getWorkbenchSessionStartReceipt(
  session: SessionStartCommand,
  key: string,
  identity: SessionCommandIdentity,
) {
  return sessionStartRequest(session, key, identity, true);
}
function sessionStartRequest(
  session: SessionStartCommand,
  key: string,
  expectedIdentity: SessionCommandIdentity,
  lookup: boolean,
): Promise<WorkbenchResponse<SessionStartReceiptLookup>> {
  const identity = parseSessionCommandIdentity(expectedIdentity);
  const binding = parseSessionStartBinding({ request_key: key, session }, identity, identity);
  return gatewayRequest<SessionStartReceiptLookup>(
    lookup ? '/v1/sessions/start/receipt' : '/v1/sessions',
    lookup ? { ...binding.query } : { ...binding.query.session },
    lookup ? undefined : key,
    'POST',
    identity,
    (result, _scope, trace) => {
      try {
        const parsed = parseSessionStartEnvelope(result, binding, trace, lookup);
        const data = 'start_receipt' in parsed.data ? parsed.data.start_receipt : parsed.data;
        return { schema_version: 1, trace_id: trace, source_refs: [], data };
      } catch {
        throw new WorkbenchApiError(
          'The original session start could not be confirmed. Keep its request and check the receipt.',
          trace,
          undefined,
          'GATEWAY_RESPONSE_INVALID',
        );
      }
    },
  );
}

export async function listWorkbenchSessionRuns(sessionId: string, input: SessionRunQuery = {}) {
  const query = parseSessionRunQuery(input);
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) search.set(key, String(value));
  const result = await gatewayRequest<SessionRunPage>(
    `/v1/sessions/${encodeURIComponent(sessionId)}/runs?${search}`,
    {},
    undefined,
    'GET',
  );
  try {
    return { ...result, data: parseSessionRunPage(result.data, sessionId, query) };
  } catch {
    throw new WorkbenchApiError('Invalid run activity response.', result.trace_id);
  }
}

export async function listWorkbenchSessionToolCalls(
  sessionId: string,
  input: SessionToolCallQuery = {},
) {
  const query = parseSessionToolCallQuery(input);
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) search.set(key, String(value));
  const result = await gatewayRequest<SessionToolCallPage>(
    `/v1/sessions/${encodeURIComponent(sessionId)}/tool-calls?${search}`,
    {},
    undefined,
    'GET',
  );
  try {
    return { ...result, data: parseSessionToolCallPage(result.data, sessionId, query) };
  } catch {
    throw new WorkbenchApiError('Invalid tool activity response.', result.trace_id);
  }
}

export type SessionEndStatus = 'ended' | 'abandoned' | 'failed';

export function createWorkbenchSessionActivity(raw: ActivityCreateRequest) {
  const request = parseActivityCreateRequest(raw);
  return gatewayRequest<ActivityCreateReceipt>(
    `/v1/sessions/${encodeURIComponent(request.sessionId)}/${request.operation === 'run.start' ? 'runs' : 'tool-calls'}`,
    activityCreateQuery(request).command,
    request.key,
    'POST',
    request.identity,
    (result, _scope, trace) => ({
      ...result,
      data: parseActivityCreateResponse(result, request, trace),
    }),
  );
}
export type RunFinishStatus = 'completed' | 'failed';
export type ToolFinishStatus = 'succeeded' | 'failed';

export async function getWorkbenchSessionToolCall(
  sessionId: string,
  toolCallId: string,
  identity?: SessionCommandIdentity,
) {
  return gatewayRequest<SessionToolCallDetail>(
    `/v1/sessions/${encodeURIComponent(sessionId)}/tool-calls/${encodeURIComponent(toolCallId)}`,
    {},
    undefined,
    'GET',
    identity,
    (result, scope, trace) =>
      sessionDetailResponse(
        result,
        scope,
        trace,
        (data) => parseSessionToolCallDetail(data, sessionId, toolCallId),
        identity,
      ),
  );
}

export async function finishWorkbenchSessionToolCall(
  sessionId: string,
  toolCallId: string,
  version: number,
  toolVersion: number,
  status: ToolFinishStatus,
  key: string,
  identity: SessionCommandIdentity,
) {
  const result = await finishWorkbenchSessionCommand(
    sessionId,
    'tool.finish',
    `/v1/sessions/${encodeURIComponent(sessionId)}/tool-calls/${encodeURIComponent(toolCallId)}/finish`,
    {
      tool_call_id: toolCallId,
      status,
      expected_version: version,
      expected_tool_version: toolVersion,
    },
    key,
    identity,
  );
  if (!('tool_call_id' in result.data))
    throw new WorkbenchApiError('Invalid tool finish response.', result.trace_id);
  return { ...result, data: result.data };
}

export async function getWorkbenchSessionRun(
  sessionId: string,
  runId: string,
  identity?: SessionCommandIdentity,
) {
  return gatewayRequest<SessionRunDetail>(
    `/v1/sessions/${encodeURIComponent(sessionId)}/runs/${encodeURIComponent(runId)}`,
    {},
    undefined,
    'GET',
    identity,
    (result, scope, trace) =>
      sessionDetailResponse(
        result,
        scope,
        trace,
        (data) => parseSessionRunDetail(data, sessionId, runId),
        identity,
      ),
  );
}

function sessionDetailResponse<T>(
  result: WorkbenchResponse<unknown>,
  scope: ObservedScope,
  trace: string,
  parse: (data: unknown) => T,
  expectedIdentity?: SessionCommandIdentity,
): WorkbenchResponse<T> {
  try {
    const identity =
      result.session_identity === undefined
        ? undefined
        : parseSessionCommandIdentity(result.session_identity);
    if (
      result.trace_id !== trace ||
      (identity &&
        (identity.tenant_id !== scope.tenant_id ||
          identity.workspace_id !== scope.workspace_id ||
          identity.project_id !== scope.project_id)) ||
      (expectedIdentity &&
        JSON.stringify(identity) !==
          JSON.stringify(parseSessionCommandIdentity(expectedIdentity))) ||
      typeof result.session_permissions?.write_sessions !== 'boolean' ||
      (result.session_permissions.write_sessions && !identity)
    )
      throw new TypeError();
    return {
      ...result,
      data: parse(result.data),
      ...(identity ? { session_identity: identity } : {}),
    };
  } catch {
    throw new WorkbenchApiError('Invalid session activity identity or detail response.', trace);
  }
}

export async function finishWorkbenchSessionRun(
  sessionId: string,
  runId: string,
  version: number,
  runVersion: number,
  status: RunFinishStatus,
  key: string,
  identity: SessionCommandIdentity,
) {
  const result = await finishWorkbenchSessionCommand(
    sessionId,
    'run.finish',
    `/v1/sessions/${encodeURIComponent(sessionId)}/runs/${encodeURIComponent(runId)}/finish`,
    { run_id: runId, status, expected_version: version, expected_run_version: runVersion },
    key,
    identity,
  );
  if (!('sequence' in result.data))
    throw new WorkbenchApiError('Invalid run finish response.', result.trace_id);
  return { ...result, data: result.data };
}

export async function endWorkbenchSession(
  sessionId: string,
  version: number,
  status: SessionEndStatus,
  key: string,
  identity: SessionCommandIdentity,
) {
  const result = await finishWorkbenchSessionCommand(
    sessionId,
    'end',
    `/v1/sessions/${encodeURIComponent(sessionId)}/end`,
    { status, expected_version: version },
    key,
    identity,
  );
  if (!('ended_at' in result.data))
    throw new WorkbenchApiError('Invalid session closure response.', result.trace_id);
  return { ...result, data: result.data };
}

function finishWorkbenchSessionCommand(
  sessionId: string,
  operation: SessionFinishOperation,
  path: string,
  input: Record<string, unknown>,
  key: string,
  identity: SessionCommandIdentity,
) {
  const expected = parseSessionCommandIdentity(identity);
  const binding = parseSessionCommandBinding(
    sessionId,
    {
      operation,
      request_key: key,
      command: parseSessionFinishCommand(operation, input),
    },
    expected,
    expected,
  );
  return gatewayRequest<SessionFinishedRecord>(
    path,
    binding.query.command,
    binding.query.request_key,
    'POST',
    expected,
    (result, _scope, trace) => parseSessionFinishEnvelope(result, binding, trace),
  );
}

export function getWorkbenchSessionCommandReceipt(
  sessionId: string,
  query: SessionCommandReceiptQuery,
  identity: SessionCommandIdentity,
) {
  const expected = parseSessionCommandIdentity(identity);
  const binding = parseSessionCommandBinding(sessionId, query, expected, expected);
  return gatewayRequest<SessionCommandReceiptLookup>(
    `/v1/sessions/${encodeURIComponent(sessionId)}/commands/receipt`,
    { ...binding.query },
    undefined,
    'POST',
    expected,
    (result, _scope, trace) => parseSessionCommandReceiptEnvelope(result, binding, trace),
  );
}

export type CheckpointNotes = Record<
  'completed' | 'in_progress' | 'next_actions' | 'decisions' | 'risks' | 'open_questions',
  string[]
>;

export function getWorkbenchHandoff(handoffId: string, identity?: SessionCommandIdentity) {
  parseHandoffReadQuery({ handoff_id: handoffId });
  return gatewayRequest<HandoffReadDetail>(
    '/v1/handoffs/' + encodeURIComponent(handoffId),
    {},
    undefined,
    'GET',
    identity,
    (result, scope, trace) => {
      try {
        return parseHandoffReadEnvelope(result, handoffId, scope, trace, identity);
      } catch {
        throw new WorkbenchApiError('Invalid current handoff detail response.', trace);
      }
    },
  );
}

export function getWorkbenchCheckpoint(
  sessionId: string,
  checkpointId: string,
  identity?: SessionCommandIdentity,
) {
  const query = parseCheckpointReadQuery({ session_id: sessionId, checkpoint_id: checkpointId });
  return gatewayRequest<CheckpointReadDetail>(
    `/v1/sessions/${encodeURIComponent(sessionId)}/checkpoints/${encodeURIComponent(checkpointId)}`,
    {},
    undefined,
    'GET',
    identity,
    (result, scope, trace) => {
      try {
        return parseCheckpointReadEnvelope(result, query, scope, trace);
      } catch {
        throw new WorkbenchApiError(
          'Invalid historical checkpoint detail response.',
          trace,
          502,
          'GATEWAY_RESPONSE_INVALID',
        );
      }
    },
  );
}

export function saveWorkbenchCheckpoint(
  sessionId: string,
  version: number,
  notes: CheckpointNotes,
  key: string,
  contextPackId: string | undefined,
  identity: SessionCommandIdentity,
) {
  const binding = workbenchCheckpointBinding(
    sessionId,
    version,
    notes,
    key,
    contextPackId,
    identity,
  );
  return gatewayRequest<CheckpointSavedRecord>(
    `/v1/sessions/${encodeURIComponent(sessionId)}/checkpoint`,
    binding.query.checkpoint,
    key,
    'POST',
    identity,
    (result, _scope, trace) => {
      try {
        return parseCheckpointSaveEnvelope(result, binding, trace);
      } catch {
        throw new WorkbenchApiError(
          'The original checkpoint save could not be confirmed. Keep its request and query its receipt.',
          trace,
          undefined,
          'SESSION_RECEIPT_INVALID',
        );
      }
    },
  );
}

export function getWorkbenchCheckpointReceipt(
  sessionId: string,
  version: number,
  notes: CheckpointNotes,
  key: string,
  contextPackId: string | undefined,
  identity: SessionCommandIdentity,
) {
  const binding = workbenchCheckpointBinding(
    sessionId,
    version,
    notes,
    key,
    contextPackId,
    identity,
  );
  return gatewayRequest<CheckpointReceiptLookup>(
    `/v1/sessions/${encodeURIComponent(sessionId)}/checkpoint/receipt`,
    { ...binding.query },
    undefined,
    'POST',
    identity,
    (result, _scope, trace) => {
      try {
        return parseCheckpointReceiptEnvelope(result, binding, trace);
      } catch {
        throw new WorkbenchApiError(
          'The original checkpoint receipt could not be confirmed. Keep the original request.',
          trace,
          undefined,
          'SESSION_RECEIPT_INVALID',
        );
      }
    },
  );
}

function workbenchCheckpointBinding(
  sessionId: string,
  version: number,
  notes: CheckpointNotes,
  key: string,
  contextPackId: string | undefined,
  identity: SessionCommandIdentity,
) {
  identity = parseSessionCommandIdentity(identity);
  return parseCheckpointBinding(
    sessionId,
    {
      request_key: key,
      checkpoint: parseCheckpointSaveCommand({
        ...notes,
        expected_version: version,
        ...(contextPackId === undefined ? {} : { context_pack_id: contextPackId }),
      }),
    },
    identity,
    identity,
  );
}

export function claimWorkbenchHandoff(
  handoffId: string,
  version: number,
  key: string,
  identity?: SessionCommandIdentity,
) {
  return gatewayPost<{
    handoff_id: string;
    checkpoint_id: string;
    version: number;
    claim_receipt?: HandoffClaimRecorded;
  }>(
    `/v1/handoffs/${encodeURIComponent(handoffId)}/claim`,
    { expected_version: version },
    key,
    identity,
  );
}

export function getWorkbenchHandoffClaimReceipt(
  handoffId: string,
  version: number,
  key: string,
  identity: SessionCommandIdentity,
) {
  return gatewayPost<HandoffClaimReceiptLookup>(
    `/v1/handoffs/${encodeURIComponent(handoffId)}/claim/receipt`,
    { request_key: key, claim: { expected_version: version } },
    undefined,
    identity,
  );
}

export function resumeWorkbenchHandoff(
  sessionId: string,
  handoffId: string,
  identity: SessionCommandIdentity,
  expectedCheckpointId: string,
) {
  const binding = workbenchResumeBinding(sessionId, handoffId, identity, expectedCheckpointId);
  return gatewayRequest<ResumeResult>(
    `/v1/sessions/${encodeURIComponent(sessionId)}/resume`,
    { handoff_id: handoffId, require_claimed: true },
    binding.query.request_key,
    'POST',
    identity,
    (result, _scope, trace) => {
      try {
        return parseResumeEnvelope(result, binding, trace);
      } catch {
        throw new WorkbenchApiError(
          'The original resume could not be confirmed. Keep its request and query its receipt.',
          trace,
          undefined,
          'SESSION_RECEIPT_INVALID',
        );
      }
    },
  );
}

export function getWorkbenchResumeReceipt(
  sessionId: string,
  handoffId: string,
  identity: SessionCommandIdentity,
  expectedCheckpointId: string,
) {
  const binding = workbenchResumeBinding(sessionId, handoffId, identity, expectedCheckpointId);
  return gatewayRequest<ResumeReceiptLookup>(
    `/v1/sessions/${encodeURIComponent(sessionId)}/resume/receipt`,
    { ...binding.query },
    undefined,
    'POST',
    identity,
    (result, _scope, trace) => {
      try {
        return parseResumeReceiptEnvelope(result, binding, trace);
      } catch {
        throw new WorkbenchApiError(
          'The original resume receipt could not be confirmed. Keep the original request.',
          trace,
          undefined,
          'SESSION_RECEIPT_INVALID',
        );
      }
    },
  );
}

function workbenchResumeBinding(
  sessionId: string,
  handoffId: string,
  identity: SessionCommandIdentity,
  expectedCheckpointId: string,
) {
  identity = parseSessionCommandIdentity(identity);
  if (!isUlid(expectedCheckpointId)) throw new TypeError('Supply the original expected checkpoint');
  return parseResumeBinding(
    sessionId,
    { request_key: `workbench-resume-${handoffId}`, handoff_id: handoffId, require_claimed: true },
    identity,
    identity,
    expectedCheckpointId,
  );
}

export function submitWorkbenchConflictOriginal(input: unknown) {
  const original = parseConflictReceiptQuery(input);
  return gatewayRequest<ConflictSubmissionView>(
    `/v1/conflicts/${encodeURIComponent(original.command.conflict_id)}/resolve`,
    original.command,
    original.request_key,
    'POST',
    original.identity,
    // Legacy write responses have no original-key binding. Discard copied event/value data;
    // only an explicit receipt lookup can confirm this original request in the recovery UI.
    (result, _scope, trace) => {
      try {
        return parseConflictSubmissionResponse(result, original, trace);
      } catch {
        throw new WorkbenchApiError(
          'The complete decision response did not match. Keep the original request and check its receipt.',
          trace,
          502,
          'GATEWAY_RESPONSE_INVALID',
        );
      }
    },
  );
}

async function gatewayPost<T>(
  path: string,
  body: Record<string, unknown>,
  key?: string,
  identity?: SessionCommandIdentity,
): Promise<WorkbenchResponse<T>> {
  return gatewayRequest(path, body, key, 'POST', identity);
}

export function compileWorkbenchContextPack(budget: number, ttl: number, key: string) {
  return gatewayPost<ContextPackReceipt>(
    '/v1/context-pack/compile',
    { budget_tokens: budget, ttl_seconds: ttl },
    key,
  );
}

export function readWorkbenchContextPack(packId?: string) {
  return gatewayRequest<ContextPackReceipt>(
    '/v1/context-pack' + (packId ? '?pack_id=' + encodeURIComponent(packId) : ''),
    {},
    undefined,
    'GET',
  );
}

export function createWorkbenchContextItem(input: CreateContextItemRequest, key: string) {
  return gatewayPost<ContextItemMutationReceipt>('/v1/context-items', { ...input }, key);
}

export function readWorkbenchContextItem(itemId: string) {
  return gatewayRequest<ContextItemReadDocument>(
    '/v1/context-items/' + encodeURIComponent(itemId),
    {},
    undefined,
    'GET',
  );
}

export function readArchivedWorkbenchContextItem(itemId: string) {
  return gatewayRequest<ArchivedContextItemDocument>(
    '/v1/context-items/' + encodeURIComponent(itemId) + '/archived',
    {},
    undefined,
    'GET',
  );
}

export function readWorkbenchContextHistory(itemId: string, before?: number) {
  const query = new URLSearchParams({ limit: '25' });
  if (before !== undefined) query.set('before_version', String(before));
  return gatewayRequest<ContextItemHistoryPage>(
    '/v1/context-items/' + encodeURIComponent(itemId) + '/history?' + query,
    {},
    undefined,
    'GET',
  );
}

export function readWorkbenchContextVersion(itemId: string, version: number) {
  return gatewayRequest<ContextItemRevision>(
    '/v1/context-items/' + encodeURIComponent(itemId) + '/versions/' + version,
    {},
    undefined,
    'GET',
  );
}

export function listWorkbenchProposals(input: ProposalListQuery = {}) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(input))
    if (value !== undefined) query.set(key, String(value));
  return gatewayRequest<ProposalPage>(
    '/v1/proposals' + (query.size ? '?' + query : ''),
    {},
    undefined,
    'GET',
  );
}
export function readWorkbenchProposal(id: string) {
  return gatewayRequest<ProposalDetail>(
    '/v1/proposals/' + encodeURIComponent(id),
    {},
    undefined,
    'GET',
  );
}
export function createWorkbenchProposal(input: CreateProposalRequest, key: string) {
  return gatewayPost<ProposalMutationReceipt>('/v1/proposals', { ...input }, key);
}
export function reviewWorkbenchProposal(
  id: string,
  choice: 'confirm' | 'reject',
  revision: number,
  reason: string,
  key: string,
) {
  return gatewayPost<ProposalMutationReceipt>(
    '/v1/proposals/' + encodeURIComponent(id) + '/' + choice,
    { expected_revision: revision, reason },
    key,
  );
}
export function updateWorkbenchContextItem(
  id: string,
  input: UpdateContextItemRequest,
  version: number,
  key: string,
) {
  return gatewayPost<ContextItemMutationReceipt>(
    '/v1/context-items/' + encodeURIComponent(id) + '/update',
    { ...input, expected_version: version },
    key,
  );
}
export function archiveWorkbenchContextItem(id: string, version: number, key: string) {
  return gatewayPost<ContextItemMutationReceipt>(
    '/v1/context-items/' + encodeURIComponent(id) + '/archive',
    { expected_version: version },
    key,
  );
}

export function restoreWorkbenchContextItem(id: string, version: number, key: string) {
  return gatewayPost<ContextItemMutationReceipt>(
    '/v1/context-items/' + encodeURIComponent(id) + '/restore',
    { expected_version: version },
    key,
  );
}

export function confirmWorkbenchContextItem(
  id: string,
  version: number,
  reason: string,
  key: string,
) {
  return gatewayPost<ContextItemMutationReceipt>(
    '/v1/context-items/' + encodeURIComponent(id) + '/confirm',
    { expected_version: version, reason },
    key,
  );
}

async function gatewayRequest<T>(
  requestPath: string | ((scope: ObservedScope) => string),
  body: Record<string, unknown>,
  key: string | undefined,
  method: 'GET' | 'POST',
  expectedIdentity?: LegacyContextIdentity,
  parseResponse?: (
    result: WorkbenchResponse<unknown>,
    scope: ObservedScope,
    trace: string,
  ) => WorkbenchResponse<T>,
): Promise<WorkbenchResponse<T>> {
  const session = await getSession();
  if (!session) throw new AuthRequiredError();
  const trace_id = `trace_web_${crypto.randomUUID()}`;
  const scope = scopeFromSession(session);
  const path = typeof requestPath === 'function' ? requestPath(scope) : requestPath;
  const auditRequest =
    path === '/v1/workbench/query' && method === 'POST' && body.operation === 'audit';
  const adminRequest =
    path === '/v1/workbench/query' && method === 'POST' && body.operation === 'admin';
  const commandContextRequest =
    ['/v1/sessions/command-context', '/v1/conflicts/commands/context'].includes(path) &&
    method === 'GET';
  const checkpointDetailRequest =
    method === 'GET' &&
    /^\/v1\/sessions\/[0-9A-HJKMNP-TV-Z]{26}\/checkpoints\/[0-9A-HJKMNP-TV-Z]{26}$/.test(path);
  const checkpointHistoryRequest =
    path === '/v1/workbench/query' &&
    method === 'POST' &&
    body.operation === 'checkpoints' &&
    body.session_id !== undefined;
  const checkpointRequest = checkpointDetailRequest || checkpointHistoryRequest;
  const conflictRequest =
    method === 'GET' && !commandContextRequest && /^\/v1\/conflicts\/[^/]+$/.test(path);
  const conflictOriginalRequest =
    method === 'POST' &&
    (path === '/v1/conflicts/receipt' || /^\/v1\/conflicts\/[^/]+\/resolve$/.test(path));
  const registryRequest =
    path === '/v1/workbench/query' &&
    method === 'POST' &&
    (body.operation === 'sessions' ||
      body.operation === 'conflicts' ||
      body.operation === 'handoffs' ||
      (body.operation === 'checkpoints' && body.session_id === undefined));
  if (expectedIdentity) {
    expectedIdentity = parseLegacyContextIdentity(expectedIdentity);
    if (
      scope.tenant_id !== expectedIdentity.tenant_id ||
      scope.workspace_id !== expectedIdentity.workspace_id ||
      scope.project_id !== expectedIdentity.project_id
    )
      throw new WorkbenchApiError(
        'The project changed. Return to the original project before retrying this request.',
        trace_id,
        403,
        'DENIED',
      );
  }
  const etag =
    typeof body.expected_version === 'number' ? buildEtag(body.expected_version) : undefined;
  let response: Response;
  const requestDeadline = Date.now() + 30_000;
  const requestSignal = AbortSignal.timeout(30_000);
  try {
    response = await fetch(`${runtimeConfig.apiUrl}${path}`, {
      method,
      cache: 'no-store',
      redirect: 'error',
      signal: requestSignal,
      headers: {
        authorization: `Bearer ${session.access_token}`,
        'content-type': 'application/json',
        'x-trace-id': trace_id,
        'x-tenant-id': scope.tenant_id,
        'x-workspace-id': scope.workspace_id,
        'x-project-id': scope.project_id,
        ...(key ? { 'idempotency-key': key } : {}),
        ...(etag ? { 'if-match': etag } : {}),
        ...(expectedIdentity
          ? {
              'x-expected-actor-id': expectedIdentity.actor_id,
              'x-expected-client-id': expectedIdentity.client_id,
            }
          : {}),
      },
      ...(method === 'POST' ? { body: JSON.stringify(body) } : {}),
    });
  } catch {
    if (conflictOriginalRequest)
      throw new WorkbenchApiError(
        'The original conflict receipt could not be read. Keep the saved request.',
        trace_id,
        502,
        requestSignal.aborted ? 'GATEWAY_REQUEST_TIMEOUT' : 'GATEWAY_UNAVAILABLE',
      );
    if (conflictRequest)
      throw new WorkbenchApiError(
        requestSignal.aborted
          ? 'Conflict detail exceeded the local deadline.'
          : 'Conflict detail could not be read.',
        trace_id,
        502,
        requestSignal.aborted ? 'GATEWAY_REQUEST_TIMEOUT' : 'GATEWAY_UNAVAILABLE',
      );
    if (checkpointRequest)
      throw new WorkbenchApiError(
        requestSignal.aborted
          ? 'Checkpoint content exceeded the local deadline.'
          : 'Checkpoint content could not be read.',
        trace_id,
        502,
        requestSignal.aborted ? 'GATEWAY_REQUEST_TIMEOUT' : 'GATEWAY_UNAVAILABLE',
      );
    throw new WorkbenchApiError('Cannot reach the workbench gateway.', trace_id);
  }
  if (response.status === 401) {
    if (
      conflictOriginalRequest ||
      conflictRequest ||
      auditRequest ||
      adminRequest ||
      registryRequest ||
      commandContextRequest ||
      checkpointRequest
    )
      void response.body?.cancel().catch(() => undefined);
    throw new AuthRequiredError();
  }
  const payload = conflictRequest
    ? await readConflictResponse(response, requestSignal, trace_id, requestDeadline).catch(
        (error: unknown) => {
          throw new WorkbenchApiError(
            error instanceof ContractError
              ? error.envelope.message
              : 'Conflict detail could not be read.',
            trace_id,
            response.ok ? 502 : response.status,
            error instanceof ContractError ? error.envelope.code : 'GATEWAY_UNAVAILABLE',
          );
        },
      )
    : auditRequest
      ? await readWorkbenchAuditResponse(response, requestSignal).catch(() => {
          throw new WorkbenchApiError(
            'Audit response was incomplete, invalid or exceeded its read limit.',
            trace_id,
            response.ok ? 502 : response.status,
            'GATEWAY_RESPONSE_INVALID',
          );
        })
      : conflictOriginalRequest ||
          adminRequest ||
          registryRequest ||
          commandContextRequest ||
          checkpointRequest
        ? await readWorkbenchJsonResponse(
            response,
            requestSignal,
            conflictOriginalRequest
              ? CONFLICT_RECEIPT_RESPONSE_BYTES
              : checkpointRequest
                ? checkpointDetailRequest
                  ? CHECKPOINT_DETAIL_RESPONSE_BYTES
                  : CHECKPOINT_HISTORY_RESPONSE_BYTES
                : registryRequest
                  ? body.operation === 'conflicts'
                    ? CONFLICT_REGISTRY_RESPONSE_BYTES
                    : body.operation === 'handoffs'
                      ? HANDOFF_REGISTRY_RESPONSE_BYTES
                      : body.operation === 'checkpoints'
                        ? CHECKPOINT_REGISTRY_RESPONSE_BYTES
                        : SESSION_REGISTRY_RESPONSE_BYTES
                  : commandContextRequest
                    ? path === '/v1/conflicts/commands/context'
                      ? CONFLICT_COMMAND_CONTEXT_BYTES
                      : SESSION_COMMAND_CONTEXT_BYTES
                    : WORKBENCH_ADMIN_RESPONSE_BYTES,
            checkpointRequest ? CHECKPOINT_READ_ERROR_BYTES : undefined,
          ).catch(() => {
            if (conflictOriginalRequest && (requestSignal.aborted || Date.now() >= requestDeadline))
              throw new WorkbenchApiError(
                'The original receipt exceeded the local deadline. Keep the saved request.',
                trace_id,
                502,
                'GATEWAY_REQUEST_TIMEOUT',
              );
            if (checkpointRequest && (requestSignal.aborted || Date.now() >= requestDeadline))
              throw new WorkbenchApiError(
                'Checkpoint content exceeded the local deadline.',
                trace_id,
                502,
                'GATEWAY_REQUEST_TIMEOUT',
              );
            throw new WorkbenchApiError(
              'Workbench response was incomplete, invalid or exceeded its read limit.',
              trace_id,
              502,
              'GATEWAY_RESPONSE_INVALID',
            );
          })
        : await response.json().catch(() => null);
  if (checkpointRequest) {
    if (requestSignal.aborted || Date.now() >= requestDeadline)
      throw new WorkbenchApiError(
        'Checkpoint content exceeded the local deadline.',
        trace_id,
        502,
        'GATEWAY_REQUEST_TIMEOUT',
      );
    if (response.headers.get('x-trace-id') !== trace_id)
      throw new WorkbenchApiError(
        'Checkpoint response trace did not match this request.',
        trace_id,
        502,
        'GATEWAY_RESPONSE_INVALID',
      );
    if (!response.ok) {
      let code: string;
      try {
        const error = validateErrorEnvelope(payload);
        if (error.trace_id !== trace_id) throw new TypeError();
        code = error.code;
      } catch {
        throw new WorkbenchApiError(
          'Invalid checkpoint error response.',
          trace_id,
          502,
          'GATEWAY_RESPONSE_INVALID',
        );
      }
      const errors: Record<string, string> = {
        CHECKPOINT_READ_TOO_LARGE:
          'The complete checkpoint content exceeds the read limit. No partial notes were returned. You can look up another revision or recover an original request.',
        SESSION_NOT_FOUND: 'This session is unavailable in the current project.',
        CHECKPOINT_NOT_FOUND: 'This checkpoint is unavailable in the selected session.',
        INVALID_INPUT:
          'Choose valid session and checkpoint IDs or a positive history revision cursor.',
        DENIED: 'Your current session cannot read checkpoints in this project.',
        RATE_LIMITED: 'Checkpoint reads are temporarily busy.',
        SESSION_ACTIVITY_INVALID: 'Stored checkpoint content could not be validated.',
        SESSION_STORAGE_UNAVAILABLE: 'Checkpoint storage is temporarily unavailable.',
        WORKBENCH_DATABASE_UNAVAILABLE: 'Checkpoint history storage is temporarily unavailable.',
        WORKBENCH_AUTH_UNAVAILABLE: 'Gateway authentication is temporarily unavailable.',
        AUDIT_PERSISTENCE_UNAVAILABLE: 'The request audit could not be persisted.',
      };
      throw new WorkbenchApiError(
        Object.hasOwn(errors, code) ? errors[code]! : 'Checkpoint content could not be read.',
        trace_id,
        response.status,
        Object.hasOwn(errors, code) ? code : 'GATEWAY_UNAVAILABLE',
      );
    }
  }
  if (commandContextRequest && !response.ok)
    throw new WorkbenchApiError(
      response.status === 403
        ? 'Your current verified session cannot provide recovery identity. Sign in with the original account and client.'
        : 'Recovery identity is temporarily unavailable. Keep your saved original request.',
      trace_id,
      response.status,
    );
  if (conflictOriginalRequest && !response.ok) {
    let errorCode: string;
    try {
      const failure = validateErrorEnvelope(payload);
      if (failure.trace_id !== trace_id || response.headers.get('x-trace-id') !== trace_id)
        throw new TypeError();
      errorCode = failure.code;
    } catch {
      throw new WorkbenchApiError(
        'The original receipt error could not be validated. Keep the saved request.',
        trace_id,
        502,
        'GATEWAY_RESPONSE_INVALID',
      );
    }
    const known = [
      'INVALID_INPUT',
      'DENIED',
      'CONFLICT_NOT_FOUND',
      'IDEMPOTENCY_KEY_REUSED',
      'CONFLICT_RECEIPT_LEGACY_UNVERIFIED',
      'CONFLICT_RECEIPT_INVALID',
      'CONFLICT_STORAGE_UNAVAILABLE',
      'RATE_LIMITED',
    ].includes(errorCode)
      ? errorCode
      : 'GATEWAY_UNAVAILABLE';
    throw new WorkbenchApiError(
      'The original conflict outcome remains unconfirmed. Keep the saved identity, key and command.',
      trace_id,
      response.status,
      known,
    );
  }
  if (registryRequest && !response.ok)
    throw new WorkbenchApiError(
      response.status === 403
        ? 'Your current session cannot read this project directory.'
        : response.status === 400
          ? 'Directory filters or cursor were rejected. Restart from the first page with the current filters.'
          : 'The project directory is temporarily unavailable.',
      trace_id,
      response.status,
    );
  if (adminRequest && !response.ok)
    throw new WorkbenchApiError(
      response.status === 403
        ? 'Your current session cannot read administration data in this project.'
        : response.status === 404
          ? 'The project is not available in the readable scope.'
          : 'Administration data is temporarily unavailable.',
      trace_id,
      response.status,
    );
  if (
    (conflictOriginalRequest || adminRequest || registryRequest || commandContextRequest) &&
    response.headers.get('x-trace-id') !== trace_id
  )
    throw new WorkbenchApiError(
      'Workbench response trace did not match this request.',
      trace_id,
      502,
      'GATEWAY_RESPONSE_INVALID',
    );
  if (auditRequest && !response.ok)
    throw new WorkbenchApiError(
      response.status === 403
        ? 'Your account cannot read audit records in this project.'
        : response.status >= 500
          ? 'Audit records are temporarily unavailable.'
          : 'Audit query was rejected. Check the filters or restart from the newest matching records.',
      trace_id,
      response.status,
      typeof payload?.code === 'string' && /^[A-Z][A-Z0-9_]{0,127}$/.test(payload.code)
        ? payload.code
        : undefined,
    );
  if (!response.ok)
    throw new WorkbenchApiError(
      payload?.message ?? payload?.code ?? `Workbench query failed (HTTP ${response.status}).`,
      payload?.trace_id ?? trace_id,
      response.status,
      typeof payload?.code === 'string' ? payload.code : undefined,
    );
  if (
    payload?.schema_version !== 1 ||
    !('data' in payload) ||
    !Array.isArray(payload.source_refs) ||
    typeof payload.trace_id !== 'string'
  )
    throw new WorkbenchApiError('Invalid workbench gateway response.', trace_id);
  if (
    path === '/v1/search' &&
    (!payload.data?.scope ||
      payload.data.scope.tenant_id !== scope.tenant_id ||
      payload.data.scope.workspace_id !== scope.workspace_id ||
      payload.data.scope.project_id !== scope.project_id)
  )
    throw new WorkbenchApiError('Project search scope does not match the request.', trace_id);
  if (path.split('?')[0] === '/v1/context/index' || path.startsWith('/v1/context/index/')) {
    const returnedScope =
      path.split('?')[0] === '/v1/context/index'
        ? payload.data?.scope
        : method === 'POST'
          ? payload.data?.record
          : payload.data;
    if (
      !returnedScope ||
      returnedScope.tenant_id !== scope.tenant_id ||
      returnedScope.workspace_id !== scope.workspace_id ||
      returnedScope.project_id !== scope.project_id
    )
      throw new WorkbenchApiError('Index scope does not match the request.', trace_id);
  }
  const result = parseResponse
    ? parseResponse(payload, scope, trace_id)
    : (payload as WorkbenchResponse<T>);
  if (
    (conflictOriginalRequest ||
      conflictRequest ||
      auditRequest ||
      adminRequest ||
      registryRequest ||
      commandContextRequest ||
      checkpointRequest) &&
    (requestSignal.aborted || Date.now() >= requestDeadline)
  )
    throw new WorkbenchApiError(
      'Workbench response exceeded its read deadline.',
      trace_id,
      502,
      checkpointRequest || conflictRequest ? 'GATEWAY_REQUEST_TIMEOUT' : 'GATEWAY_RESPONSE_INVALID',
    );
  return result;
}

export async function queryAuditPreview() {
  try {
    const response = await queryWorkbench<unknown>('audit');
    if (
      !Array.isArray(response.data) ||
      !response.data.every(
        (row: unknown) => row !== null && typeof row === 'object' && !Array.isArray(row),
      )
    )
      throw new WorkbenchApiError(
        'Audit preview could not be read: invalid response.',
        response.trace_id,
      );
    return { ...response, data: response.data as Record<string, unknown>[] };
  } catch (error) {
    if (error instanceof WorkbenchApiError && error.status === 403) return undefined;
    throw error;
  }
}
