import type { DatabaseSync } from 'node:sqlite';
import { ContractError, isSyncIdentifier, syncJsonSnapshot } from '@planemem/contracts';
import type { OutboxScope } from './sqlite.js';
import { OUTBOX_ARCHIVE_FILE_BYTES } from './archive.js';
import { parseOutboxReadScope, outboxReadTransaction } from './reading.js';
import {
  outboxRestoreReceiptTable,
  outboxRestoreStoredRecord,
  parseOutboxRestoreQuery,
} from './restore.js';

export interface OutboxRestoreSelection {
  scope: OutboxScope;
  restore_id: string;
}
export interface OutboxRestoreHistoryQuery {
  scope: OutboxScope;
  limit: number;
  after_restore_id?: string;
}
function fail(code: string, message: string, trace: string, details: Record<string, unknown> = {}) {
  return new ContractError(code, message, { trace_id: trace, retryable: false, details });
}
function object(input: unknown): Record<string, unknown> {
  const value: unknown = JSON.parse(syncJsonSnapshot(input, 16384));
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError();
  return value as Record<string, unknown>;
}
export function parseOutboxRestoreSelection(input: unknown, trace: string): OutboxRestoreSelection {
  try {
    const row = object(input);
    if (
      Object.keys(row).length !== 2 ||
      Object.keys(row).some((key) => !['scope', 'restore_id'].includes(key)) ||
      !isSyncIdentifier(row.restore_id)
    )
      throw new TypeError();
    return { scope: parseOutboxReadScope(row.scope, trace), restore_id: row.restore_id };
  } catch {
    throw fail(
      'OUTBOX_RESTORE_SELECTION_INVALID',
      'Supply the exact project scope and restore_id',
      trace,
    );
  }
}
export function parseOutboxRestoreHistoryQuery(
  input: unknown,
  trace: string,
): OutboxRestoreHistoryQuery {
  try {
    const row = object(input);
    const limit = row.limit === undefined ? 10 : row.limit;
    if (
      Object.keys(row).some((key) => !['scope', 'limit', 'after_restore_id'].includes(key)) ||
      typeof limit !== 'number' ||
      !Number.isSafeInteger(limit) ||
      limit < 1 ||
      limit > 20
    )
      throw new TypeError();
    const result: OutboxRestoreHistoryQuery = {
      scope: parseOutboxReadScope(row.scope, trace),
      limit,
    };
    if (row.after_restore_id !== undefined) {
      if (!isSyncIdentifier(row.after_restore_id)) throw new TypeError();
      result.after_restore_id = row.after_restore_id;
    }
    return result;
  } catch {
    throw fail(
      'OUTBOX_RESTORE_HISTORY_QUERY_INVALID',
      'Supply scope and optional limit (1 to 20) and after_restore_id',
      trace,
    );
  }
}
function read<T>(
  db: DatabaseSync,
  query: unknown,
  trace: string,
  run: (check: () => void) => T,
): T {
  const deadline = performance.now() + 90000;
  const check = () => {
    if (performance.now() >= deadline)
      throw fail(
        'OUTBOX_RESTORE_HISTORY_TIMEOUT',
        'The local history read exceeded 90 seconds',
        trace,
      );
  };
  try {
    return outboxReadTransaction(
      db,
      () => {
        check();
        const result = run(check);
        check();
        return result;
      },
      trace,
    );
  } catch (error) {
    throw fail(
      error instanceof ContractError ? error.envelope.code : 'OUTBOX_RESTORE_HISTORY_UNAVAILABLE',
      error instanceof ContractError
        ? error.envelope.message
        : 'The selected restore history could not be read',
      trace,
      {
        ...(error instanceof ContractError ? error.envelope.details : {}),
        query,
      },
    );
  }
}

