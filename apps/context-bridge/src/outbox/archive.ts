import { createHash } from 'node:crypto';
import { ContractError, isSyncIdentifier, syncJsonSnapshot } from '@planemem/contracts';
import type { OutboxScope } from './sqlite.js';
import { parseOutboxAuditQuery, type OutboxAuditQuery } from './audit.js';
import { checkedOriginalEvent } from './original.js';
import {
  parseOutboxReadScope,
  outboxStoredColumns,
  parseOutboxStoredRow,
  outboxRecordSummary,
} from './reading.js';

export const OUTBOX_ARCHIVE_MAX_RECORDS = 1000;
export const OUTBOX_ARCHIVE_DOCUMENT_BYTES = 32 * 1024 * 1024;
export const OUTBOX_ARCHIVE_FILE_BYTES = OUTBOX_ARCHIVE_DOCUMENT_BYTES + 8192;
export interface OutboxArchiveDocument {
  schema_version: 1;
  kind: 'workctx.sync-outbox-archive';
  scope: OutboxScope;
  observed_at: string;
  export_trace_id: string;
  records: Record<string, unknown>[];
}
export interface OutboxArchiveFile {
  document: OutboxArchiveDocument;
  document_sha256: string;
}
function fail(code: string, message: string, trace: string, details: Record<string, unknown> = {}) {
  return new ContractError(code, message, { trace_id: trace, retryable: false, details });
}
const hash = (raw: string) => createHash('sha256').update(raw).digest('hex');
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
export function parseOutboxArchiveQuery(input: unknown, trace: string): OutboxAuditQuery {
  try {
    const value: unknown = JSON.parse(syncJsonSnapshot(input, 16384));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError();
    const row = value as Record<string, unknown>;
    const query = parseOutboxAuditQuery(
      {
        ...row,
        max_bytes: Object.hasOwn(row, 'max_bytes') ? row.max_bytes : OUTBOX_ARCHIVE_DOCUMENT_BYTES,
      },
      trace,
    );
    if (
      query.max_events > OUTBOX_ARCHIVE_MAX_RECORDS ||
      query.max_bytes > OUTBOX_ARCHIVE_DOCUMENT_BYTES
    )
      throw new TypeError();
    return query;
  } catch {
    throw fail(
      'OUTBOX_ARCHIVE_QUERY_INVALID',
      'Supply scope and optional max_events (1–1000), max_bytes (1–33554432), timeout_ms (1–90000)',
      trace,
    );
  }
}
/** No database import or access. Archive hashes show consistency, never remote delivery or lease ownership. */
export function parseOutboxArchiveDocument(input: unknown, trace: string): OutboxArchiveDocument {
  let selected_event_id: string | null = null;
  let record_index = 0;
  try {
    const row = object(JSON.parse(syncJsonSnapshot(input, OUTBOX_ARCHIVE_DOCUMENT_BYTES)), [
      'schema_version',
      'kind',
      'scope',
      'observed_at',
      'export_trace_id',
      'records',
    ]);
    if (
      row.schema_version !== 1 ||
      row.kind !== 'workctx.sync-outbox-archive' ||
      !Array.isArray(row.records) ||
      row.records.length > OUTBOX_ARCHIVE_MAX_RECORDS ||
      typeof row.observed_at !== 'string' ||
      !Number.isFinite(Date.parse(row.observed_at)) ||
      new Date(row.observed_at).toISOString() !== row.observed_at ||
      typeof row.export_trace_id !== 'string' ||
      !row.export_trace_id.trim() ||
      row.export_trace_id.length > 1024 ||
      /[\u0000-\u001f\u007f\p{Cs}]/u.test(row.export_trace_id)
    )
      throw new TypeError();
    const scope = parseOutboxReadScope(row.scope, trace);
    let previous: Buffer | undefined;
    const keys = new Set<string>();
    const records = row.records.map((input) => {
      selected_event_id = null;
      const stored = parseOutboxStoredRow(input, trace);
      selected_event_id = isSyncIdentifier(stored.event_id) ? stored.event_id : null;
      outboxRecordSummary(stored, scope, Date.parse(row.observed_at as string), trace);
      const event = checkedOriginalEvent(stored, trace);
      const key = Buffer.from(event.event_id, 'utf8');
      if ((previous && Buffer.compare(previous, key) >= 0) || keys.has(event.idempotency_key))
        throw new TypeError();
      previous = key;
      keys.add(event.idempotency_key);
      record_index += 1;
      return outboxStoredColumns(stored);
    });
    return {
      schema_version: 1,
      kind: 'workctx.sync-outbox-archive',
      scope,
      observed_at: row.observed_at,
      export_trace_id: row.export_trace_id,
      records,
    };
  } catch (error) {
    throw fail(
      error instanceof ContractError ? error.envelope.code : 'OUTBOX_ARCHIVE_INVALID',
      error instanceof ContractError
        ? error.envelope.message
        : 'The complete outbox archive has invalid structure, order or original records',
      trace,
      {
        ...(error instanceof ContractError ? error.envelope.details : {}),
        record_index,
        selected_event_id,
      },
    );
  }
}
export function createOutboxArchive(input: unknown, trace: string): OutboxArchiveFile {
  const document = parseOutboxArchiveDocument(input, trace);
  return {
    document,
    document_sha256: hash(syncJsonSnapshot(document, OUTBOX_ARCHIVE_DOCUMENT_BYTES)),
  };
}
export function verifyOutboxArchive(input: unknown, trace: string): OutboxArchiveFile {
  try {
    const row = object(JSON.parse(syncJsonSnapshot(input, OUTBOX_ARCHIVE_FILE_BYTES)), [
      'document',
      'document_sha256',
    ]);
    if (typeof row.document_sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(row.document_sha256))
      throw new TypeError();
    const file = createOutboxArchive(row.document, trace);
    if (file.document_sha256 !== row.document_sha256) throw new TypeError();
    return file;
  } catch (error) {
    if (error instanceof ContractError) throw error;
    throw fail(
      'OUTBOX_ARCHIVE_INVALID',
      'The complete outbox archive or document digest is invalid',
      trace,
    );
  }
}
/** Call after full verification. Reports only archived observations, not current queue state. */
export function outboxArchiveSummary(file: OutboxArchiveFile, trace: string) {
  const statuses = { pending: 0, sending: 0, sent: 0, failed: 0, conflict: 0 };
  const send_leases = { active: 0, expired: 0, none: 0 };
  let stored_text_bytes = 0;
  let legacy_payload_checksums = 0;
  for (const record of file.document.records) {
    const row = parseOutboxStoredRow(record, trace);
    const summary = outboxRecordSummary(
      row,
      file.document.scope,
      Date.parse(file.document.observed_at),
      trace,
    );
    statuses[summary.status] += 1;
    send_leases[summary.send_lease] += 1;
    stored_text_bytes += Object.values(record).reduce<number>(
      (n, value) => n + (typeof value === 'string' ? Buffer.byteLength(value, 'utf8') : 0),
      0,
    );
    if (typeof record.checksum === 'string' && record.checksum.length === 15)
      legacy_payload_checksums += 1;
  }
  return {
    scope: file.document.scope,
    records: file.document.records.length,
    stored_text_bytes,
    statuses,
    send_leases,
    legacy_payload_checksums,
    observed_at: file.document.observed_at,
    export_trace_id: file.document.export_trace_id,
    document_sha256: file.document_sha256,
    observation: 'archived-local-state' as const,
    server_delivery: 'not-checked' as const,
    lease_ownership: 'not-granted' as const,
  };
}
