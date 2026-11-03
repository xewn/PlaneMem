import { isUlid } from './ids.js';
import { assertSyncCommandIdentity } from './sync-command-context.js';
import {
  parseSyncAcknowledgement,
  parseSyncAcknowledgementEnvelope,
  parseSyncCursorEnvelope,
  parseSyncCursorNumber,
  type SyncAcknowledgement,
  type SyncAcknowledgementEnvelope,
  type SyncCursorEnvelope,
} from './sync-cursor.js';
import {
  parseSyncSavedPageFile,
  SYNC_SAVED_PAGE_FILE_BYTES,
  type SyncSavedPageFile,
} from './sync-saved-page.js';
import { syncJsonSnapshot } from './sync-upload-receipt.js';

export interface SyncInboxAcknowledgement {
  record_id: string;
  attempt_sequence: number;
  document_sha256: string;
  request_trace_id: string;
  command: SyncAcknowledgement;
  state: 'unconfirmed' | 'confirmed' | 'observed';
  response: SyncAcknowledgementEnvelope | null;
  observation: SyncCursorEnvelope | null;
}
export interface SyncInboxAcknowledgementDispatch {
  dispatch_id: string;
  record_id: string;
  dispatch_sequence: number;
  invocation_trace_id: string;
  started_at_ms: number;
  lease_until_ms: number;
  state: 'active' | 'unknown' | 'expired' | 'confirmed';
  response: SyncAcknowledgementEnvelope | null;
}
export interface SyncInboxAcknowledgementRecovery {
  recovery_id: string;
  record_id: string;
  first_dispatch_id: string;
  invocation_trace_id: string;
  registered_at_ms: number;
  prior_local_dispatch_history: 'absent';
  prior_remote_outcome: 'unknown';
}
export interface SyncAckEvidenceDocumentV1 {
  schema_version: 1;
  kind: 'workctx.sync-ack-evidence';
  page: SyncSavedPageFile;
  record: SyncInboxAcknowledgement;
  /** Null means no dispatch was selected for export, not that no dispatch ever existed. */
  dispatch: SyncInboxAcknowledgementDispatch | null;
}
export interface SyncAckEvidenceDocumentV2 {
  schema_version: 2;
  kind: 'workctx.sync-ack-evidence';
  page: SyncSavedPageFile;
  record: SyncInboxAcknowledgement;
  /** V2 specifically includes the recovery's first locally recorded dispatch. */
  dispatch: SyncInboxAcknowledgementDispatch;
  recovery: SyncInboxAcknowledgementRecovery;
}
export type SyncAckEvidenceDocument = SyncAckEvidenceDocumentV1 | SyncAckEvidenceDocumentV2;
export interface SyncAckEvidenceFile {
  document: SyncAckEvidenceDocument;
  document_sha256: string;
}
export const SYNC_ACK_EVIDENCE_DOCUMENT_BYTES = SYNC_SAVED_PAGE_FILE_BYTES + 160 * 1024;
export const SYNC_ACK_EVIDENCE_FILE_BYTES = SYNC_ACK_EVIDENCE_DOCUMENT_BYTES + 4096;

