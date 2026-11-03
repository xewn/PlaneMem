import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { ContractError, isSyncIdentifier, syncJsonSnapshot } from '@planemem/contracts';
import { outboxArchiveSummary } from './archive.js';
import type { OutboxScope } from './sqlite.js';
import { parseOutboxReadScope } from './reading.js';
import { parseOutboxRestoreAuditQuery, type OutboxRestoreAuditQuery } from './restore-audit.js';
import { outboxVerifiedRestoreRecord, parseOutboxRestoreQuery } from './restore.js';

export const OUTBOX_RESTORE_BACKUP_MAX_RECEIPTS = 100;
export const OUTBOX_RESTORE_BACKUP_DOCUMENT_BYTES = 64 * 1024 * 1024;
export const OUTBOX_RESTORE_BACKUP_FILE_BYTES = OUTBOX_RESTORE_BACKUP_DOCUMENT_BYTES + 8192;
export type OutboxRestoreBackupRecord = ReturnType<typeof outboxVerifiedRestoreRecord>;
export interface OutboxRestoreBackupDocument {
  schema_version: 1;
  kind: 'workctx.sync-outbox-restore-history';
  scope: OutboxScope;
  observed_at: string;
  export_trace_id: string;
  records: OutboxRestoreBackupRecord[];
}
export interface OutboxRestoreBackupFile {
  document: OutboxRestoreBackupDocument;
  document_sha256: string;
}
function fail(code: string, message: string, trace: string, details: Record<string, unknown> = {}) {
  return new ContractError(code, message, { trace_id: trace, retryable: false, details });
}
function budget(trace: string) {
  const deadline = performance.now() + 90000;
  return () => {
    if (performance.now() >= deadline)
      throw fail(
        'OUTBOX_RESTORE_BACKUP_TIMEOUT',
        'The complete history backup verification exceeded 90 seconds',
        trace,
      );
  };
}
function object(input: unknown, fields: string[]): Record<string, unknown> {
  if (
    !input ||
    typeof input !== 'object' ||
    Array.isArray(input) ||
    Object.keys(input).length !== fields.length ||
    Object.keys(input).some((key) => !fields.includes(key))
  )
    throw new TypeError();
  return input as Record<string, unknown>;
}
export function parseOutboxRestoreBackupQuery(
  input: unknown,
  trace: string,
): OutboxRestoreAuditQuery {
  try {
    const query = parseOutboxRestoreAuditQuery(input, trace);
    if (
      query.max_receipts > OUTBOX_RESTORE_BACKUP_MAX_RECEIPTS ||
      query.max_bytes > OUTBOX_RESTORE_BACKUP_DOCUMENT_BYTES
    )
      throw new TypeError();
    return query;
  } catch (error) {
    throw fail(
      'OUTBOX_RESTORE_BACKUP_QUERY_INVALID',
      'Supply scope and optional max_receipts (1–100), max_bytes (1–67108864), timeout_ms (1–90000)',
      trace,
      error instanceof ContractError
        ? { ...error.envelope.details, cause_code: error.envelope.code }
        : {},
    );
  }
}

