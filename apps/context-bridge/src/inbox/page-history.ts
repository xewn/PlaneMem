import type { DatabaseSync } from 'node:sqlite';
import {
  ContractError,
  parseSyncCommandIdentity,
  syncJsonSnapshot,
  type SyncCommandIdentity,
  type SyncSavedPageFile,
} from '@planemem/contracts';

export interface SyncInboxPageHistoryQuery {
  expected_identity: SyncCommandIdentity;
  after_sequence: number;
  limit: number;
  after_sha256?: string;
  through_sequence?: number;
  through_sha256?: string;
}
export interface SyncInboxPageDetailQuery {
  expected_identity: SyncCommandIdentity;
  document_sha256: string;
}
interface Page {
  sequence: number;
  page: SyncSavedPageFile;
}
function fail(code: string, message: string, trace: string) {
  return new ContractError(code, message, {
    trace_id: trace,
    retryable: false,
    acknowledgement_dispatch_state: 'not-sent',
  });
}
function digest(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) throw new TypeError();
  return value;
}
function integer(value: unknown, min: number, max = Number.MAX_SAFE_INTEGER): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max)
    throw new TypeError();
  return value;
}
function object(value: unknown, fields: string[]) {
  const snapshot: unknown = JSON.parse(syncJsonSnapshot(value, 16384));
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) throw new TypeError();
  if (Object.keys(snapshot).some((key) => !fields.includes(key))) throw new TypeError();
  return snapshot as Record<string, unknown>;
}
export function parseInboxPageHistoryQuery(
  value: unknown,
  trace: string,
): SyncInboxPageHistoryQuery {
  try {
    const input = object(value, [
      'expected_identity',
      'after_sequence',
      'after_sha256',
      'through_sequence',
      'through_sha256',
      'limit',
    ]);
    const result: SyncInboxPageHistoryQuery = {
      expected_identity: parseSyncCommandIdentity(input.expected_identity),
      after_sequence: integer(input.after_sequence === undefined ? 0 : input.after_sequence, 0),
      limit: integer(input.limit === undefined ? 20 : input.limit, 1, 50),
    };
    if (input.through_sequence !== undefined || input.through_sha256 !== undefined) {
      result.through_sequence = integer(input.through_sequence, 1);
      result.through_sha256 = digest(input.through_sha256);
      if (result.after_sequence > result.through_sequence) throw new TypeError();
    }
    if (result.after_sequence > 0) {
      if (result.through_sequence === undefined) throw new TypeError();
      result.after_sha256 = digest(input.after_sha256);
      if (
        result.after_sequence === result.through_sequence &&
        result.after_sha256 !== result.through_sha256
      )
        throw new TypeError();
    } else if (input.after_sha256 !== undefined) throw new TypeError();
    return result;
  } catch {
    throw fail(
      'INBOX_PAGE_HISTORY_QUERY_INVALID',
      'Supply the original identity and valid page history parameters; continuations require both saved sequence/digest boundaries',
      trace,
    );
  }
}
export function parseInboxPageDetailQuery(value: unknown, trace: string): SyncInboxPageDetailQuery {
  try {
    const input = object(value, ['expected_identity', 'document_sha256']);
    return {
      expected_identity: parseSyncCommandIdentity(input.expected_identity),
      document_sha256: digest(input.document_sha256),
    };
  } catch {
    throw fail(
      'INBOX_PAGE_QUERY_INVALID',
      'Supply the complete original expected_identity and exact document_sha256',
      trace,
    );
  }
}
export function inboxPageSummary(selected: Page) {
  const document = selected.page.document;
  return {
    sequence: selected.sequence,
    document_sha256: selected.page.document_sha256,
    previous_page_sha256: document.previous_page_sha256,
    from_cursor: document.query.cursor,
    next_cursor: document.page.data.next_cursor,
    page_limit: document.query.limit,
    page_trace_id: document.page.trace_id,
    event_count: document.page.data.changes.length,
    page_has_more: document.page.data.has_more,
  };
}
/** The caller supplies fully validated page reads and one enclosing read transaction. */
export function readInboxPageHistory(
  db: DatabaseSync,
  key: string,
  query: SyncInboxPageHistoryQuery,
  head: Page | undefined,
  read: (digest: string) => Page | undefined,
  trace: string,
) {
  const changed = () =>
    fail(
      'INBOX_PAGE_HISTORY_BOUND_CHANGED',
      'A saved page history boundary is absent or differs from its original sequence/digest',
      trace,
    );
  const corrupt = () =>
    fail(
      'INBOX_PAGE_HISTORY_CORRUPT',
      'The selected page history contains a gap or mismatched page; preserve the inbox',
      trace,
    );
  const bound = query.through_sha256 === undefined ? head : read(query.through_sha256);
  if (
    query.through_sha256 !== undefined &&
    (!bound ||
      bound.sequence !== query.through_sequence ||
      bound.page.document_sha256 !== query.through_sha256)
  )
    throw changed();
  const after = query.after_sha256 === undefined ? undefined : read(query.after_sha256);
  if (
    query.after_sha256 !== undefined &&
    (!after ||
      after.sequence !== query.after_sequence ||
      after.page.document_sha256 !== query.after_sha256)
  )
    throw changed();
  const through_sequence = bound?.sequence ?? 0;
  const rows = db
    .prepare(
      `SELECT CASE WHEN length(document_sha256) = 64 THEN document_sha256 ELSE NULL END AS digest,
      CASE WHEN typeof(sequence) = 'integer' THEN CAST(sequence AS TEXT) ELSE NULL END AS sequence
      FROM sync_inbox_pages WHERE consumer_key = ? AND sequence > ? AND sequence <= ?
      ORDER BY sequence ASC LIMIT ?`,
    )
    .all(key, query.after_sequence, through_sequence, query.limit + 1);
  let previousSequence = query.after_sequence;
  const selected = rows.map((row) => {
    let sha: string;
    let sequence: number;
    try {
      sha = digest(row.digest);
      if (typeof row.sequence !== 'string' || !/^[1-9][0-9]*$/.test(row.sequence))
        throw new TypeError();
      sequence = integer(Number(row.sequence), 1);
    } catch {
      throw corrupt();
    }
    if (sequence !== previousSequence + 1 || sequence > through_sequence) throw corrupt();
    previousSequence = sequence;
    return { sha, sequence };
  });
  const has_more = selected.length > query.limit;
  if (!has_more && previousSequence !== through_sequence) throw corrupt();
  const items: ReturnType<typeof inboxPageSummary>[] = [];
  let previousDigest = after?.page.document_sha256 ?? null;
  let previousCursor = after?.page.document.page.data.next_cursor ?? 0;
  for (const metadata of selected.slice(0, query.limit)) {
    const page = read(metadata.sha);
    if (
      !page ||
      page.sequence !== metadata.sequence ||
      page.page.document_sha256 !== metadata.sha ||
      page.page.document.previous_page_sha256 !== previousDigest ||
      page.page.document.query.cursor !== previousCursor
    )
      throw corrupt();
    items.push(inboxPageSummary(page));
    previousDigest = page.page.document_sha256;
    previousCursor = page.page.document.page.data.next_cursor;
  }
  const last = items.at(-1);
  if (!has_more && last && last.document_sha256 !== bound?.page.document_sha256) throw corrupt();
  const result = {
    kind: 'pages' as const,
    expected_identity: query.expected_identity,
    items,
    after_sequence: query.after_sequence,
    after_sha256: query.after_sha256 ?? null,
    through_sequence,
    through_sha256: bound?.page.document_sha256 ?? null,
    limit: query.limit,
    has_more,
    next_query:
      has_more && last && bound
        ? {
            expected_identity: query.expected_identity,
            after_sequence: last.sequence,
            after_sha256: last.document_sha256,
            through_sequence,
            through_sha256: bound.page.document_sha256,
            limit: query.limit,
          }
        : null,
    consistency: 'fixed-boundaries-current-read' as const,
    full_chain_audit: 'not-performed' as const,
  };
  try {
    syncJsonSnapshot(result, 512 * 1024);
  } catch {
    throw fail(
      'INBOX_PAGE_HISTORY_TOO_LARGE',
      'The complete page history summary exceeds 512 KiB; select a smaller limit',
      trace,
    );
  }
  return result;
}
