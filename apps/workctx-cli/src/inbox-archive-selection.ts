import {
  ContractError,
  syncJsonSnapshot,
  type SyncPageChainFile,
  type SyncSavedPageFile,
} from '@planemem/contracts';

function fail(code: string, message: string, trace: string) {
  return new ContractError(code, message, {
    trace_id: trace,
    retryable: false,
    acknowledgement_dispatch_state: 'not-sent',
  });
}
function object(value: unknown, allowed: string[]) {
  const snapshot: unknown = JSON.parse(syncJsonSnapshot(value, 16384));
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) throw new TypeError();
  if (Object.keys(snapshot).some((key) => !allowed.includes(key))) throw new TypeError();
  return snapshot as Record<string, unknown>;
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
function historyQuery(value: unknown, trace: string) {
  try {
    const input = object(value, ['archive_document_sha256', 'after_sequence', 'limit']);
    const after_sequence = integer(
      input.after_sequence === undefined ? 0 : input.after_sequence,
      0,
    );
    const limit = integer(input.limit === undefined ? 20 : input.limit, 1, 50);
    const archive_document_sha256 =
      input.archive_document_sha256 === undefined
        ? undefined
        : digest(input.archive_document_sha256);
    if (after_sequence > 0 && archive_document_sha256 === undefined) throw new TypeError();
    return { after_sequence, limit, archive_document_sha256 };
  } catch {
    throw fail(
      'INBOX_ARCHIVE_HISTORY_QUERY_INVALID',
      'Supply optional limit (1 to 50), after_sequence and archive_document_sha256; every continuation must bind the archive digest',
      trace,
    );
  }
}
function detailQuery(value: unknown, trace: string) {
  try {
    const input = object(value, ['archive_document_sha256', 'document_sha256']);
    return {
      archive_document_sha256: digest(input.archive_document_sha256),
      document_sha256: digest(input.document_sha256),
    };
  } catch {
    throw fail(
      'INBOX_ARCHIVE_PAGE_QUERY_INVALID',
      'Supply the exact archive_document_sha256 and selected document_sha256',
      trace,
    );
  }
}
function assertArchive(saved: SyncPageChainFile, expected: string | undefined, trace: string) {
  if (expected !== undefined && expected !== saved.document_sha256)
    throw fail(
      'INBOX_ARCHIVE_CHANGED',
      'The archive document differs from the one originally selected; preserve the original query and archive',
      trace,
    );
}
function summary(page: SyncSavedPageFile, sequence: number) {
  const document = page.document;
  return {
    sequence,
    document_sha256: page.document_sha256,
    previous_page_sha256: document.previous_page_sha256,
    from_cursor: document.query.cursor,
    next_cursor: document.page.data.next_cursor,
    page_limit: document.query.limit,
    page_trace_id: document.page.trace_id,
    event_count: document.page.data.changes.length,
    page_has_more: document.page.data.has_more,
  };
}
/** The file adapter must validate the whole archive and every digest before selecting content. */
export function readArchivePageHistory(saved: SyncPageChainFile, input: unknown, trace: string) {
  const query = historyQuery(input, trace);
  assertArchive(saved, query.archive_document_sha256, trace);
  const pages = saved.document.pages;
  if (query.after_sequence > pages.length)
    throw fail(
      'INBOX_ARCHIVE_POSITION_INVALID',
      'The selected continuation is beyond this archive head',
      trace,
    );
  const items = pages
    .slice(query.after_sequence, query.after_sequence + query.limit)
    .map((page, index) => ({
      ...summary(page, query.after_sequence + index + 1),
      selection_query: {
        archive_document_sha256: saved.document_sha256,
        document_sha256: page.document_sha256,
      },
    }));
  const after = query.after_sequence + items.length;
  const has_more = after < pages.length;
  const result = {
    kind: 'archive-pages' as const,
    archive_document_sha256: saved.document_sha256,
    expected_identity: saved.document.expected_identity,
    items,
    after_sequence: query.after_sequence,
    limit: query.limit,
    page_count: pages.length,
    has_more,
    next_query: has_more
      ? {
          archive_document_sha256: saved.document_sha256,
          after_sequence: after,
          limit: query.limit,
        }
      : null,
    consistency: 'content-bound-archive' as const,
  };
  try {
    syncJsonSnapshot(result, 512 * 1024);
  } catch {
    throw fail(
      'INBOX_ARCHIVE_HISTORY_TOO_LARGE',
      'The complete summary exceeds 512 KiB; select a smaller limit',
      trace,
    );
  }
  return result;
}
/** Exact content selection; absence is distinct from malformed or changed input. */
export function readArchivePageByDigest(saved: SyncPageChainFile, input: unknown, trace: string) {
  const query = detailQuery(input, trace);
  assertArchive(saved, query.archive_document_sha256, trace);
  const index = saved.document.pages.findIndex(
    (page) => page.document_sha256 === query.document_sha256,
  );
  const page = index < 0 ? undefined : saved.document.pages[index];
  return {
    kind: 'archive-page' as const,
    archive_document_sha256: saved.document_sha256,
    document_sha256: query.document_sha256,
    expected_identity: saved.document.expected_identity,
    sequence: page === undefined ? null : index + 1,
    page: page ?? null,
    summary: page === undefined ? null : summary(page, index + 1),
    consistency: 'content-bound-archive' as const,
  };
}