/** Detached v1 logical history, retaining complete receipts and original archived JSON strings. */
export function createOutboxRestoreBackup(
  input: unknown,
  trace: string,
  check: () => void = budget(trace),
): OutboxRestoreBackupFile {
  let record_index = 0;
  let selected_restore_id: string | null = null;
  try {
    check();
    const row = object(JSON.parse(syncJsonSnapshot(input, OUTBOX_RESTORE_BACKUP_DOCUMENT_BYTES)), [
      'schema_version',
      'kind',
      'scope',
      'observed_at',
      'export_trace_id',
      'records',
    ]);
    if (
      row.schema_version !== 1 ||
      row.kind !== 'workctx.sync-outbox-restore-history' ||
      typeof row.observed_at !== 'string' ||
      !Number.isFinite(Date.parse(row.observed_at)) ||
      new Date(row.observed_at).toISOString() !== row.observed_at ||
      typeof row.export_trace_id !== 'string' ||
      !row.export_trace_id.trim() ||
      row.export_trace_id.length > 1024 ||
      /[\u0000-\u001f\u007f\p{Cs}]/u.test(row.export_trace_id) ||
      !Array.isArray(row.records) ||
      row.records.length > OUTBOX_RESTORE_BACKUP_MAX_RECEIPTS
    )
      throw new TypeError();
    const scope = parseOutboxReadScope(row.scope, trace);
    let previous: Buffer | undefined;
    const records = row.records.map((input): OutboxRestoreBackupRecord => {
      check();
      selected_restore_id = null;
      const entry = object(input, ['receipt', 'source']);
      if (!entry.receipt || typeof entry.receipt !== 'object' || Array.isArray(entry.receipt))
        throw new TypeError();
      const receipt = entry.receipt as Record<string, unknown>;
      const query = parseOutboxRestoreQuery(receipt.query, trace);
      selected_restore_id = query.restore_id;
      if (!isDeepStrictEqual(query.scope, scope)) throw new TypeError();
      const key = Buffer.from(query.restore_id, 'utf8');
      if (previous && Buffer.compare(previous, key) >= 0) throw new TypeError();
      previous = key;
      const verified = outboxVerifiedRestoreRecord(
        query,
        entry.source,
        receipt.restored_at,
        receipt.restore_trace_id,
        receipt.restored_document_sha256,
        trace,
      );
      // All receipt fields, including historical markers and counts, must agree; no extras survive.
      if (!isDeepStrictEqual(receipt, verified.receipt)) throw new TypeError();
      check();
      record_index += 1;
      return verified;
    });
    const document: OutboxRestoreBackupDocument = {
      schema_version: 1,
      kind: 'workctx.sync-outbox-restore-history',
      scope,
      observed_at: row.observed_at,
      export_trace_id: row.export_trace_id,
      records,
    };
    const file = {
      document,
      document_sha256: createHash('sha256')
        .update(syncJsonSnapshot(document, OUTBOX_RESTORE_BACKUP_DOCUMENT_BYTES))
        .digest('hex'),
    };
    check();
    return file;
  } catch (error) {
    throw fail(
      error instanceof ContractError ? error.envelope.code : 'OUTBOX_RESTORE_BACKUP_INVALID',
      error instanceof ContractError
        ? error.envelope.message
        : 'The complete restore history backup has invalid structure, order, receipts or archives',
      trace,
      {
        ...(error instanceof ContractError
          ? { ...error.envelope.details, cause_code: error.envelope.code }
          : {}),
        history_record_index: record_index,
        selected_restore_id,
      },
    );
  }
}
export function verifyOutboxRestoreBackup(input: unknown, trace: string): OutboxRestoreBackupFile {
  const check = budget(trace);
  try {
    const row = object(JSON.parse(syncJsonSnapshot(input, OUTBOX_RESTORE_BACKUP_FILE_BYTES)), [
      'document',
      'document_sha256',
    ]);
    if (typeof row.document_sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(row.document_sha256))
      throw new TypeError();
    check();
    const saved = createOutboxRestoreBackup(row.document, trace, check);
    if (saved.document_sha256 !== row.document_sha256) throw new TypeError();
    return saved;
  } catch (error) {
    if (error instanceof ContractError) throw error;
    throw fail(
      'OUTBOX_RESTORE_BACKUP_INVALID',
      'The complete restore history backup digest is invalid',
      trace,
    );
  }
}

/** Use after full verification. Returns no source bodies, lease values or per-record content. */
export function outboxRestoreBackupSummary(file: OutboxRestoreBackupFile) {
  let archived_records = 0;
  let held_records = 0;
  const historical_terminal_records = { sent: 0, conflict: 0 };
  for (const { receipt } of file.document.records) {
    archived_records += receipt.records;
    held_records += receipt.held_records;
    historical_terminal_records.sent += receipt.historical_terminal_records.sent;
    historical_terminal_records.conflict += receipt.historical_terminal_records.conflict;
  }
  return {
    scope: file.document.scope,
    records: file.document.records.length,
    archived_records,
    held_records,
    historical_terminal_records,
    record_count_basis: 'appearances-across-restore-receipts' as const,
    observed_at: file.document.observed_at,
    export_trace_id: file.document.export_trace_id,
    document_sha256: file.document_sha256,
    observation: 'archived-local-restore-history' as const,
    archive_integrity: 'verified' as const,
    current_queue: 'not-checked' as const,
    current_control: 'not-checked' as const,
    server_delivery: 'not-checked' as const,
    source_authenticity: 'not-proven' as const,
  };
}