/** Metadata discovery only: archive bodies never enter this list response. */
export function listOutboxRestoreReceipts(db: DatabaseSync, input: unknown, trace: string) {
  const query = parseOutboxRestoreHistoryQuery(input, trace);
  return read(db, query, trace, (check) => {
    const fields: [string, number][] = [
      ['restore_id', 1020],
      ['query_json', 16384],
      ['restored_at', 64],
      ['restore_trace_id', 4096],
      ['restored_document_sha256', 64],
    ];
    const projection = fields
      .map(
        ([name, maximum]) =>
          `CASE WHEN typeof(${name}) = 'text' AND length(CAST(${name} AS BLOB)) <= ${maximum} THEN ${name} ELSE NULL END AS ${name}`,
      )
      .join(', ');
    const rows = outboxRestoreReceiptTable(db, trace)
      ? db
          .prepare(
            `SELECT ${projection},
      CASE WHEN typeof(schema_version) = 'integer' AND schema_version = 1 THEN 1 ELSE NULL END AS schema_version,
      CASE WHEN typeof(archive_json) = 'text' THEN length(CAST(archive_json AS BLOB)) ELSE NULL END AS archive_bytes
      FROM main.local_outbox_restore_receipts
      WHERE tenant_id = ? COLLATE BINARY AND workspace_id = ? COLLATE BINARY AND project_id = ? COLLATE BINARY
      ${query.after_restore_id === undefined ? '' : 'AND restore_id > ? COLLATE BINARY'}
      ORDER BY restore_id COLLATE BINARY LIMIT ?`,
          )
          .all(
            query.scope.tenant_id,
            query.scope.workspace_id,
            query.scope.project_id,
            ...(query.after_restore_id === undefined ? [] : [query.after_restore_id]),
            query.limit + 1,
          )
      : [];
    let previous = query.after_restore_id;
    const selected = rows.map((row) => {
      check();
      try {
        if (
          row.schema_version !== 1 ||
          !isSyncIdentifier(row.restore_id) ||
          typeof row.query_json !== 'string' ||
          typeof row.restored_at !== 'string' ||
          !Number.isFinite(Date.parse(row.restored_at)) ||
          new Date(row.restored_at).toISOString() !== row.restored_at ||
          typeof row.restore_trace_id !== 'string' ||
          !row.restore_trace_id.trim() ||
          row.restore_trace_id.length > 1024 ||
          /[\u0000-\u001f\u007f\p{Cs}]/u.test(row.restore_trace_id) ||
          typeof row.restored_document_sha256 !== 'string' ||
          !/^[a-f0-9]{64}$/.test(row.restored_document_sha256) ||
          typeof row.archive_bytes !== 'number' ||
          !Number.isSafeInteger(row.archive_bytes) ||
          row.archive_bytes < 1 ||
          row.archive_bytes > OUTBOX_ARCHIVE_FILE_BYTES
        )
          throw new TypeError();
        if (
          previous !== undefined &&
          Buffer.compare(Buffer.from(previous), Buffer.from(row.restore_id)) >= 0
        )
          throw new TypeError();
        previous = row.restore_id;
        const original = parseOutboxRestoreQuery(JSON.parse(row.query_json), trace);
        if (
          original.restore_id !== row.restore_id ||
          original.scope.tenant_id !== query.scope.tenant_id ||
          original.scope.workspace_id !== query.scope.workspace_id ||
          original.scope.project_id !== query.scope.project_id
        )
          throw new TypeError();
        return {
          restore_id: row.restore_id,
          original_query: original,
          restored_at: row.restored_at,
          restore_trace_id: row.restore_trace_id,
          archive_sha256: original.archive_sha256,
          restored_document_sha256: row.restored_document_sha256,
          archive_bytes: row.archive_bytes,
          archive_integrity: 'not-verified' as const,
        };
      } catch (error) {
        throw fail(
          'OUTBOX_RESTORE_HISTORY_METADATA_INVALID',
          'Selected restore history metadata is invalid; preserve the queue',
          trace,
          {
            ...(error instanceof ContractError
              ? { ...error.envelope.details, cause_code: error.envelope.code }
              : {}),
            selected_restore_id: isSyncIdentifier(row.restore_id) ? row.restore_id : null,
          },
        );
      }
    });
    const records = selected.slice(0, query.limit);
    const has_more = selected.length > query.limit;
    const result = {
      scope: query.scope,
      query,
      records,
      has_more,
      next_query: has_more
        ? { ...query, after_restore_id: records[records.length - 1]!.restore_id }
        : null,
      observed_at: new Date().toISOString(),
      observation: 'local-restore-history-metadata' as const,
      archive_integrity: 'not-verified' as const,
      current_queue: 'not-checked' as const,
      server_delivery: 'not-checked' as const,
    };
    syncJsonSnapshot(result, 512 * 1024);
    return result;
  });
}

function storedRecord(db: DatabaseSync, input: unknown, trace: string) {
  const query = parseOutboxRestoreSelection(input, trace);
  return read(db, query, trace, () => {
    const stored = outboxRestoreStoredRecord(
      db,
      query,
      trace,
      outboxRestoreReceiptTable(db, trace),
    );
    return { query, stored, observed_at: new Date().toISOString() };
  });
}
export function readOutboxRestoreRecord(db: DatabaseSync, input: unknown, trace: string) {
  const { query, stored, observed_at } = storedRecord(db, input, trace);
  return {
    scope: query.scope,
    query,
    status: stored ? ('recorded' as const) : ('not-observed' as const),
    receipt: stored?.receipt ?? null,
    observed_at,
    current_queue: 'not-checked' as const,
    server_delivery: 'not-checked' as const,
  };
}
export function readOutboxRestoreArchive(db: DatabaseSync, input: unknown, trace: string) {
  const { query, stored, observed_at } = storedRecord(db, input, trace);
  if (!stored)
    throw fail(
      'OUTBOX_RESTORE_HISTORY_NOT_FOUND',
      'No restore history was observed for this project and ID; no archive is available',
      trace,
      { query },
    );
  return {
    scope: query.scope,
    query,
    receipt: stored.receipt,
    source: stored.source,
    observed_at,
    current_queue: 'not-checked' as const,
    server_delivery: 'not-checked' as const,
  };
}