function row(value: unknown, keys: string[]): Record<string, unknown> {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).length !== keys.length ||
    Object.keys(value).some((key) => !keys.includes(key))
  )
    throw new TypeError('Invalid sync acknowledgement evidence fields');
  return value as Record<string, unknown>;
}
function digest(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) throw new TypeError();
  return value;
}
function traceText(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !value.trim() ||
    value.length > 1024 ||
    /[\u0000-\u001f\u007f\p{Cs}]/u.test(value)
  )
    throw new TypeError();
  return value;
}
function sequence(value: unknown): number {
  const parsed = parseSyncCursorNumber(value);
  if (parsed < 1) throw new TypeError();
  return parsed;
}
/** Historical evidence: expiry is checked structurally, not against the inspection clock. */
export function parseSyncInboxAcknowledgement(value: unknown): SyncInboxAcknowledgement {
  const input = row(JSON.parse(syncJsonSnapshot(value, 96 * 1024)), [
    'record_id',
    'attempt_sequence',
    'document_sha256',
    'request_trace_id',
    'command',
    'state',
    'response',
    'observation',
  ]);
  if (
    !isUlid(input.record_id) ||
    typeof input.state !== 'string' ||
    !['unconfirmed', 'confirmed', 'observed'].includes(input.state)
  )
    throw new TypeError();
  const command = parseSyncAcknowledgement(input.command);
  const request_trace_id = traceText(input.request_trace_id);
  const response =
    input.response === null
      ? null
      : parseSyncAcknowledgementEnvelope(input.response, command, request_trace_id);
  let observation: SyncCursorEnvelope | null = null;
  if (input.observation !== null) {
    if (
      !input.observation ||
      typeof input.observation !== 'object' ||
      Array.isArray(input.observation)
    )
      throw new TypeError();
    const raw = input.observation as Record<string, unknown>;
    observation = parseSyncCursorEnvelope(
      raw,
      command.expected_identity,
      traceText(raw.trace_id),
      command.expected_identity,
    );
  }
  if (
    (input.state === 'confirmed') !== (response !== null) ||
    (input.state === 'observed' &&
      (!observation?.data.recorded || observation.data.cursor < command.cursor)) ||
    (input.state === 'unconfirmed' &&
      observation?.data.recorded &&
      observation.data.cursor >= command.cursor)
  )
    throw new TypeError('Inconsistent historical acknowledgement state');
  return {
    record_id: input.record_id,
    attempt_sequence: sequence(input.attempt_sequence),
    document_sha256: digest(input.document_sha256),
    request_trace_id,
    command,
    state: input.state as SyncInboxAcknowledgement['state'],
    response,
    observation,
  };
}
export function parseSyncInboxAcknowledgementDispatch(
  value: unknown,
  original: SyncInboxAcknowledgement,
): SyncInboxAcknowledgementDispatch {
  const record = parseSyncInboxAcknowledgement(original);
  const input = row(JSON.parse(syncJsonSnapshot(value, 48 * 1024)), [
    'dispatch_id',
    'record_id',
    'dispatch_sequence',
    'invocation_trace_id',
    'started_at_ms',
    'lease_until_ms',
    'state',
    'response',
  ]);
  if (
    !isUlid(input.dispatch_id) ||
    input.record_id !== record.record_id ||
    typeof input.state !== 'string' ||
    !['active', 'unknown', 'expired', 'confirmed'].includes(input.state)
  )
    throw new TypeError();
  const started_at_ms = parseSyncCursorNumber(input.started_at_ms);
  const lease_until_ms = parseSyncCursorNumber(input.lease_until_ms);
  if (lease_until_ms - started_at_ms < 60001 || lease_until_ms - started_at_ms > 2147543647)
    throw new TypeError();
  const response =
    input.response === null
      ? null
      : parseSyncAcknowledgementEnvelope(input.response, record.command, record.request_trace_id);
  if (
    (input.state === 'confirmed') !== (response !== null) ||
    (response !== null && record.state !== 'confirmed')
  )
    throw new TypeError('Inconsistent historical dispatch state');
  return {
    dispatch_id: input.dispatch_id,
    record_id: record.record_id,
    dispatch_sequence: sequence(input.dispatch_sequence),
    invocation_trace_id: traceText(input.invocation_trace_id),
    started_at_ms,
    lease_until_ms,
    state: input.state as SyncInboxAcknowledgementDispatch['state'],
    response,
  };
}
/** Binds local recovery provenance; it cannot prove the absence of an earlier remote request. */
export function parseSyncInboxAcknowledgementRecovery(
  value: unknown,
  original: SyncInboxAcknowledgement,
  first: SyncInboxAcknowledgementDispatch,
): SyncInboxAcknowledgementRecovery {
  const record = parseSyncInboxAcknowledgement(original);
  const dispatch = parseSyncInboxAcknowledgementDispatch(first, record);
  const input = row(JSON.parse(syncJsonSnapshot(value, 16 * 1024)), [
    'recovery_id',
    'record_id',
    'first_dispatch_id',
    'invocation_trace_id',
    'registered_at_ms',
    'prior_local_dispatch_history',
    'prior_remote_outcome',
  ]);
  if (
    !isUlid(input.recovery_id) ||
    input.record_id !== record.record_id ||
    input.first_dispatch_id !== dispatch.dispatch_id ||
    input.prior_local_dispatch_history !== 'absent' ||
    input.prior_remote_outcome !== 'unknown'
  )
    throw new TypeError('Invalid original recovery binding');
  const invocation_trace_id = traceText(input.invocation_trace_id);
  const registered_at_ms = parseSyncCursorNumber(input.registered_at_ms);
  if (
    invocation_trace_id !== dispatch.invocation_trace_id ||
    registered_at_ms !== dispatch.started_at_ms
  )
    throw new TypeError('Recovery provenance differs from its first local dispatch');
  return {
    recovery_id: input.recovery_id,
    record_id: record.record_id,
    first_dispatch_id: dispatch.dispatch_id,
    invocation_trace_id,
    registered_at_ms,
    prior_local_dispatch_history: 'absent',
    prior_remote_outcome: 'unknown',
  };
}
export function parseSyncAckEvidenceDocument(value: unknown): SyncAckEvidenceDocument {
  const snapshot: unknown = JSON.parse(syncJsonSnapshot(value, SYNC_ACK_EVIDENCE_DOCUMENT_BYTES));
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) throw new TypeError();
  const version = (snapshot as Record<string, unknown>).schema_version;
  if (version !== 1 && version !== 2)
    throw new TypeError('Unsupported acknowledgement evidence version');
  const input = row(snapshot, [
    'schema_version',
    'kind',
    'page',
    'record',
    'dispatch',
    ...(version === 2 ? ['recovery'] : []),
  ]);
  if (input.kind !== 'workctx.sync-ack-evidence') throw new TypeError();
  const page = parseSyncSavedPageFile(input.page);
  const record = parseSyncInboxAcknowledgement(input.record);
  assertSyncCommandIdentity(record.command.expected_identity, page.document.expected_identity);
  if (
    record.document_sha256 !== page.document_sha256 ||
    record.command.cursor !== page.document.page.data.next_cursor
  )
    throw new TypeError('The original acknowledgement and complete saved page differ');
  const dispatch =
    input.dispatch === null ? null : parseSyncInboxAcknowledgementDispatch(input.dispatch, record);
  if (version === 2) {
    if (!dispatch) throw new TypeError('Recovery archives require the first local dispatch');
    return {
      schema_version: 2,
      kind: 'workctx.sync-ack-evidence',
      page,
      record,
      dispatch,
      recovery: parseSyncInboxAcknowledgementRecovery(input.recovery, record, dispatch),
    };
  }
  // Keep v1's exact field order and shape so existing canonical document digests stay stable.
  return {
    schema_version: 1,
    kind: 'workctx.sync-ack-evidence',
    page,
    record,
    dispatch,
  };
}
/** Fixed outer order; retained server/event field order follows the existing shared parsers. */
export function syncAckEvidenceDocumentJson(value: unknown): string {
  return syncJsonSnapshot(parseSyncAckEvidenceDocument(value), SYNC_ACK_EVIDENCE_DOCUMENT_BYTES);
}
/** Structural only: adapters MUST verify both document and embedded page SHA-256 independently. */
export function parseSyncAckEvidenceFile(value: unknown): SyncAckEvidenceFile {
  const input = row(JSON.parse(syncJsonSnapshot(value, SYNC_ACK_EVIDENCE_FILE_BYTES)), [
    'document',
    'document_sha256',
  ]);
  return {
    document: parseSyncAckEvidenceDocument(input.document),
    document_sha256: digest(input.document_sha256),
  };
}