export interface OutboxRestoreBackupHistoryQuery {
  limit: number;
  backup_sha256?: string;
  after_restore_id?: string;
}
export interface OutboxRestoreBackupSelection {
  backup_sha256: string;
  restore_id: string;
}
function queryObject(input: unknown) {
  const value: unknown = JSON.parse(syncJsonSnapshot(input, 16384));
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError();
  return value as Record<string, unknown>;
}
function digest(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
}
export function parseOutboxRestoreBackupHistoryQuery(
  input: unknown,
  trace: string,
): OutboxRestoreBackupHistoryQuery {
  try {
    const row = queryObject(input);
    const limit = row.limit === undefined ? 10 : row.limit;
    if (
      Object.keys(row).some(
        (key) => !['limit', 'backup_sha256', 'after_restore_id'].includes(key),
      ) ||
      typeof limit !== 'number' ||
      !Number.isSafeInteger(limit) ||
      limit < 1 ||
      limit > 20
    )
      throw new TypeError();
    const query: OutboxRestoreBackupHistoryQuery = { limit };
    if (row.backup_sha256 !== undefined) {
      if (!digest(row.backup_sha256)) throw new TypeError();
      query.backup_sha256 = row.backup_sha256;
    }
    if (row.after_restore_id !== undefined) {
      if (!isSyncIdentifier(row.after_restore_id) || query.backup_sha256 === undefined)
        throw new TypeError();
      query.after_restore_id = row.after_restore_id;
    }
    return query;
  } catch {
    throw fail(
      'OUTBOX_RESTORE_BACKUP_HISTORY_QUERY_INVALID',
      'Supply optional limit (1–20), backup_sha256 and after_restore_id; continuation requires the original backup digest',
      trace,
    );
  }
}
export function parseOutboxRestoreBackupSelection(
  input: unknown,
  trace: string,
): OutboxRestoreBackupSelection {
  try {
    const row = object(queryObject(input), ['backup_sha256', 'restore_id']);
    if (!digest(row.backup_sha256) || !isSyncIdentifier(row.restore_id)) throw new TypeError();
    return { backup_sha256: row.backup_sha256, restore_id: row.restore_id };
  } catch {
    throw fail(
      'OUTBOX_RESTORE_BACKUP_SELECTION_INVALID',
      'Supply the original backup document SHA-256 and restore_id',
      trace,
    );
  }
}
function assertBackupSelection(
  file: OutboxRestoreBackupFile,
  expected: string | undefined,
  trace: string,
) {
  if (expected !== undefined && expected !== file.document_sha256)
    throw fail(
      'OUTBOX_RESTORE_BACKUP_SELECTION_CHANGED',
      'The selected backup differs from the original query; keep the original file and selection',
      trace,
      { expected_backup_sha256: expected, observed_backup_sha256: file.document_sha256 },
    );
}
function backupObservation(file: OutboxRestoreBackupFile) {
  return {
    scope: file.document.scope,
    backup_sha256: file.document_sha256,
    backup_observed_at: file.document.observed_at,
    backup_export_trace_id: file.document.export_trace_id,
    total_receipts: file.document.records.length,
    archive_integrity: 'verified' as const,
    current_queue: 'not-checked' as const,
    current_control: 'not-checked' as const,
    server_delivery: 'not-checked' as const,
    source_authenticity: 'not-proven' as const,
  };
}
function boundedMetadata<T>(input: T, trace: string, check: () => void) {
  try {
    syncJsonSnapshot(input, 128 * 1024);
  } catch {
    throw fail(
      'OUTBOX_RESTORE_BACKUP_METADATA_TOO_LARGE',
      'The complete history metadata exceeds 128 KiB; use a smaller limit when listing',
      trace,
    );
  }
  check();
  return input;
}
function accessError(error: unknown, query: unknown, trace: string) {
  return fail(
    error instanceof ContractError
      ? error.envelope.code
      : 'OUTBOX_RESTORE_BACKUP_ACCESS_UNAVAILABLE',
    error instanceof ContractError
      ? error.envelope.message
      : 'The complete backup history selection could not be read',
    trace,
    { ...(error instanceof ContractError ? error.envelope.details : {}), query },
  );
}

/** Full-file verification precedes pagination; every continuation is bound to that document digest. */
export function listOutboxRestoreBackupHistory(input: unknown, selection: unknown, trace: string) {
  const query = parseOutboxRestoreBackupHistoryQuery(selection, trace);
  const check = budget(trace);
  try {
    const file = verifyOutboxRestoreBackup(input, trace);
    assertBackupSelection(file, query.backup_sha256, trace);
    check();
    const after =
      query.after_restore_id === undefined ? null : Buffer.from(query.after_restore_id, 'utf8');
    const selected = file.document.records.filter(
      (record) =>
        after === null ||
        Buffer.compare(Buffer.from(record.receipt.query.restore_id, 'utf8'), after) > 0,
    );
    const items = selected.slice(0, query.limit).map(({ receipt }) => ({
      restore_id: receipt.query.restore_id,
      restored_at: receipt.restored_at,
      source_observed_at: receipt.source_observed_at,
      archive_sha256: receipt.archive_sha256,
      restored_document_sha256: receipt.restored_document_sha256,
      records: receipt.records,
      held_records: receipt.held_records,
      historical_terminal_records: receipt.historical_terminal_records,
      get_query: { backup_sha256: file.document_sha256, restore_id: receipt.query.restore_id },
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
              after_restore_id: items[items.length - 1]!.restore_id,
            }
          : null,
        observation: 'archived-restore-history-page' as const,
      },
      trace,
      check,
    );
  } catch (error) {
    throw accessError(error, query, trace);
  }
}

/** Complete historical selection. Callers must explicitly strip source before printing metadata. */
export function readOutboxRestoreBackupEntry(input: unknown, selection: unknown, trace: string) {
  const query = parseOutboxRestoreBackupSelection(selection, trace);
  const check = budget(trace);
  try {
    const file = verifyOutboxRestoreBackup(input, trace);
    assertBackupSelection(file, query.backup_sha256, trace);
    check();
    const record = file.document.records.find(
      (entry) => entry.receipt.query.restore_id === query.restore_id,
    );
    const metadata = boundedMetadata(
      {
        ...backupObservation(file),
        query,
        status: record ? ('recorded' as const) : ('not-found' as const),
        receipt: record?.receipt ?? null,
        source_summary: record ? outboxArchiveSummary(record.source, trace) : null,
        observation: 'archived-restore-history-entry' as const,
      },
      trace,
      check,
    );
    return { ...metadata, source: record?.source ?? null };
  } catch (error) {
    throw accessError(error, query, trace);
  }
}
