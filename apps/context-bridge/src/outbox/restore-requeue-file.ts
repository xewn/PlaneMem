import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { ContractError, isSyncIdentifier, syncJsonSnapshot } from '@planemem/contracts';
import { OUTBOX_ARCHIVE_FILE_BYTES } from './archive.js';
import { parseOutboxReadScope } from './reading.js';
import {
  assertOutboxRestoreTrace,
  outboxRestoreBudget,
  outboxVerifiedRestoreRecord,
  parseOutboxRestoreQuery,
} from './restore.js';
import { parseOutboxRestoreRequeueReceiptQuery } from './restore-requeue-query.js';
import {
  outboxRequeueReceiptCandidate,
  type OutboxRestoreRequeueReceipt,
} from './restore-requeue-receipt.js';
import type { OutboxScope } from './sqlite.js';
export { parseOutboxRestoreRequeueSelection } from './restore-requeue-query.js';

export const OUTBOX_REQUEUE_DOCUMENT_BYTES = OUTBOX_ARCHIVE_FILE_BYTES + 128 * 1024;
export const OUTBOX_REQUEUE_FILE_BYTES = OUTBOX_REQUEUE_DOCUMENT_BYTES + 8192;
export interface OutboxRestoreRequeueDocument {
  schema_version: 1;
  kind: 'workctx.sync-outbox-restore-requeue-receipt';
  scope: OutboxScope;
  observed_at: string;
  export_trace_id: string;
  receipt: OutboxRestoreRequeueReceipt;
  parent: ReturnType<typeof outboxVerifiedRestoreRecord>;
}
export interface OutboxRestoreRequeueFile {
  document: OutboxRestoreRequeueDocument;
  document_sha256: string;
}
function object(input: unknown, keys?: string[]): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TypeError();
  if (
    keys &&
    (Object.keys(input).length !== keys.length ||
      Object.keys(input).some((key) => !keys.includes(key)))
  )
    throw new TypeError();
  return input as Record<string, unknown>;
}
const hash = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');
const digest = (value: unknown): value is string =>
  typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
function fail(code: string, message: string, trace: string, details: Record<string, unknown> = {}) {
  return new ContractError(code, message, { trace_id: trace, retryable: false, details });
}

/** Detached complete history; no native SQLite import, IO or trust in supplied receipt markers. */
export function createOutboxRestoreRequeueFile(
  input: unknown,
  trace: string,
  check: () => void = outboxRestoreBudget(trace),
): OutboxRestoreRequeueFile {
  let selected_requeue_id: string | null = null;
  let selected_restore_id: string | null = null;
  try {
    check();
    const row = object(JSON.parse(syncJsonSnapshot(input, OUTBOX_REQUEUE_DOCUMENT_BYTES)), [
      'schema_version',
      'kind',
      'scope',
      'observed_at',
      'export_trace_id',
      'receipt',
      'parent',
    ]);
    if (
      row.schema_version !== 1 ||
      row.kind !== 'workctx.sync-outbox-restore-requeue-receipt' ||
      typeof row.observed_at !== 'string' ||
      !Number.isFinite(Date.parse(row.observed_at)) ||
      new Date(row.observed_at).toISOString() !== row.observed_at ||
      typeof row.export_trace_id !== 'string'
    )
      throw new TypeError();
    assertOutboxRestoreTrace(row.export_trace_id);
    const scope = parseOutboxReadScope(row.scope, trace);
    const receipt = object(row.receipt);
    const query = parseOutboxRestoreRequeueReceiptQuery(receipt.query, trace);
    selected_requeue_id = query.requeue_id;
    selected_restore_id = query.restore_id;
    if (!isDeepStrictEqual(query.scope, scope)) throw new TypeError();
    const parentInput = object(row.parent, ['receipt', 'source']);
    const parentReceipt = object(parentInput.receipt);
    const parentQuery = parseOutboxRestoreQuery(parentReceipt.query, trace);
    if (
      !isDeepStrictEqual(parentQuery.scope, scope) ||
      parentQuery.restore_id !== query.restore_id ||
      parentQuery.archive_sha256 !== query.archive_sha256
    )
      throw new TypeError();
    check();
    const parent = outboxVerifiedRestoreRecord(
      parentQuery,
      parentInput.source,
      parentReceipt.restored_at,
      parentReceipt.restore_trace_id,
      parentReceipt.restored_document_sha256,
      trace,
    );
    if (
      !isDeepStrictEqual(parentReceipt, parent.receipt) ||
      typeof receipt.requeued_at !== 'string' ||
      typeof receipt.requeue_trace_id !== 'string'
    )
      throw new TypeError();
    check();
    const recorded = outboxRequeueReceiptCandidate(
      query,
      parent.source,
      parent.receipt,
      receipt.requeued_at,
      receipt.requeue_trace_id,
      trace,
      check,
    );
    if (!isDeepStrictEqual(receipt, recorded)) throw new TypeError();
    const document: OutboxRestoreRequeueDocument = {
      schema_version: 1,
      kind: 'workctx.sync-outbox-restore-requeue-receipt',
      scope,
      observed_at: row.observed_at,
      export_trace_id: row.export_trace_id,
      receipt: recorded,
      parent,
    };
    const file = {
      document,
      document_sha256: hash(syncJsonSnapshot(document, OUTBOX_REQUEUE_DOCUMENT_BYTES)),
    };
    check();
    return file;
  } catch (error) {
    throw fail(
      error instanceof ContractError ? error.envelope.code : 'OUTBOX_REQUEUE_FILE_INVALID',
      error instanceof ContractError
        ? error.envelope.message
        : 'The complete requeue file, parent history or selected-record digests are invalid',
      trace,
      {
        ...(error instanceof ContractError ? error.envelope.details : {}),
        selected_requeue_id,
        selected_restore_id,
      },
    );
  }
}
export function verifyOutboxRestoreRequeueFile(
  input: unknown,
  trace: string,
): OutboxRestoreRequeueFile {
  const check = outboxRestoreBudget(trace);
  try {
    const row = object(JSON.parse(syncJsonSnapshot(input, OUTBOX_REQUEUE_FILE_BYTES)), [
      'document',
      'document_sha256',
    ]);
    if (!digest(row.document_sha256)) throw new TypeError();
    const saved = createOutboxRestoreRequeueFile(row.document, trace, check);
    if (saved.document_sha256 !== row.document_sha256) throw new TypeError();
    check();
    return saved;
  } catch (error) {
    if (error instanceof ContractError) throw error;
    throw fail(
      'OUTBOX_REQUEUE_FILE_INVALID',
      'The complete requeue file structure or document digest is invalid',
      trace,
    );
  }
}

