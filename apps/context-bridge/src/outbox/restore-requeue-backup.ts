import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { ContractError, isSyncIdentifier, syncJsonSnapshot } from '@planemem/contracts';
import type { OutboxScope } from './sqlite.js';
import { parseOutboxReadScope } from './reading.js';
import { parseOutboxRestoreAuditQuery } from './restore-audit.js';
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
import {
  createOutboxRestoreRequeueFile,
  outboxRestoreRequeueFileSummary,
} from './restore-requeue-file.js';

export const OUTBOX_REQUEUE_BACKUP_MAX_RECEIPTS = 100;
export const OUTBOX_REQUEUE_BACKUP_DOCUMENT_BYTES = 64 * 1024 * 1024;
export const OUTBOX_REQUEUE_BACKUP_FILE_BYTES = OUTBOX_REQUEUE_BACKUP_DOCUMENT_BYTES + 8192;
export type OutboxRequeueBackupParent = ReturnType<typeof outboxVerifiedRestoreRecord>;
export interface OutboxRestoreRequeueBackupDocument {
  schema_version: 1;
  kind: 'workctx.sync-outbox-requeue-history';
  scope: OutboxScope;
  observed_at: string;
  export_trace_id: string;
  parents: OutboxRequeueBackupParent[];
  receipts: OutboxRestoreRequeueReceipt[];
}
export interface OutboxRestoreRequeueBackupFile {
  document: OutboxRestoreRequeueBackupDocument;
  document_sha256: string;
}
function fail(code: string, message: string, trace: string, details: Record<string, unknown> = {}) {
  return new ContractError(code, message, { trace_id: trace, retryable: false, details });
}
function object(input: unknown, keys?: string[]) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TypeError();
  if (
    keys &&
    (Object.keys(input).length !== keys.length ||
      Object.keys(input).some((key) => !keys.includes(key)))
  )
    throw new TypeError();
  return input as Record<string, unknown>;
}
export function parseOutboxRestoreRequeueBackupQuery(input: unknown, trace: string) {
  try {
    const query = parseOutboxRestoreAuditQuery(input, trace);
    if (query.max_receipts > OUTBOX_REQUEUE_BACKUP_MAX_RECEIPTS) throw new TypeError();
    return query;
  } catch (error) {
    throw fail(
      'OUTBOX_REQUEUE_BACKUP_QUERY_INVALID',
      'Supply scope and optional max_receipts (1–100), max_bytes (1–536870912), timeout_ms (1–90000)',
      trace,
      error instanceof ContractError
        ? { ...error.envelope.details, cause_code: error.envelope.code }
        : {},
    );
  }
}

