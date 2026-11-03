import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { ContractError, syncJsonSnapshot } from '@planemem/contracts';
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
