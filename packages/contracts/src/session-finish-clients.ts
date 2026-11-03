import { isUlid } from './ids.js';
import { validateIdempotencyKey, validateSourceRef, type SourceRef } from './metadata.js';
import { parseEtag } from './versioning.js';
import { parseSessionResumeOrigin, type SessionResumeOrigin } from './session-resume.js';
import { parseSessionCommandReceiptLookup } from './session-command-receipts.js';
import type { SessionCommandReceiptQuery } from './session-command-receipts.js';
import type { SessionCommandBinding, SessionCommandEnvelope } from './session-command-clients.js';
import type { SessionRunRecord, SessionToolCallRecord } from './session-activity.js';

export type SessionFinishOperation = 'run.finish' | 'tool.finish' | 'end';
export type SessionFinishedRun = SessionRunRecord & {
  schema_version: 1;
  status: 'completed' | 'failed';
  session_version: number;
};
export type SessionFinishedToolCall = SessionToolCallRecord & {
  schema_version: 1;
  status: 'succeeded' | 'failed';
  session_version: number;
};
export interface SessionEndedRecord {
  schema_version: 1;
  tenant_id: string;
  workspace_id: string;
  project_id: string;
  session_id: string;
  actor_id: string;
  client_id: string;
  parent_session_id?: string;
  resume_origin?: SessionResumeOrigin;
  status: 'ended' | 'abandoned' | 'failed';
  version: number;
  started_at: string;
  ended_at: string;
  trace_id: string;
  source_refs: SourceRef[];
}
export type SessionFinishedRecord =
  | SessionFinishedRun
  | SessionFinishedToolCall
  | SessionEndedRecord;
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new TypeError('Expected session result data');
  return value as Record<string, unknown>;
}
function positive(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 1;
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
  return typeof value === 'string' && value.length <= 128 && Number.isFinite(Date.parse(value));
}
export function parseSessionFinishCommand(
  operation: SessionFinishOperation,
  value: unknown,
): SessionCommandReceiptQuery['command'] {
  if (!['run.finish', 'tool.finish', 'end'].includes(operation))
    throw new TypeError('Invalid result operation');
  const row = object(value);
  const allowed = [
    'session_id',
    'actor_id',
    'client_id',
    'idempotency_key',
    'expected_version',
    'status',
    ...(operation === 'run.finish'
      ? ['run_id', 'expected_run_version']
      : operation === 'tool.finish'
        ? ['tool_call_id', 'expected_tool_version']
        : []),
  ];
  if (
    Object.keys(row).some((key) => !allowed.includes(key)) ||
    !positive(row.expected_version) ||
    (row.session_id !== undefined && !isUlid(row.session_id)) ||
    (row.actor_id !== undefined && !identifier(row.actor_id)) ||
    (row.client_id !== undefined && !identifier(row.client_id))
  )
    throw new TypeError('Supply only declared result fields and the original session version');
  if (row.idempotency_key !== undefined) validateIdempotencyKey(row.idempotency_key);
  if (
    operation === 'run.finish' &&
    (!isUlid(row.run_id) ||
      !positive(row.expected_run_version) ||
      !['completed', 'failed'].includes(row.status as string))
  )
    throw new TypeError(
      'Supply the original run_id, expected_run_version and completed/failed status',
    );
  if (
    operation === 'tool.finish' &&
    (!isUlid(row.tool_call_id) ||
      !positive(row.expected_tool_version) ||
      !['succeeded', 'failed'].includes(row.status as string))
  )
    throw new TypeError(
      'Supply the original tool_call_id, expected_tool_version and succeeded/failed status',
    );
  if (operation === 'end' && !['ended', 'abandoned', 'failed'].includes(row.status as string))
    throw new TypeError('Supply the original ended/abandoned/failed status');
  // The maximum safe version is valid for an already-matching terminal result (delta zero).
  return { ...row, expected_version: row.expected_version };
}
function sources(value: unknown): SourceRef[] {
  if (!Array.isArray(value) || value.length > 200 || Object.keys(value).length !== value.length)
    throw new TypeError('Invalid result sources');
  return value.map((raw) => {
    const source = validateSourceRef(raw);
    return {
      type: source.type,
      id: source.id,
      ...(source.revision === undefined ? {} : { revision: source.revision }),
      ...(source.uri === undefined ? {} : { uri: source.uri }),
    };
  });
}
/** A successful finish response is the original historical result, including no-change results. */
export function parseSessionFinishEnvelope(
  value: unknown,
  binding: SessionCommandBinding,
  trace: string,
): SessionCommandEnvelope<SessionFinishedRecord> {
  const operation = binding.query.operation;
  if (operation !== 'run.finish' && operation !== 'tool.finish' && operation !== 'end')
    throw new TypeError('Expected a finish binding');
  const command = parseSessionFinishCommand(operation, binding.query.command);
  const outer = object(value);
  const row = object(outer.data);
  const refs = sources(outer.source_refs);
  const recordRefs = sources(row.source_refs);
  if (
    outer.schema_version !== 1 ||
    !identifier(trace) ||
    outer.trace_id !== trace ||
    row.schema_version !== 1 ||
    row.session_id !== binding.session_id ||
    !positive(row.version) ||
    !identifier(row.trace_id) ||
    JSON.stringify(refs) !== JSON.stringify(recordRefs) ||
    (outer.etag !== undefined && parseEtag(outer.etag) !== row.version)
  )
    throw new TypeError('Session result envelope does not match its original request');
  for (const field of ['tenant_id', 'workspace_id', 'project_id'] as const)
    if ((operation === 'end' || row[field] !== undefined) && row[field] !== binding.identity[field])
      throw new TypeError('Session result scope mismatch');
  const metadata = {
    schema_version: 1 as const,
    session_id: binding.session_id,
    version: row.version,
    trace_id: row.trace_id,
    source_refs: recordRefs,
  };
  let data: SessionFinishedRecord;
  if (operation === 'end') {
    const receipt = parseSessionCommandReceiptLookup(
      {
        status: 'recorded',
        operation,
        session_id: binding.session_id,
        session_version: row.version,
        ended_status: row.status,
      },
      binding.session_id,
      binding.query,
    );
    if (
      receipt.status !== 'recorded' ||
      receipt.operation !== 'end' ||
      !identifier(row.actor_id) ||
      !identifier(row.client_id) ||
      !timestamp(row.started_at) ||
      !timestamp(row.ended_at) ||
      Date.parse(row.ended_at) < Date.parse(row.started_at) ||
      (row.parent_session_id !== undefined &&
        (!isUlid(row.parent_session_id) || row.parent_session_id === binding.session_id)) ||
      (row.resume_origin !== undefined && row.parent_session_id === undefined) ||
      !recordRefs.some((source) => source.type === 'session' && source.id === row.client_id)
    )
      throw new TypeError('Invalid historical session closure');
    // These are the original session creator's identifiers, not the closing caller's identity.
    data = {
      ...metadata,
      tenant_id: binding.identity.tenant_id,
      workspace_id: binding.identity.workspace_id,
      project_id: binding.identity.project_id,
      actor_id: row.actor_id,
      client_id: row.client_id,
      status: receipt.ended_status,
      started_at: row.started_at,
      ended_at: row.ended_at,
      ...(typeof row.parent_session_id === 'string'
        ? { parent_session_id: row.parent_session_id }
        : {}),
      ...(row.resume_origin === undefined
        ? {}
        : { resume_origin: parseSessionResumeOrigin(row.resume_origin) }),
    };
  } else if (operation === 'run.finish') {
    const receipt = parseSessionCommandReceiptLookup(
      {
        status: 'recorded',
        operation,
        session_id: binding.session_id,
        session_version: row.session_version,
        run_id: row.run_id,
        run_version: row.version,
        run_status: row.status,
        changed: row.version === (command.expected_run_version as number) + 1,
      },
      binding.session_id,
      binding.query,
    );
    if (
      receipt.status !== 'recorded' ||
      receipt.operation !== 'run.finish' ||
      !positive(row.sequence) ||
      row.sequence > 2147483647 ||
      (row.model !== undefined && typeof row.model !== 'string') ||
      !recordRefs.some((source) => source.type === 'session' && source.id === binding.session_id)
    )
      throw new TypeError('Invalid historical run result');
    data = {
      ...metadata,
      run_id: receipt.run_id,
      status: receipt.run_status,
      session_version: receipt.session_version,
      sequence: row.sequence,
      ...(typeof row.model === 'string' ? { model: row.model } : {}),
    };
  } else {
    const receipt = parseSessionCommandReceiptLookup(
      {
        status: 'recorded',
        operation,
        session_id: binding.session_id,
        session_version: row.session_version,
        tool_call_id: row.tool_call_id,
        run_id: row.run_id,
        tool_version: row.version,
        tool_status: row.status,
        changed: row.version === (command.expected_tool_version as number) + 1,
      },
      binding.session_id,
      binding.query,
    );
    if (
      receipt.status !== 'recorded' ||
      receipt.operation !== 'tool.finish' ||
      typeof row.tool_name !== 'string' ||
      !row.tool_name.trim() ||
      recordRefs.length !== 1 ||
      recordRefs[0]?.type !== 'agent-run' ||
      recordRefs[0]?.id !== receipt.run_id
    )
      throw new TypeError('Invalid historical tool result');
    data = {
      ...metadata,
      tool_call_id: receipt.tool_call_id,
      run_id: receipt.run_id,
      tool_name: row.tool_name,
      status: receipt.tool_status,
      session_version: receipt.session_version,
    };
  }
  return {
    schema_version: 1,
    trace_id: trace,
    source_refs: refs,
    data,
    ...(typeof outer.etag === 'string' ? { etag: outer.etag } : {}),
  };
}
