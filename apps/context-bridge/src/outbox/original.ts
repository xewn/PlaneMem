import { createHash } from 'node:crypto';
import {
  isSyncIdentifier,
  MAX_SYNC_BATCH_BYTES,
  parseSyncCommandIdentity,
  snapshotSyncUploadBatch,
  assertSyncIdentityScope,
  validateIdempotencyKey,
  type Classification,
  type SourceRef,
  type SyncUploadEvent,
  type Ulid,
} from '@planemem/contracts';
import type { LocalEvent } from './sqlite.js';
import { reconciliationError } from './reconciliation.js';
export function fromRow(row: Record<string, unknown>): LocalEvent {
  const payload: unknown = JSON.parse(String(row.payload));
  const refs: unknown = JSON.parse(String(row.source_refs));
  if (
    typeof payload !== 'object' ||
    payload === null ||
    Array.isArray(payload) ||
    !Array.isArray(refs)
  )
    throw new TypeError('Invalid stored event');
  const identity =
    row.expected_actor_id == null && row.expected_client_id == null
      ? undefined
      : parseSyncCommandIdentity({
          tenant_id: row.tenant_id,
          workspace_id: row.workspace_id,
          project_id: row.project_id,
          actor_id: row.expected_actor_id,
          client_id: row.expected_client_id,
        });
  return {
    schema_version: 1,
    event_id: String(row.event_id),
    idempotency_key: String(row.idempotency_key),
    tenant_id: String(row.tenant_id) as Ulid,
    workspace_id: String(row.workspace_id) as Ulid,
    project_id: String(row.project_id) as Ulid,
    event_type: String(row.event_type),
    payload: payload as Record<string, unknown>,
    source_refs: refs as SourceRef[],
    ...(identity === undefined ? {} : { expected_identity: identity }),
    ...(row.command_checksum == null ? {} : { command_checksum: String(row.command_checksum) }),
    ...(row.sensitivity == null ? {} : { sensitivity: row.sensitivity as Classification }),
    ...(row.client_cursor == null ? {} : { client_cursor: Number(row.client_cursor) }),
    ...(row.server_event_id == null ? {} : { server_event_id: String(row.server_event_id) }),
    ...(row.server_cursor == null ? {} : { server_cursor: Number(row.server_cursor) }),
    ...(row.conflict_id == null ? {} : { conflict_id: String(row.conflict_id) }),
    ...(row.last_error == null ? {} : { last_error: String(row.last_error) }),
    attempt: Number(row.attempt),
    next_retry_at: String(row.next_retry_at),
    checksum: String(row.checksum),
    status: String(row.status) as LocalEvent['status'],
    trace_id: String(row.trace_id),
  };
}

export function checkedOriginalEvent(row: Record<string, unknown>, trace: string): LocalEvent {
  const invalid = () =>
    reconciliationError(
      'CORRUPT_RECORD',
      'The original local event or its delivery state cannot be decoded safely',
      trace,
    );
  let event: LocalEvent;
  try {
    for (const field of ['payload', 'source_refs'] as const)
      if (
        typeof row[field] !== 'string' ||
        Buffer.byteLength(row[field], 'utf8') > MAX_SYNC_BATCH_BYTES
      )
        throw invalid();
    if (
      !['pending', 'sending', 'sent', 'failed', 'conflict'].includes(String(row.status)) ||
      typeof row.attempt !== 'number' ||
      !Number.isSafeInteger(row.attempt) ||
      row.attempt < 0 ||
      typeof row.next_retry_at !== 'string' ||
      !Number.isFinite(Date.parse(row.next_retry_at)) ||
      new Date(row.next_retry_at).toISOString() !== row.next_retry_at ||
      (row.lease_token != null && !isSyncIdentifier(row.lease_token)) ||
      (row.status !== 'sending' && row.lease_token != null) ||
      (row.server_event_id != null && !isSyncIdentifier(row.server_event_id)) ||
      (row.conflict_id != null && !isSyncIdentifier(row.conflict_id)) ||
      (row.server_cursor != null &&
        (typeof row.server_cursor !== 'number' ||
          !Number.isSafeInteger(row.server_cursor) ||
          row.server_cursor < 1))
    )
      throw invalid();
    event = fromRow(row);
  } catch {
    throw invalid();
  }
  if (!event.expected_identity)
    throw reconciliationError(
      'OUTBOX_IDENTITY_REQUIRED',
      'The original sender is missing; preserve this legacy row without binding current credentials',
      trace,
    );
  if (!intact(event))
    throw reconciliationError(
      'CHECKSUM_MISMATCH',
      'The saved original command or payload changed; preserve this row',
      trace,
    );
  return event;
}

export function uploadEvent(event: LocalEvent): SyncUploadEvent {
  return {
    event_id: event.event_id,
    event_type: event.event_type,
    payload: event.payload,
    source_refs: event.source_refs,
    ...(event.sensitivity === undefined ? {} : { sensitivity: event.sensitivity }),
    ...(event.client_cursor === undefined ? {} : { client_cursor: event.client_cursor }),
  };
}

export function checksum(value: string): string {
  return 'sha256:' + createHash('sha256').update(value).digest('hex');
}

export function intact(event: LocalEvent): boolean {
  try {
    if (!event.expected_identity || event.command_checksum !== checksum(commandContent(event)))
      return false;
  } catch {
    return false;
  }
  const value = JSON.stringify(event.payload);
  if (event.checksum.length !== 15) return checksum(value) === event.checksum;
  // Earlier queue files labelled their eight-digit FNV checksum as sha256.
  let hash = 2166136261;
  for (const char of value) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return event.checksum === `sha256:${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

/** Local upload-command integrity; diagnostics/retry state are intentionally outside this digest. */
export function commandContent(event: LocalEvent): string {
  const identity = parseSyncCommandIdentity(event.expected_identity);
  assertSyncIdentityScope(identity, event);
  const original = snapshotSyncUploadBatch([uploadEvent(event)])[0]!;
  const stable = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(stable);
    if (value && typeof value === 'object')
      return Object.fromEntries(
        Object.entries(value)
          .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
          .map(([key, child]) => [key, stable(child)]),
      );
    return value;
  };
  return JSON.stringify(
    stable({
      identity,
      event: original,
      idempotency_key: validateIdempotencyKey(event.idempotency_key),
    }),
  );
}