/** Full detached collection verification; parent bodies are stored once and all must be referenced. */
export function createOutboxRestoreRequeueBackup(
  input: unknown,
  trace: string,
  check: () => void = outboxRestoreBudget(trace),
): OutboxRestoreRequeueBackupFile {
  let selected_restore_id: string | null = null;
  let selected_requeue_id: string | null = null;
  let stage = 'document';
  try {
    check();
    const row = object(JSON.parse(syncJsonSnapshot(input, OUTBOX_REQUEUE_BACKUP_DOCUMENT_BYTES)), [
      'schema_version',
      'kind',
      'scope',
      'observed_at',
      'export_trace_id',
      'parents',
      'receipts',
    ]);
    if (
      row.schema_version !== 1 ||
      row.kind !== 'workctx.sync-outbox-requeue-history' ||
      typeof row.observed_at !== 'string' ||
      !Number.isFinite(Date.parse(row.observed_at)) ||
      new Date(row.observed_at).toISOString() !== row.observed_at ||
      typeof row.export_trace_id !== 'string' ||
      !Array.isArray(row.parents) ||
      !Array.isArray(row.receipts) ||
      row.parents.length > OUTBOX_REQUEUE_BACKUP_MAX_RECEIPTS ||
      row.receipts.length > OUTBOX_REQUEUE_BACKUP_MAX_RECEIPTS
    )
      throw new TypeError();
    assertOutboxRestoreTrace(row.export_trace_id);
    const scope = parseOutboxReadScope(row.scope, trace);
    const byId = new Map<string, OutboxRequeueBackupParent>();
    let previous: string | undefined;
    stage = 'parents';
    const parents = row.parents.map((input) => {
      check();
      selected_restore_id = null;
      const entry = object(input, ['receipt', 'source']);
      const saved = object(entry.receipt);
      const query = parseOutboxRestoreQuery(saved.query, trace);
      selected_restore_id = query.restore_id;
      if (
        !isDeepStrictEqual(query.scope, scope) ||
        (previous !== undefined &&
          Buffer.compare(Buffer.from(previous), Buffer.from(query.restore_id)) >= 0)
      )
        throw new TypeError();
      const parent = outboxVerifiedRestoreRecord(
        query,
        entry.source,
        saved.restored_at,
        saved.restore_trace_id,
        saved.restored_document_sha256,
        trace,
      );
      if (!isDeepStrictEqual(saved, parent.receipt)) throw new TypeError();
      previous = query.restore_id;
      byId.set(query.restore_id, parent);
      check();
      return parent;
    });
    selected_restore_id = null;
    previous = undefined;
    const referenced = new Set<string>();
    stage = 'receipts';
    const receipts = row.receipts.map((input) => {
      check();
      selected_requeue_id = null;
      selected_restore_id = null;
      const saved = object(input);
      const query = parseOutboxRestoreRequeueReceiptQuery(saved.query, trace);
      selected_requeue_id = query.requeue_id;
      selected_restore_id = query.restore_id;
      if (
        !isDeepStrictEqual(query.scope, scope) ||
        (previous !== undefined &&
          Buffer.compare(Buffer.from(previous), Buffer.from(query.requeue_id)) >= 0)
      )
        throw new TypeError();
      const parent = byId.get(query.restore_id);
      if (
        !parent ||
        parent.source.document_sha256 !== query.archive_sha256 ||
        typeof saved.requeued_at !== 'string' ||
        typeof saved.requeue_trace_id !== 'string'
      )
        throw new TypeError();
      const receipt = outboxRequeueReceiptCandidate(
        query,
        parent.source,
        parent.receipt,
        saved.requeued_at,
        saved.requeue_trace_id,
        trace,
        check,
      );
      if (!isDeepStrictEqual(saved, receipt)) throw new TypeError();
      previous = query.requeue_id;
      referenced.add(query.restore_id);
      check();
      return receipt;
    });
    stage = 'membership';
    selected_requeue_id = null;
    selected_restore_id = null;
    if (referenced.size !== parents.length) throw new TypeError();
    const document: OutboxRestoreRequeueBackupDocument = {
      schema_version: 1,
      kind: 'workctx.sync-outbox-requeue-history',
      scope,
      observed_at: row.observed_at,
      export_trace_id: row.export_trace_id,
      parents,
      receipts,
    };
    stage = 'digest';
    const file = {
      document,
      document_sha256: createHash('sha256')
        .update(syncJsonSnapshot(document, OUTBOX_REQUEUE_BACKUP_DOCUMENT_BYTES))
        .digest('hex'),
    };
    check();
    return file;
  } catch (error) {
    throw fail(
      error instanceof ContractError ? error.envelope.code : 'OUTBOX_REQUEUE_BACKUP_INVALID',
      error instanceof ContractError
        ? error.envelope.message
        : 'The complete requeue backup has invalid structure, membership, history or digests',
      trace,
      {
        ...(error instanceof ContractError ? error.envelope.details : {}),
        backup_stage: stage,
        selected_restore_id,
        selected_requeue_id,
      },
    );
  }
}
export function verifyOutboxRestoreRequeueBackup(
  input: unknown,
  trace: string,
): OutboxRestoreRequeueBackupFile {
  const check = outboxRestoreBudget(trace);
  try {
    const row = object(JSON.parse(syncJsonSnapshot(input, OUTBOX_REQUEUE_BACKUP_FILE_BYTES)), [
      'document',
      'document_sha256',
    ]);
    if (typeof row.document_sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(row.document_sha256))
      throw new TypeError();
    const file = createOutboxRestoreRequeueBackup(row.document, trace, check);
    if (file.document_sha256 !== row.document_sha256) throw new TypeError();
    check();
    return file;
  } catch (error) {
    if (error instanceof ContractError) throw error;
    throw fail(
      'OUTBOX_REQUEUE_BACKUP_INVALID',
      'The complete backup structure or document digest is invalid',
      trace,
    );
  }
}
/** Use only after full verification. No parent bodies or per-event private fields are returned. */
export function outboxRestoreRequeueBackupSummary(file: OutboxRestoreRequeueBackupFile) {
  const document = file.document;
  return {
    scope: document.scope,
    document_sha256: file.document_sha256,
    receipts: document.receipts.length,
    parent_histories: document.parents.length,
    archived_record_appearances: document.parents.reduce(
      (total, parent) => total + parent.receipt.records,
      0,
    ),
    archive_count_basis: 'appearances-across-distinct-parent-histories' as const,
    selected_record_appearances: document.receipts.reduce(
      (total, receipt) => total + receipt.selected_records,
      0,
    ),
    selection_count_basis: 'appearances-across-requeue-receipts' as const,
    observed_at: document.observed_at,
    export_trace_id: document.export_trace_id,
    observation: 'archived-project-requeue-history' as const,
    archive_integrity: 'verified' as const,
    current_queue: 'not-checked' as const,
    current_control: 'not-checked' as const,
    server_delivery: 'not-checked' as const,
    source_authenticity: 'not-proven' as const,
    sender_stopped: 'not-proven' as const,
    local_commit: 'not-attempted' as const,
  };
}

