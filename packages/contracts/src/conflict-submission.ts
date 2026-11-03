import { isUlid } from './ids.js';
import { assertUtcTimestamp, validateSourceRef } from './metadata.js';
import { buildEtag } from './versioning.js';
import {
  conflictReceiptJson,
  parseConflictReceiptQuery,
  CONFLICT_RECEIPT_RESPONSE_BYTES,
  type ConflictReceiptQuery,
} from './conflict-receipt.js';

export const CONFLICT_SUBMISSION_RESPONSE_BYTES = CONFLICT_RECEIPT_RESPONSE_BYTES;
/** A locally normalized acknowledgement, never proof of a saved original-key binding. */
export interface ConflictSubmissionView {
  status: 'unconfirmed';
  original: ConflictReceiptQuery;
  next_action: 'check-original-receipt';
  source_application: 'not-checked';
}
export interface ConflictSubmissionEnvelope {
  schema_version: 1;
  trace_id: string;
  source_refs: [];
  data: ConflictSubmissionView;
}
function object(value: unknown, fields: string[]): Record<string, unknown> {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).some((key) => !fields.includes(key))
  )
    throw new TypeError('Invalid conflict submission fields');
  return value as Record<string, unknown>;
}
function text(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !value.trim() ||
    value.length > 1024 ||
    /[\u0000-\u001f\u007f\p{Cs}]/u.test(value)
  )
    throw new TypeError('Invalid conflict submission text');
  return value;
}
function version(value: unknown, positive = false): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < (positive ? 1 : 0))
    throw new TypeError('Invalid conflict submission version or cursor');
  return value;
}
function sources(value: unknown) {
  if (!Array.isArray(value)) throw new TypeError('Invalid conflict submission sources');
  return value.map((ref) => {
    object(ref, ['type', 'id', 'revision', 'uri']);
    return validateSourceRef(ref);
  });
}

/** Validate the complete existing resolve response, discard its copied values, and keep outcome unknown. */
export function parseConflictSubmissionResponse(
  value: unknown,
  original: ConflictReceiptQuery,
  trace: string,
): ConflictSubmissionEnvelope {
  const request = parseConflictReceiptQuery(original);
  conflictReceiptJson(value, CONFLICT_SUBMISSION_RESPONSE_BYTES);
  const row = object(value, [
    'schema_version',
    'trace_id',
    'source_refs',
    'data',
    'revision',
    'etag',
    'server_cursor',
  ]);
  const expected = request.command.expected_version + 1;
  if (
    row.schema_version !== 1 ||
    text(row.trace_id) !== text(trace) ||
    version(row.revision, true) !== expected ||
    row.etag !== buildEtag(expected)
  )
    throw new TypeError('Conflict submission envelope differs from the original request');
  version(row.server_cursor, true);
  const data = object(row.data, ['conflict_id', 'version', 'resolution', 'event']);
  if (
    data.conflict_id !== request.command.conflict_id ||
    version(data.version, true) !== expected ||
    data.resolution !== request.command.resolution
  )
    throw new TypeError('Conflict submission decision differs');
  const event = object(data.event, [
    'schema_version',
    'event_id',
    'event_type',
    'tenant_id',
    'workspace_id',
    'project_id',
    'aggregate_type',
    'aggregate_id',
    'aggregate_version',
    'actor_id',
    'client_id',
    'occurred_at',
    'trace_id',
    'source_refs',
    'sensitivity',
    'payload',
  ]);
  if (
    event.schema_version !== 1 ||
    !isUlid(event.event_id) ||
    event.event_type !== 'ConflictResolved' ||
    event.aggregate_type !== 'Conflict' ||
    version(event.aggregate_version, true) !== expected ||
    event.aggregate_id !==
      (isUlid(request.command.conflict_id) ? request.command.conflict_id : event.event_id) ||
    event.client_id !== request.identity.client_id ||
    event.actor_id !==
      (isUlid(request.identity.actor_id) ? request.identity.actor_id : undefined) ||
    !['public', 'internal', 'confidential', 'restricted'].includes(event.sensitivity as string)
  )
    throw new TypeError('Conflict submission event differs');
  for (const field of ['tenant_id', 'workspace_id', 'project_id'] as const)
    if (!isUlid(event[field]) || event[field] !== request.identity[field])
      throw new TypeError('Conflict submission scope differs');
  assertUtcTimestamp(event.occurred_at);
  if (new Date(event.occurred_at).toISOString() !== event.occurred_at)
    throw new TypeError('Invalid conflict submission timestamp');
  text(event.trace_id); // Replays retain the original event trace, independently of the current request trace.
  const refs = sources(event.source_refs);
  const outerRefs = sources(row.source_refs);
  const first = refs[0];
  if (
    !first ||
    first.type !== 'conflict' ||
    first.id !== request.command.conflict_id ||
    conflictReceiptJson(refs, CONFLICT_SUBMISSION_RESPONSE_BYTES) !==
      conflictReceiptJson(outerRefs, CONFLICT_SUBMISSION_RESPONSE_BYTES)
  )
    throw new TypeError('Conflict submission sources differ');
  const payload = object(event.payload, [
    'conflict_id',
    'entity_type',
    'entity_id',
    'field',
    'base_version',
    'local_version',
    'server_version',
    'resolution',
    'resolved_value',
    'actor_id',
  ]);
  if (
    payload.conflict_id !== request.command.conflict_id ||
    payload.resolution !== request.command.resolution ||
    payload.actor_id !== request.identity.actor_id ||
    !Object.hasOwn(payload, 'resolved_value')
  )
    throw new TypeError('Conflict submission event decision differs');
  for (const field of ['entity_type', 'entity_id', 'field'] as const) text(payload[field]);
  for (const field of ['base_version', 'local_version', 'server_version'] as const)
    version(payload[field]);
  if (
    request.command.resolution === 'merge' &&
    conflictReceiptJson(payload.resolved_value, CONFLICT_SUBMISSION_RESPONSE_BYTES) !==
      conflictReceiptJson(request.command.merged_value, CONFLICT_SUBMISSION_RESPONSE_BYTES)
  )
    throw new TypeError('Conflict submission merged value differs');
  return {
    schema_version: 1,
    trace_id: trace,
    source_refs: [],
    data: {
      status: 'unconfirmed',
      original: request,
      next_action: 'check-original-receipt',
      source_application: 'not-checked',
    },
  };
}