/** Only use after full verification. No source event bodies or lease values appear here. */
export function outboxRestoreRequeueFileSummary(file: OutboxRestoreRequeueFile) {
  const { document, document_sha256 } = file;
  const receipt = document.receipt;
  return {
    scope: document.scope,
    document_sha256,
    requeue_id: receipt.query.requeue_id,
    restore_id: receipt.query.restore_id,
    query_sha256: receipt.query_sha256,
    archive_sha256: receipt.query.archive_sha256,
    before_sha256: receipt.before_sha256,
    after_sha256: receipt.after_sha256,
    restore_receipt_sha256: receipt.restore_receipt_sha256,
    restore_document_sha256: receipt.restore_document_sha256,
    selected_records: receipt.selected_records,
    archived_records: document.parent.receipt.records,
    requeued_at: receipt.requeued_at,
    requeue_trace_id: receipt.requeue_trace_id,
    observed_at: document.observed_at,
    export_trace_id: document.export_trace_id,
    get_query: { document_sha256, requeue_id: receipt.query.requeue_id },
    import_query: { scope: document.scope, document_sha256, requeue_id: receipt.query.requeue_id },
    observation: 'archived-local-requeue-history' as const,
    archive_integrity: 'verified' as const,
    current_queue: 'not-checked' as const,
    current_control: 'not-checked' as const,
    server_delivery: 'not-checked' as const,
    source_authenticity: 'not-proven' as const,
    sender_stopped: 'not-proven' as const,
    local_commit: 'not-attempted' as const,
  };
}
export function parseOutboxRestoreRequeueFileSelection(input: unknown, trace: string) {
  try {
    const row = object(JSON.parse(syncJsonSnapshot(input, 16384)), [
      'document_sha256',
      'requeue_id',
    ]);
    if (!digest(row.document_sha256) || !isSyncIdentifier(row.requeue_id)) throw new TypeError();
    return { document_sha256: row.document_sha256, requeue_id: row.requeue_id };
  } catch {
    throw fail(
      'OUTBOX_REQUEUE_FILE_SELECTION_INVALID',
      'Supply exactly the original document_sha256 and requeue_id',
      trace,
    );
  }
}
export interface OutboxRestoreRequeueImportQuery {
  scope: OutboxScope;
  document_sha256: string;
  requeue_id: string;
}
export function parseOutboxRestoreRequeueImportQuery(
  input: unknown,
  trace: string,
): OutboxRestoreRequeueImportQuery {
  try {
    const row = object(JSON.parse(syncJsonSnapshot(input, 16384)), [
      'scope',
      'document_sha256',
      'requeue_id',
    ]);
    if (!digest(row.document_sha256) || !isSyncIdentifier(row.requeue_id)) throw new TypeError();
    return {
      scope: parseOutboxReadScope(row.scope, trace),
      document_sha256: row.document_sha256,
      requeue_id: row.requeue_id,
    };
  } catch (error) {
    throw fail(
      'OUTBOX_REQUEUE_IMPORT_QUERY_INVALID',
      'Supply exactly scope, the original document_sha256 and requeue_id',
      trace,
      error instanceof ContractError
        ? { ...error.envelope.details, cause_code: error.envelope.code }
        : {},
    );
  }
}
export function readOutboxRestoreRequeueFileEntry(
  input: unknown,
  selection: unknown,
  trace: string,
) {
  const query = parseOutboxRestoreRequeueFileSelection(selection, trace);
  try {
    const file = verifyOutboxRestoreRequeueFile(input, trace);
    if (
      query.document_sha256 !== file.document_sha256 ||
      query.requeue_id !== file.document.receipt.query.requeue_id
    )
      throw fail(
        'OUTBOX_REQUEUE_FILE_SELECTION_CHANGED',
        'The file differs from the selected document or batch; retain the original selection',
        trace,
        {
          observed_document_sha256: file.document_sha256,
          observed_requeue_id: file.document.receipt.query.requeue_id,
        },
      );
    const result = {
      ...outboxRestoreRequeueFileSummary(file),
      query,
      original_query: file.document.receipt.query,
      receipt: file.document.receipt,
    };
    syncJsonSnapshot(result, 128 * 1024);
    return result;
  } catch (error) {
    throw fail(
      error instanceof ContractError ? error.envelope.code : 'OUTBOX_REQUEUE_FILE_ACCESS_FAILED',
      error instanceof ContractError
        ? error.envelope.message
        : 'The original request could not be read from the complete file',
      trace,
      { ...(error instanceof ContractError ? error.envelope.details : {}), query },
    );
  }
}
