import { isUlid } from './ids.js';
import { validateIdempotencyKey, validateSourceRef, type SourceRef } from './metadata.js';
import {
  parseSessionCommandIdentity,
  parseSessionClosureState,
  type SessionCommandIdentity,
} from './session-activity.js';
import { parseEtag } from './versioning.js';

export interface SessionStartCommand {
  parent_session_id?: string;
  actor_id?: string;
  client_id?: string;
}
export interface SessionStartReceiptQuery {
  request_key: string;
  session: SessionStartCommand;
}
export interface SessionStartRecorded {
  status: 'recorded';
  session_id: string;
  parent_session_id?: string;
  actor_id: string;
  client_id: string;
  started_at: string;
  session_version: 1;
}
export type SessionStartReceiptLookup = { status: 'not-observed' } | SessionStartRecorded;
export interface SessionStartBinding {
  query: SessionStartReceiptQuery;
  identity: SessionCommandIdentity;
}
export interface SessionStartResult {
  schema_version: 1;
  tenant_id: string;
  workspace_id: string;
  project_id: string;
  session_id: string;
  parent_session_id?: string;
  actor_id: string;
  client_id: string;
  status: 'running' | 'paused' | 'ended' | 'abandoned' | 'failed';
  version: number;
  started_at: string;
  ended_at?: string;
  trace_id: string;
  source_refs: SourceRef[];
  start_receipt: SessionStartRecorded;
}
export interface SessionStartEnvelope<T> {
  schema_version: 1;
  trace_id: string;
  source_refs: SourceRef[];
  data: T;
  etag?: string;
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new TypeError('Expected a session start object');
  return value as Record<string, unknown>;
}
function identifier(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    !!value.trim() &&
    value.length <= 1024 &&
    !/[\u0000-\u001f\u007f\p{Cs}]/u.test(value)
  );
}
function timestamp(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString() === value
  );
}
export function parseSessionStartCommand(value: unknown): SessionStartCommand {
  const row = object(value);
  if (
    Object.keys(row).some((key) => !['parent_session_id', 'actor_id', 'client_id'].includes(key)) ||
    (row.parent_session_id !== undefined && !isUlid(row.parent_session_id)) ||
    (row.actor_id !== undefined && !identifier(row.actor_id)) ||
    (row.client_id !== undefined && !identifier(row.client_id))
  )
    throw new TypeError('Supply only the original optional parent, actor and client');
  return {
    ...(typeof row.parent_session_id === 'string'
      ? { parent_session_id: row.parent_session_id }
      : {}),
    ...(typeof row.actor_id === 'string' ? { actor_id: row.actor_id } : {}),
    ...(typeof row.client_id === 'string' ? { client_id: row.client_id } : {}),
  };
}
export function parseSessionStartReceiptQuery(value: unknown): SessionStartReceiptQuery {
  const row = object(value);
  if (Object.keys(row).some((key) => !['request_key', 'session'].includes(key)))
    throw new TypeError('Unknown start receipt field');
  return {
    request_key: validateIdempotencyKey(row.request_key),
    session: parseSessionStartCommand(row.session),
  };
}
export function assertSessionStartIdentity(
  command: SessionStartCommand,
  identity: { actor_id: string; client_id: string },
): void {
  if (
    !identifier(identity.actor_id) ||
    !identifier(identity.client_id) ||
    (command.actor_id !== undefined && command.actor_id !== identity.actor_id) ||
    (command.client_id !== undefined && command.client_id !== identity.client_id)
  )
    throw new TypeError('The original start belongs to another account or client');
}
export function parseSessionStartBinding(
  input: unknown,
  expectedIdentity: unknown,
  scope: { tenant_id: string; workspace_id: string; project_id?: string },
): SessionStartBinding {
  const query = parseSessionStartReceiptQuery(input);
  const identity = parseSessionCommandIdentity(expectedIdentity);
  assertSessionStartIdentity(query.session, identity);
  if (
    identity.tenant_id !== scope.tenant_id ||
    identity.workspace_id !== scope.workspace_id ||
    identity.project_id !== scope.project_id
  )
    throw new TypeError('The original start belongs to another project');
  return { query, identity };
}
export function parseSessionStartReceiptLookup(
  value: unknown,
  input: SessionStartCommand,
  identity: { actor_id: string; client_id: string },
): SessionStartReceiptLookup {
  const command = parseSessionStartCommand(input);
  assertSessionStartIdentity(command, identity);
  const row = object(value);
  if (row.status === 'not-observed') {
    if (Object.keys(row).some((key) => key !== 'status'))
      throw new TypeError('Invalid absent start receipt');
    return { status: 'not-observed' };
  }
  if (
    row.status !== 'recorded' ||
    !isUlid(row.session_id) ||
    row.session_version !== 1 ||
    row.actor_id !== identity.actor_id ||
    row.client_id !== identity.client_id ||
    row.parent_session_id !== command.parent_session_id ||
    row.session_id === row.parent_session_id ||
    !timestamp(row.started_at) ||
    Object.keys(row).some(
      (key) =>
        ![
          'status',
          'session_id',
          'parent_session_id',
          'actor_id',
          'client_id',
          'started_at',
          'session_version',
        ].includes(key),
    )
  )
    throw new TypeError('Invalid original session start receipt');
  return {
    status: 'recorded',
    session_id: row.session_id,
    session_version: 1,
    actor_id: identity.actor_id,
    client_id: identity.client_id,
    started_at: row.started_at,
    ...(command.parent_session_id === undefined
      ? {}
      : { parent_session_id: command.parent_session_id }),
  };
}
function sourceRefs(value: unknown): SourceRef[] {
  if (!Array.isArray(value) || value.length > 200 || Object.keys(value).length !== value.length)
    throw new TypeError('Invalid start sources');
  return value.map((input) => {
    const ref = validateSourceRef(input);
    return {
      type: ref.type,
      id: ref.id,
      ...(ref.revision === undefined ? {} : { revision: ref.revision }),
      ...(ref.uri === undefined ? {} : { uri: ref.uri }),
    };
  });
}
export function assertSessionStartCurrent(
  value: unknown,
  receipt: SessionStartRecorded,
  scope: { tenant_id: string; workspace_id: string; project_id: string },
): void {
  const row = object(value);
  const state = parseSessionClosureState(
    {
      session_id: row.session_id,
      status: row.status,
      version: row.version,
      ended_at: row.ended_at ?? null,
    },
    receipt.session_id,
  );
  if (
    row.schema_version !== 1 ||
    row.tenant_id !== scope.tenant_id ||
    row.workspace_id !== scope.workspace_id ||
    row.project_id !== scope.project_id ||
    row.actor_id !== receipt.actor_id ||
    row.client_id !== receipt.client_id ||
    row.parent_session_id !== receipt.parent_session_id ||
    row.resume_origin !== undefined ||
    row.started_at !== receipt.started_at ||
    !identifier(row.trace_id) ||
    (state.version === 1 && state.status !== 'running') ||
    (state.ended_at !== null && Date.parse(state.ended_at) < Date.parse(receipt.started_at))
  )
    throw new TypeError('Current session contradicts its original start receipt');
  if (
    !sourceRefs(row.source_refs).some(
      (ref) => ref.type === 'session' && ref.id === receipt.client_id,
    )
  )
    throw new TypeError('Started session lacks its original source');
}
export function parseSessionStartEnvelope(
  value: unknown,
  binding: SessionStartBinding,
  traceId: string,
  lookup: true,
): SessionStartEnvelope<SessionStartReceiptLookup>;
export function parseSessionStartEnvelope(
  value: unknown,
  binding: SessionStartBinding,
  traceId: string,
  lookup: false,
): SessionStartEnvelope<SessionStartResult>;
export function parseSessionStartEnvelope(
  value: unknown,
  binding: SessionStartBinding,
  traceId: string,
  lookup: boolean,
): SessionStartEnvelope<SessionStartReceiptLookup | SessionStartResult>;
export function parseSessionStartEnvelope(
  value: unknown,
  binding: SessionStartBinding,
  traceId: string,
  lookup: boolean,
): SessionStartEnvelope<SessionStartReceiptLookup | SessionStartResult> {
  const row = object(value);
  if (row.schema_version !== 1 || row.trace_id !== traceId || !identifier(traceId))
    throw new TypeError('Start response trace mismatch');
  const refs = sourceRefs(row.source_refs);
  if (lookup) {
    if (refs.length || row.etag !== undefined)
      throw new TypeError('Invalid historical start envelope');
    return {
      schema_version: 1,
      trace_id: traceId,
      source_refs: [],
      data: parseSessionStartReceiptLookup(row.data, binding.query.session, binding.identity),
    };
  }
  const data = object(row.data);
  const receipt = parseSessionStartReceiptLookup(
    data.start_receipt,
    binding.query.session,
    binding.identity,
  );
  if (receipt.status !== 'recorded')
    throw new TypeError('Start requires its original durable receipt');
  assertSessionStartCurrent(data, receipt, binding.identity);
  const sources = sourceRefs(data.source_refs);
  if (
    JSON.stringify(sources) !== JSON.stringify(refs) ||
    (row.etag !== undefined && parseEtag(row.etag) !== data.version)
  )
    throw new TypeError('Start sources or version mismatch');
  return {
    schema_version: 1,
    trace_id: traceId,
    source_refs: refs,
    ...(typeof row.etag === 'string' ? { etag: row.etag } : {}),
    data: {
      schema_version: 1,
      tenant_id: binding.identity.tenant_id,
      workspace_id: binding.identity.workspace_id,
      project_id: binding.identity.project_id,
      session_id: receipt.session_id,
      actor_id: receipt.actor_id,
      client_id: receipt.client_id,
      started_at: receipt.started_at,
      ...(receipt.parent_session_id === undefined
        ? {}
        : { parent_session_id: receipt.parent_session_id }),
      status: data.status as SessionStartResult['status'],
      version: data.version as number,
      ...(typeof data.ended_at === 'string' ? { ended_at: data.ended_at } : {}),
      trace_id: data.trace_id as string,
      source_refs: sources,
      start_receipt: receipt,
    },
  };
}