export interface OutboxRestoreRequeueBackupHistoryQuery {
  limit: number;
  backup_sha256?: string;
  after_requeue_id?: string;
}
const digest = (value: unknown): value is string =>
  typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
export function parseOutboxRestoreRequeueBackupHistoryQuery(
  input: unknown,
  trace: string,
): OutboxRestoreRequeueBackupHistoryQuery {
  try {
    const row = object(JSON.parse(syncJsonSnapshot(input, 16384)));
    if (
      Object.keys(row).some((key) => !['limit', 'backup_sha256', 'after_requeue_id'].includes(key))
    )
      throw new TypeError();
    const limit = row.limit === undefined ? 10 : row.limit;
    if (typeof limit !== 'number' || !Number.isSafeInteger(limit) || limit < 1 || limit > 20)
      throw new TypeError();
    const query: OutboxRestoreRequeueBackupHistoryQuery = { limit };
    if (row.backup_sha256 !== undefined) {
      if (!digest(row.backup_sha256)) throw new TypeError();
      query.backup_sha256 = row.backup_sha256;
    }
    if (row.after_requeue_id !== undefined) {
      if (!isSyncIdentifier(row.after_requeue_id) || query.backup_sha256 === undefined)
        throw new TypeError();
      query.after_requeue_id = row.after_requeue_id;
    }
    return query;
  } catch {
    throw fail(
      'OUTBOX_REQUEUE_BACKUP_HISTORY_QUERY_INVALID',
      'Supply optional limit (1–20), backup_sha256 and after_requeue_id; continuation requires the original backup digest',
      trace,
    );
  }
}
export function parseOutboxRestoreRequeueBackupSelection(input: unknown, trace: string) {
  try {
    const row = object(JSON.parse(syncJsonSnapshot(input, 16384)), ['backup_sha256', 'requeue_id']);
    if (!digest(row.backup_sha256) || !isSyncIdentifier(row.requeue_id)) throw new TypeError();
    return { backup_sha256: row.backup_sha256, requeue_id: row.requeue_id };
  } catch {
    throw fail(
      'OUTBOX_REQUEUE_BACKUP_SELECTION_INVALID',
      'Supply exactly the original backup_sha256 and requeue_id',
      trace,
    );
  }
}
function assertBackupSelection(
  file: OutboxRestoreRequeueBackupFile,
  expected: string | undefined,
  trace: string,
) {
  if (expected !== undefined && expected !== file.document_sha256)
    throw fail(
      'OUTBOX_REQUEUE_BACKUP_SELECTION_CHANGED',
      'The backup differs from the original selection; retain the original file and query',
      trace,
      { expected_backup_sha256: expected, observed_backup_sha256: file.document_sha256 },
    );
}
function backupObservation(file: OutboxRestoreRequeueBackupFile) {
  return {
    scope: file.document.scope,
    backup_sha256: file.document_sha256,
    backup_observed_at: file.document.observed_at,
    backup_export_trace_id: file.document.export_trace_id,
    total_receipts: file.document.receipts.length,
    parent_histories: file.document.parents.length,
    archive_integrity: 'verified' as const,
    current_queue: 'not-checked' as const,
    current_control: 'not-checked' as const,
    server_delivery: 'not-checked' as const,
    source_authenticity: 'not-proven' as const,
    sender_stopped: 'not-proven' as const,
    local_commit: 'not-attempted' as const,
  };
}
function boundedMetadata<T>(input: T, trace: string, check: () => void): T {
  try {
    syncJsonSnapshot(input, 128 * 1024);
  } catch {
    throw fail(
      'OUTBOX_REQUEUE_BACKUP_METADATA_TOO_LARGE',
      'The complete selection metadata exceeds 128 KiB; use a smaller limit when listing',
      trace,
    );
  }
  check();
  return input;
}
function accessError(error: unknown, query: unknown, trace: string) {
  return fail(
    error instanceof ContractError ? error.envelope.code : 'OUTBOX_REQUEUE_BACKUP_ACCESS_FAILED',
    error instanceof ContractError
      ? error.envelope.message
      : 'The complete backup selection could not be read',
    trace,
    { ...(error instanceof ContractError ? error.envelope.details : {}), query },
  );
}
/** Every page verifies the whole file, including histories outside the requested page. */
export function listOutboxRestoreRequeueBackupHistory(
  input: unknown,
  selection: unknown,
  trace: string,
) {
  const query = parseOutboxRestoreRequeueBackupHistoryQuery(selection, trace);
  const check = outboxRestoreBudget(trace);
  try {
    const file = verifyOutboxRestoreRequeueBackup(input, trace);
    check();
    assertBackupSelection(file, query.backup_sha256, trace);
    const after = query.after_requeue_id === undefined ? null : Buffer.from(query.after_requeue_id);
    const selected = file.document.receipts.filter(
      (receipt) =>
        after === null || Buffer.compare(Buffer.from(receipt.query.requeue_id), after) > 0,
    );
    const items = selected.slice(0, query.limit).map((receipt) => ({
      requeue_id: receipt.query.requeue_id,
      restore_id: receipt.query.restore_id,
      requeued_at: receipt.requeued_at,
      archive_sha256: receipt.query.archive_sha256,
      query_sha256: receipt.query_sha256,
      restore_receipt_sha256: receipt.restore_receipt_sha256,
      before_sha256: receipt.before_sha256,
      after_sha256: receipt.after_sha256,
      selected_records: receipt.selected_records,
      get_query: { backup_sha256: file.document_sha256, requeue_id: receipt.query.requeue_id },
    }));
    const has_more = selected.length > query.limit;
    return boundedMetadata(
      {
        ...backupObservation(file),
        query: { ...query, backup_sha256: file.document_sha256 },
        items,
        has_more,
        next_query: has_more
          ? {
              backup_sha256: file.document_sha256,
              limit: query.limit,
              after_requeue_id: items[items.length - 1]!.requeue_id,
            }
          : null,
        observation: 'archived-requeue-history-page' as const,
      },
      trace,
      check,
    );
  } catch (error) {
    throw accessError(error, query, trace);
  }
}
/** Callers must remove receipt_file before printing metadata; it includes complete parent bodies. */
export function readOutboxRestoreRequeueBackupEntry(
  input: unknown,
  selection: unknown,
  trace: string,
) {
  const query = parseOutboxRestoreRequeueBackupSelection(selection, trace);
  const check = outboxRestoreBudget(trace);
  try {
    const file = verifyOutboxRestoreRequeueBackup(input, trace);
    check();
    assertBackupSelection(file, query.backup_sha256, trace);
    const receipt = file.document.receipts.find(
      (entry) => entry.query.requeue_id === query.requeue_id,
    );
    let receipt_file: ReturnType<typeof createOutboxRestoreRequeueFile> | null = null;
    if (receipt) {
      const parent = file.document.parents.find(
        (entry) => entry.receipt.query.restore_id === receipt.query.restore_id,
      );
      if (!parent) throw new TypeError();
      // Preserve backup observation metadata so extraction is deterministic, never a new requeue claim.
      receipt_file = createOutboxRestoreRequeueFile(
        {
          schema_version: 1,
          kind: 'workctx.sync-outbox-restore-requeue-receipt',
          scope: file.document.scope,
          observed_at: file.document.observed_at,
          export_trace_id: file.document.export_trace_id,
          receipt,
          parent,
        },
        trace,
        check,
      );
    }
    const metadata = boundedMetadata(
      {
        ...backupObservation(file),
        query,
        status: receipt ? ('recorded' as const) : ('not-found' as const),
        original_query: receipt?.query ?? null,
        receipt: receipt ?? null,
        standalone: receipt_file ? outboxRestoreRequeueFileSummary(receipt_file) : null,
        packaging_metadata: 'preserved-from-backup' as const,
        observation: 'archived-requeue-history-entry' as const,
      },
      trace,
      check,
    );
    return { ...metadata, receipt_file };
  } catch (error) {
    throw accessError(error, query, trace);
  }
}
