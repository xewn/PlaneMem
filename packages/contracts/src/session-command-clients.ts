import { isUlid } from './ids.js';
import { validateIdempotencyKey, validateSourceRef, type SourceRef } from './metadata.js';
import { parseEtag } from './versioning.js';
import {
  parseSessionCommandIdentity,
  type SessionCommandIdentity,
  type SessionRunRecord,
  type SessionToolCallRecord,
} from './session-activity.js';
import {
  parseSessionCommandReceiptQuery,
  parseSessionCommandReceiptLookup,
  type SessionCommandReceiptQuery,
  type SessionCommandReceiptLookup,
} from './session-command-receipts.js';

export type SessionActivityCreateOperation = 'run.start' | 'tool.call';
export interface SessionCommandBinding {
  session_id: string;
  identity: SessionCommandIdentity;
  query: SessionCommandReceiptQuery;
}
export type SessionCreatedRun = Omit<SessionRunRecord, 'status' | 'version'> & {
  schema_version: 1;
  status: 'running';
  version: 1;
  session_version: number;
};
export type SessionCreatedToolCall = Omit<SessionToolCallRecord, 'version'> & {
  schema_version: 1;
  version: 1;
  session_version: number;
};
export interface SessionCommandEnvelope<T> {
  schema_version: 1;
  trace_id: string;
  source_refs: SourceRef[];
  data: T;
  etag?: string;
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new TypeError('Expected session command data');
  return value as Record<string, unknown>;
}
function name(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    !!value.trim() &&
    value.length <= 1024 &&
    !/[\u0000-\u001f\u007f\p{Cs}]/u.test(value)
  );
}
/** New writes have a bounded field set. Historical queries preserve all original fields. */
export function parseSessionActivityCreateCommand(
  operation: SessionActivityCreateOperation,
  value: unknown,
): SessionCommandReceiptQuery['command'] {
  const row = object(value);
  if (operation !== 'run.start' && operation !== 'tool.call')
    throw new TypeError('Invalid activity creation operation');
  const allowed = [
    'expected_version',
    'session_id',
    'actor_id',
    'client_id',
    'idempotency_key',
    ...(operation === 'run.start' ? ['model'] : ['run_id', 'tool_name', 'status']),
  ];
  if (
    Object.keys(row).some((key) => !allowed.includes(key)) ||
    typeof row.expected_version !== 'number' ||
    !Number.isSafeInteger(row.expected_version) ||
    row.expected_version < 1 ||
    !Number.isSafeInteger(row.expected_version + 1) ||
    (row.session_id !== undefined && !isUlid(row.session_id)) ||
    (row.actor_id !== undefined && !name(row.actor_id)) ||
    (row.client_id !== undefined && !name(row.client_id))
  )
    throw new TypeError('Supply the original session version and only declared activity fields');
  if (row.idempotency_key !== undefined) validateIdempotencyKey(row.idempotency_key);
  if (operation === 'run.start' && row.model !== undefined && !name(row.model))
    throw new TypeError('model must be a nonblank name of at most 1024 characters');
  if (
    operation === 'tool.call' &&
    (!isUlid(row.run_id) ||
      !name(row.tool_name) ||
      !['started', 'succeeded', 'failed'].includes(row.status as string))
  )
    throw new TypeError('Supply the original run_id, nonblank tool_name and tool status');
  return { ...row, expected_version: row.expected_version };
}
/** expectedIdentity is a precondition, never authority for the authenticated request. */
export function parseSessionCommandBinding(
  sessionId: unknown,
  input: unknown,
  expectedIdentity: unknown,
  scope: { tenant_id: string; workspace_id: string; project_id?: string },
): SessionCommandBinding {
  if (!isUlid(sessionId)) throw new TypeError('session_id must be a ULID');
  const query = structuredClone(parseSessionCommandReceiptQuery(input));
  const identity = parseSessionCommandIdentity(expectedIdentity);
  if (
    identity.tenant_id !== scope.tenant_id ||
    identity.workspace_id !== scope.workspace_id ||
    identity.project_id !== scope.project_id
  )
    throw new TypeError('The original command belongs to another project');
  if (
    (query.command.session_id !== undefined && query.command.session_id !== sessionId) ||
    (query.command.actor_id !== undefined && query.command.actor_id !== identity.actor_id) ||
    (query.command.client_id !== undefined && query.command.client_id !== identity.client_id)
  )
    throw new TypeError('Original session or command identity does not match');
  return { session_id: sessionId, identity, query };
}
function envelope(value: unknown, trace: string) {
  const row = object(value);
  if (
    row.schema_version !== 1 ||
    typeof trace !== 'string' ||
    !trace.trim() ||
    row.trace_id !== trace ||
    !Array.isArray(row.source_refs)
  )
    throw new TypeError('Invalid session command envelope');
  return { row, sources: row.source_refs.map((source) => ({ ...validateSourceRef(source) })) };
}
export function parseSessionCommandReceiptEnvelope(
  value: unknown,
  binding: SessionCommandBinding,
  trace: string,
): SessionCommandEnvelope<SessionCommandReceiptLookup> {
  const { row, sources } = envelope(value, trace);
  if (sources.length !== 0 || row.etag !== undefined)
    throw new TypeError('A historical receipt cannot carry current resource metadata');
  return {
    schema_version: 1,
    trace_id: trace,
    source_refs: [],
    data: parseSessionCommandReceiptLookup(row.data, binding.session_id, binding.query),
  };
}
export function parseSessionActivityCreateEnvelope(
  value: unknown,
  binding: SessionCommandBinding,
  trace: string,
): SessionCommandEnvelope<SessionCreatedRun | SessionCreatedToolCall> {
  const operation = binding.query.operation;
  if (operation !== 'run.start' && operation !== 'tool.call')
    throw new TypeError('Expected an activity creation binding');
  const command = parseSessionActivityCreateCommand(operation, binding.query.command);
  const { row: outer, sources } = envelope(value, trace);
  const row = object(outer.data);
  for (const field of ['tenant_id', 'workspace_id', 'project_id'] as const)
    if (row[field] !== undefined && row[field] !== binding.identity[field])
      throw new TypeError('Activity creation scope differs from the original command');
  const expected =
    operation === 'run.start'
      ? { type: 'session', id: binding.session_id }
      : { type: 'agent-run', id: command.run_id };
  const sourceMatch = (value: unknown) =>
    Array.isArray(value) &&
    value.length === 1 &&
    value.every((raw) => {
      const source = validateSourceRef(raw);
      return (
        source.type === expected.type &&
        source.id === expected.id &&
        Object.keys(source).every((key) => key === 'type' || key === 'id')
      );
    });
  if (
    row.schema_version !== 1 ||
    row.session_id !== binding.session_id ||
    row.version !== 1 ||
    row.session_version !== command.expected_version + 1 ||
    !name(row.trace_id) ||
    !sourceMatch(sources) ||
    !sourceMatch(row.source_refs) ||
    (outer.etag !== undefined && parseEtag(outer.etag) !== 1)
  )
    throw new TypeError('Activity creation record does not match its original command');
  const record = {
    schema_version: 1 as const,
    session_id: binding.session_id,
    version: 1 as const,
    session_version: command.expected_version + 1,
    trace_id: row.trace_id,
    source_refs: sources.map((source) => ({ ...source })),
  };
  const base = {
    status: 'recorded',
    session_id: binding.session_id,
    operation,
    session_version: record.session_version,
    run_id: row.run_id,
  };
  let data: SessionCreatedRun | SessionCreatedToolCall;
  if (operation === 'run.start') {
    const receipt = parseSessionCommandReceiptLookup(
      { ...base, sequence: row.sequence },
      binding.session_id,
      binding.query,
    );
    if (
      receipt.status !== 'recorded' ||
      receipt.operation !== 'run.start' ||
      row.status !== 'running' ||
      row.model !== command.model
    )
      throw new TypeError('Run creation response mismatch');
    data = {
      ...record,
      run_id: receipt.run_id,
      sequence: receipt.sequence,
      status: 'running',
      ...(typeof command.model === 'string' ? { model: command.model } : {}),
    };
  } else {
    const receipt = parseSessionCommandReceiptLookup(
      { ...base, tool_call_id: row.tool_call_id },
      binding.session_id,
      binding.query,
    );
    if (
      receipt.status !== 'recorded' ||
      receipt.operation !== 'tool.call' ||
      row.tool_name !== command.tool_name ||
      row.status !== command.status
    )
      throw new TypeError('Tool creation response mismatch');
    data = {
      ...record,
      run_id: receipt.run_id,
      tool_call_id: receipt.tool_call_id,
      tool_name: command.tool_name as string,
      status: command.status as SessionCreatedToolCall['status'],
    };
  }
  return {
    schema_version: 1,
    trace_id: trace,
    source_refs: sources,
    data,
    ...(typeof outer.etag === 'string' ? { etag: outer.etag } : {}),
  };
}
