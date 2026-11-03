import {
  parseSyncAckEvidenceDocument,
  type SyncInboxAcknowledgement,
  type SyncInboxAcknowledgementDispatch,
} from './sync-ack-evidence.js';
import {
  parseSyncAcknowledgementEnvelope,
  parseSyncCursorEnvelope,
  type SyncAcknowledgementEnvelope,
  type SyncCursorEnvelope,
} from './sync-cursor.js';
import { SYNC_SAVED_PAGE_FILE_BYTES, type SyncSavedPageFile } from './sync-saved-page.js';
import { syncJsonSnapshot } from './sync-upload-receipt.js';

interface SyncAckResultBase {
  schema_version: 1;
  kind: 'workctx.sync-ack-result';
  page: SyncSavedPageFile;
  record_before_request: SyncInboxAcknowledgement;
  invocation_trace_id: string;
  /** Completed means the journal method returned, not that every received result was stored. */
  journal_update: 'completed' | 'unconfirmed';
}
export type SyncAckResultDocument = SyncAckResultBase &
  (
    | {
        server_result_kind: 'original-acknowledgement';
        dispatch_before_request: SyncInboxAcknowledgementDispatch;
        server_result: SyncAcknowledgementEnvelope;
      }
    | {
        server_result_kind: 'current-cursor';
        dispatch_before_request: null;
        server_result: SyncCursorEnvelope;
      }
  );
export interface SyncAckResultFile {
  document: SyncAckResultDocument;
  document_sha256: string;
}
export const SYNC_ACK_RESULT_DOCUMENT_BYTES = SYNC_SAVED_PAGE_FILE_BYTES + 192 * 1024;
export const SYNC_ACK_RESULT_FILE_BYTES = SYNC_ACK_RESULT_DOCUMENT_BYTES + 4096;

function row(value: unknown, keys: string[]): Record<string, unknown> {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).length !== keys.length ||
    Object.keys(value).some((key) => !keys.includes(key))
  )
    throw new TypeError('Invalid acknowledgement result fields');
  return value as Record<string, unknown>;
}

/** A captured result is independent of the journal snapshot and never upgrades its state. */
export function parseSyncAckResultDocument(value: unknown): SyncAckResultDocument {
  const input = row(JSON.parse(syncJsonSnapshot(value, SYNC_ACK_RESULT_DOCUMENT_BYTES)), [
    'schema_version',
    'kind',
    'page',
    'record_before_request',
    'dispatch_before_request',
    'invocation_trace_id',
    'server_result_kind',
    'server_result',
    'journal_update',
  ]);
  if (
    input.schema_version !== 1 ||
    input.kind !== 'workctx.sync-ack-result' ||
    (input.journal_update !== 'completed' && input.journal_update !== 'unconfirmed') ||
    typeof input.invocation_trace_id !== 'string' ||
    !input.invocation_trace_id.trim() ||
    input.invocation_trace_id.length > 1024 ||
    /[\u0000-\u001f\u007f\p{Cs}]/u.test(input.invocation_trace_id)
  )
    throw new TypeError();
  const original = parseSyncAckEvidenceDocument({
    schema_version: 1,
    kind: 'workctx.sync-ack-evidence',
    page: input.page,
    record: input.record_before_request,
    dispatch: input.dispatch_before_request,
  });
  if (original.record.state !== 'unconfirmed')
    throw new TypeError('A new result requires the unresolved original request snapshot');
  const base: SyncAckResultBase = {
    schema_version: 1,
    kind: 'workctx.sync-ack-result',
    page: original.page,
    record_before_request: original.record,
    invocation_trace_id: input.invocation_trace_id,
    journal_update: input.journal_update,
  };
  if (input.server_result_kind === 'original-acknowledgement') {
    if (
      !original.dispatch ||
      original.dispatch.state !== 'active' ||
      original.dispatch.invocation_trace_id !== base.invocation_trace_id
    )
      throw new TypeError('The result must bind the original active dispatch and invocation');
    return {
      ...base,
      dispatch_before_request: original.dispatch,
      server_result_kind: 'original-acknowledgement',
      server_result: parseSyncAcknowledgementEnvelope(
        input.server_result,
        original.record.command,
        original.record.request_trace_id,
      ),
    };
  }
  if (input.server_result_kind !== 'current-cursor' || original.dispatch !== null)
    throw new TypeError('Cursor observations cannot claim an acknowledgement dispatch');
  return {
    ...base,
    dispatch_before_request: null,
    server_result_kind: 'current-cursor',
    // Historical metadata only; expiry is checked on receipt by the caller, not on offline read.
    server_result: parseSyncCursorEnvelope(
      input.server_result,
      original.record.command.expected_identity,
      base.invocation_trace_id,
      original.record.command.expected_identity,
    ),
  };
}
export function syncAckResultDocumentJson(value: unknown): string {
  return syncJsonSnapshot(parseSyncAckResultDocument(value), SYNC_ACK_RESULT_DOCUMENT_BYTES);
}
/** Structural parsing only; the file adapter must independently verify both SHA-256 digests. */
export function parseSyncAckResultFile(value: unknown): SyncAckResultFile {
  const input = row(JSON.parse(syncJsonSnapshot(value, SYNC_ACK_RESULT_FILE_BYTES)), [
    'document',
    'document_sha256',
  ]);
  if (typeof input.document_sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(input.document_sha256))
    throw new TypeError();
  return {
    document: parseSyncAckResultDocument(input.document),
    document_sha256: input.document_sha256,
  };
}
