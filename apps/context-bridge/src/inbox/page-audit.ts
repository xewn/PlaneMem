import type { DatabaseSync } from 'node:sqlite';
import {
  ContractError,
  parseSyncCommandIdentity,
  syncJsonSnapshot,
  type SyncCommandIdentity,
  type SyncSavedPageFile,
} from '@planemem/contracts';

export interface SyncInboxPageAuditQuery {
  expected_identity: SyncCommandIdentity;
  max_pages: number;
}
export function parseInboxPageAuditQuery(value: unknown, trace: string): SyncInboxPageAuditQuery {
  try {
    const input: unknown = JSON.parse(syncJsonSnapshot(value, 16384));
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TypeError();
    const row = input as Record<string, unknown>;
    if (Object.keys(row).some((key) => key !== 'expected_identity' && key !== 'max_pages'))
      throw new TypeError();
    const max_pages = row.max_pages === undefined ? 1000 : row.max_pages;
    if (typeof max_pages !== 'number' || !Number.isSafeInteger(max_pages) || max_pages < 1)
      throw new TypeError();
    return { expected_identity: parseSyncCommandIdentity(row.expected_identity), max_pages };
  } catch {
    throw new ContractError(
      'INBOX_AUDIT_QUERY_INVALID',
      'Supply the complete original expected_identity and optional positive safe-integer max_pages',
      {
        trace_id: trace,
        retryable: false,
        audit_completed: false,
        acknowledgement_dispatch_state: 'not-sent',
      },
    );
  }
}

interface AuditPage {
  page: SyncSavedPageFile;
  sequence: number;
}
function count(value: unknown): bigint {
  if (typeof value !== 'string' || !/^(0|[1-9][0-9]{0,19})$/.test(value)) throw new TypeError();
  return BigInt(value);
}

/** The owner must keep every query and callback inside the same read transaction. */
export function auditInboxPageChain(
  db: DatabaseSync,
  key: string,
  maxPages: number,
  trace: string,
  reads: {
    head(): AuditPage | undefined;
    page(digest: string): AuditPage | undefined;
  },
) {
  let checked_pages = 0;
  let checked_events = 0;
  const fail = (code: string, message: string, details: Record<string, unknown>) =>
    new ContractError(code, message, {
      trace_id: trace,
      retryable: false,
      details: {
        audit_scope: 'consumer-page-chain',
        audit_completed: false,
        checked_pages,
        checked_events,
        max_pages: maxPages,
        ...details,
        acknowledgement_dispatch_state: 'not-sent',
      },
    });
  const corrupt = (reason: string, details: Record<string, unknown> = {}) =>
    fail(
      'INBOX_AUDIT_CORRUPT',
      'The selected consumer page chain is inconsistent; preserve the inbox',
      {
        reason,
        ...details,
      },
    );
  function read<T>(operation: () => T, details: Record<string, unknown>): T {
    try {
      return operation();
    } catch (error) {
      if (error instanceof ContractError && error.envelope.code === 'INBOX_CORRUPT')
        throw corrupt('stored-page-or-checkpoint-invalid', details);
      // A storage exception is not evidence of corrupt page contents.
      throw error;
    }
  }
  const counts = db
    .prepare(
      `SELECT
        (SELECT CAST(COUNT(*) AS TEXT) FROM sync_inbox_consumers WHERE consumer_key = ?) AS consumers,
        (SELECT CAST(COUNT(*) AS TEXT) FROM sync_inbox_pages WHERE consumer_key = ?) AS pages`,
    )
    .get(key, key);
  let consumers: bigint;
  let pages: bigint;
  try {
    consumers = count(counts?.consumers);
    pages = count(counts?.pages);
  } catch {
    throw corrupt('invalid-row-count', { stage: 'membership' });
  }
  if (consumers > 1n || (consumers === 0n) !== (pages === 0n))
    throw corrupt('consumer-page-membership-mismatch', {
      stage: 'membership',
      consumer_rows: consumers.toString(),
      page_rows: pages.toString(),
    });
  if (pages > BigInt(maxPages))
    throw fail(
      'INBOX_AUDIT_LIMIT_REACHED',
      'The full page chain exceeds max_pages; no partial audit is reported as complete',
      { stage: 'budget', required_pages: pages.toString() },
    );
  const head = read(() => reads.head(), { stage: 'checkpoint' });
  if ((head === undefined) !== (pages === 0n) || (head && BigInt(head.sequence) !== pages))
    throw corrupt('checkpoint-page-count-mismatch', {
      stage: 'checkpoint',
      page_rows: pages.toString(),
    });

  let current = head;
  let expectedSequence = head?.sequence ?? 0;
  let expectedDigest = head?.page.document_sha256 ?? null;
  let successorFrom: number | null = null;
  let root_sha256: string | null = null;
  while (expectedSequence > 0) {
    const location = {
      stage: 'page-chain',
      expected_sequence: expectedSequence,
      document_sha256: expectedDigest,
    };
    if (
      !current ||
      current.sequence !== expectedSequence ||
      current.page.document_sha256 !== expectedDigest ||
      current.page.document.query.limit !== head?.page.document.query.limit ||
      (successorFrom !== null && current.page.document.page.data.next_cursor !== successorFrom)
    )
      throw corrupt('page-link-mismatch', location);
    const document = current.page.document;
    const previous = document.previous_page_sha256;
    if (
      expectedSequence === 1 ? previous !== null || document.query.cursor !== 0 : previous === null
    )
      throw corrupt('root-or-predecessor-mismatch', location);
    const events = checked_events + document.page.data.changes.length;
    if (!Number.isSafeInteger(events))
      throw fail(
        'INBOX_AUDIT_LIMIT_REACHED',
        'The complete event count cannot be represented safely',
        location,
      );
    checked_pages += 1;
    checked_events = events;
    if (expectedSequence === 1) root_sha256 = current.page.document_sha256;
    successorFrom = document.query.cursor;
    expectedSequence -= 1;
    expectedDigest = previous;
    current =
      previous === null
        ? undefined
        : read(() => reads.page(previous), {
            stage: 'page-chain',
            expected_sequence: expectedSequence,
            document_sha256: previous,
          });
  }
  if (BigInt(checked_pages) !== pages || expectedDigest !== null)
    throw corrupt('incomplete-chain-coverage', { stage: 'coverage', page_rows: pages.toString() });
  return { head, checked_pages, checked_events, root_sha256 };
}
