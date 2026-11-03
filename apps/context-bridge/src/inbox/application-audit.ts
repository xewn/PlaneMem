import type { DatabaseSync } from 'node:sqlite';
import {
  ContractError,
  syncJsonSnapshot,
  syncSavedPageDocumentJson,
  type SyncSavedPageFile,
} from '@planemem/contracts';
import {
  applicationFailure,
  parseInboxApplicationQuery,
  type SyncInboxApplicationQuery,
} from './application-model.js';

export interface SyncInboxApplicationAuditQuery extends SyncInboxApplicationQuery {
  max_pages: number;
  max_events: number;
  max_bytes: number;
}
function limit(value: unknown, fallback: number, maximum: number): number {
  if (value === undefined) return fallback;
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1 || value > maximum)
    throw new TypeError();
  return value;
}
export function parseInboxApplicationAuditQuery(
  input: unknown,
  trace: string,
): SyncInboxApplicationAuditQuery {
  try {
    const value: unknown = JSON.parse(syncJsonSnapshot(input, 16384));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError();
    const { max_pages, max_events, max_bytes, ...base } = value as Record<string, unknown>;
    return {
      ...parseInboxApplicationQuery(base, trace),
      max_pages: limit(max_pages, 1000, 10000),
      max_events: limit(max_events, 100000, 1000000),
      max_bytes: limit(max_bytes, 64 * 1024 * 1024, 512 * 1024 * 1024),
    };
  } catch {
    const failure = applicationFailure(
      'INBOX_APPLICATION_AUDIT_QUERY_INVALID',
      'The application audit query is invalid',
      trace,
    );
    throw new ContractError(
      'INBOX_APPLICATION_AUDIT_QUERY_INVALID',
      'Supply the original identity/application and optional max_pages (1–10000), max_events (1–1000000), max_bytes (1–536870912) and timeout_ms (1–90000)',
      {
        trace_id: failure.envelope.trace_id,
        retryable: false,
        audit_scope: 'application-history-structure',
        audit_completed: false,
        acknowledgement_dispatch_state: 'not-sent',
      },
    );
  }
}
interface AuditStep {
  page: SyncSavedPageFile;
  sequence: number;
  projectionJson: string;
  projectionHash: string;
  trace: string;
}
function count(value: unknown): number {
  if (typeof value !== 'string' || !/^(0|[1-9][0-9]*)$/.test(value)) throw new TypeError();
  const number = Number(value);
  if (!Number.isSafeInteger(number)) throw new TypeError();
  return number;
}
/** Caller owns the read transaction. No reducers or writes are performed by the audit. */
export function auditInboxApplicationHistory(
  db: DatabaseSync,
  key: { consumer: string; application: string },
  query: SyncInboxApplicationAuditQuery,
  trace: string,
  check: () => void,
  reads: {
    head(): AuditStep | undefined;
    step(digest: string): AuditStep | undefined;
    events(step: AuditStep): void;
  },
) {
  let checked_pages = 0;
  let checked_events = 0;
  let checked_bytes = 0;
  let stage = 'membership';
  let selected_digest: string | null = null;
  const details = () => ({
    audit_scope: 'application-history-structure',
    audit_completed: false,
    expected_identity: query.expected_identity,
    application: query.application,
    checked_pages,
    checked_events,
    checked_bytes,
    stage,
    selected_digest,
    max_pages: query.max_pages,
    max_events: query.max_events,
    max_bytes: query.max_bytes,
    timeout_ms: query.timeout_ms,
    acknowledgement_dispatch_state: 'not-sent',
  });
  const fail = (code: string, message: string) =>
    new ContractError(code, message, {
      trace_id: trace,
      retryable: false,
      details: details(),
    });
  const corrupt = () =>
    fail(
      'INBOX_APPLICATION_AUDIT_CORRUPT',
      'The complete selected application history is inconsistent; preserve the inbox',
    );
  const budget = () =>
    fail(
      'INBOX_APPLICATION_AUDIT_LIMIT_REACHED',
      'The complete application history exceeds the selected budget; no partial success is reported',
    );
  try {
    check();
    const boundedCount = (table: string, maximum: number) => {
      check();
      const row = db
        .prepare(
          `SELECT CAST(COUNT(*) AS TEXT) AS count FROM
        (SELECT 1 FROM ${table} WHERE consumer_key = ? AND application_key = ? LIMIT ?)`,
        )
        .get(key.consumer, key.application, maximum + 1);
      check();
      try {
        return count(row?.count);
      } catch {
        throw corrupt();
      }
    };
    // Only internal constant table names are used, and scalar counts stop at limit + 1.
    const pages = boundedCount('sync_inbox_application_steps', query.max_pages);
    if (pages > query.max_pages) throw budget();
    const events = boundedCount('sync_inbox_application_events', query.max_events);
    if (events > query.max_events) throw budget();
    stage = 'head';
    const head = reads.head();
    check();
    if ((head === undefined) !== (pages === 0) || (head && head.sequence !== pages))
      throw corrupt();
    let current = head;
    let expectedSequence = pages;
    let expectedDigest = head?.page.document_sha256 ?? null;
    let successorCursor: number | null = null;
    let emptySuccessorProjection: string | undefined;
    let root_sha256: string | null = null;
    while (expectedSequence > 0) {
      check();
      stage = 'page';
      selected_digest = expectedDigest;
      if (
        !current ||
        current.sequence !== expectedSequence ||
        current.page.document_sha256 !== expectedDigest ||
        current.page.document.query.limit !== head?.page.document.query.limit ||
        (successorCursor !== null &&
          current.page.document.page.data.next_cursor !== successorCursor)
      )
        throw corrupt();
      const document = current.page.document;
      const previous = document.previous_page_sha256;
      if (
        expectedSequence === 1
          ? previous !== null || document.query.cursor !== 0
          : previous === null
      )
        throw corrupt();
      if (
        emptySuccessorProjection !== undefined &&
        current.projectionJson !== emptySuccessorProjection
      )
        throw corrupt();
      const pageEvents = document.page.data.changes.length;
      const bytes =
        Buffer.byteLength(syncSavedPageDocumentJson(document), 'utf8') +
        Buffer.byteLength(current.projectionJson, 'utf8');
      if (checked_events + pageEvents > query.max_events || checked_bytes + bytes > query.max_bytes)
        throw budget();
      stage = 'events';
      reads.events(current);
      check();
      if (expectedSequence === 1 && pageEvents === 0 && current.projectionJson !== 'null')
        throw corrupt();
      checked_pages += 1;
      checked_events += pageEvents;
      checked_bytes += bytes;
      if (expectedSequence === 1) root_sha256 = current.page.document_sha256;
      successorCursor = document.query.cursor;
      emptySuccessorProjection = pageEvents === 0 ? current.projectionJson : undefined;
      expectedSequence -= 1;
      expectedDigest = previous;
      stage = 'predecessor';
      selected_digest = previous;
      current = previous === null ? undefined : reads.step(previous);
    }
    stage = 'coverage';
    check();
    if (expectedDigest !== null || checked_pages !== pages || checked_events !== events)
      throw corrupt();
    return { head, checked_pages, checked_events, checked_bytes, root_sha256 };
  } catch (error) {
    if (error instanceof ContractError) {
      throw new ContractError(error.envelope.code, error.envelope.message, {
        trace_id: trace,
        retryable: false,
        details: { ...error.envelope.details, ...details() },
      });
    }
    throw fail(
      'INBOX_APPLICATION_STORAGE_UNAVAILABLE',
      'The application history could not be read',
    );
  }
}
