import type { DatabaseSync } from 'node:sqlite';
import {
  syncJsonSnapshot,
  syncSavedPageDocumentJson,
  type SyncSavedPageFile,
} from '@planemem/contracts';
import {
  applicationDigest,
  applicationFailure,
  parseInboxApplicationQuery,
  type SyncInboxApplicationQuery,
  type SyncInboxApplicationApplyQuery,
} from './application-model.js';
import { requireBuiltInApplication } from './built-in-applications.js';
import {
  inboxApplicationStepSummary,
  type InboxApplicationHistoryStep,
} from './application-history.js';
import { inboxPageSummary } from './page-history.js';

export interface SyncInboxApplicationPendingQuery extends SyncInboxApplicationQuery {
  limit: number;
}
export function parseInboxBuiltInApplicationPendingQuery(
  input: unknown,
  trace: string,
): SyncInboxApplicationPendingQuery {
  let query: SyncInboxApplicationPendingQuery;
  try {
    const value: unknown = JSON.parse(syncJsonSnapshot(input, 16384));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError();
    const { limit = 20, ...base } = value as Record<string, unknown>;
    if (typeof limit !== 'number' || !Number.isSafeInteger(limit) || limit < 1 || limit > 50)
      throw new TypeError();
    query = { ...parseInboxApplicationQuery(base, trace), limit };
  } catch {
    throw applicationFailure(
      'INBOX_APPLICATION_PENDING_QUERY_INVALID',
      'Supply the original identity/application with optional limit (1–50) and timeout_ms (1–90000)',
      trace,
    );
  }
  requireBuiltInApplication(query.application, trace);
  return query;
}
interface Page {
  page: SyncSavedPageFile;
  sequence: number;
}

/** One caller-owned read transaction. Lists only the window immediately after the saved head. */
export function readInboxApplicationPendingPages(
  db: DatabaseSync,
  consumer: string,
  query: SyncInboxApplicationPendingQuery,
  applied: InboxApplicationHistoryStep | undefined,
  received: Page | undefined,
  read: (digest: string) => Page,
  trace: string,
  check: () => void,
  progress: Record<string, unknown>,
) {
  const corrupt = () =>
    applicationFailure(
      'INBOX_APPLICATION_PENDING_CORRUPT',
      'The application head and selected received suffix contain an inconsistent boundary or gap',
      trace,
    );
  const after = applied?.sequence ?? 0;
  const through = received?.sequence ?? 0;
  if (
    after > through ||
    (applied &&
      (!received ||
        applied.page.document.query.limit !== received.page.document.query.limit ||
        applied.page.document.page.data.next_cursor >
          received.page.document.page.data.next_cursor)) ||
    (after === through &&
      (applied?.page.document_sha256 ?? null) !== (received?.page.document_sha256 ?? null))
  )
    throw corrupt();
  const seen = new Set<string>();
  let checkedBytes = 0;
  const charge = (page: Page | undefined) => {
    check();
    if (!page || seen.has(page.page.document_sha256)) return;
    checkedBytes += Buffer.byteLength(syncSavedPageDocumentJson(page.page.document), 'utf8');
    progress.checked_bytes = checkedBytes;
    if (checkedBytes > 64 * 1024 * 1024)
      throw applicationFailure(
        'INBOX_APPLICATION_PENDING_LIMIT_REACHED',
        'The selected pending pages and checkpoints exceed 64 MiB; request a smaller limit',
        trace,
      );
    seen.add(page.page.document_sha256);
    check();
  };
  charge(applied);
  charge(received);
  progress.stage = 'pending-pages';
  const rows = db
    .prepare(
      `SELECT
    CASE WHEN typeof(document_sha256) = 'text' AND length(document_sha256) = 64 THEN document_sha256 ELSE NULL END AS digest,
    CASE WHEN typeof(sequence) = 'integer' THEN CAST(sequence AS TEXT) ELSE NULL END AS sequence
    FROM sync_inbox_pages WHERE consumer_key = ? AND sequence > ? AND sequence <= ?
    ORDER BY sequence LIMIT ?`,
    )
    .all(consumer, after, through, query.limit + 1);
  check();
  if (rows.length !== Math.min(query.limit + 1, through - after)) throw corrupt();
  let previousSequence = after;
  let previousDigest = applied?.page.document_sha256 ?? null;
  let previousCursor = applied?.page.document.page.data.next_cursor ?? 0;
  const items: ReturnType<typeof inboxPageSummary>[] = [];
  for (const row of rows) {
    check();
    let digest: string;
    let sequence: number;
    try {
      digest = applicationDigest(row.digest);
      if (typeof row.sequence !== 'string' || !/^[1-9][0-9]*$/.test(row.sequence))
        throw new TypeError();
      sequence = Number(row.sequence);
      if (!Number.isSafeInteger(sequence)) throw new TypeError();
    } catch {
      throw corrupt();
    }
    progress.selected_sequence = sequence;
    progress.selected_document_sha256 = digest;
    if (sequence !== previousSequence + 1 || sequence > through) throw corrupt();
    const selected = read(digest);
    charge(selected);
    if (
      selected.sequence !== sequence ||
      selected.page.document_sha256 !== digest ||
      selected.page.document.previous_page_sha256 !== previousDigest ||
      selected.page.document.query.cursor !== previousCursor ||
      selected.page.document.query.limit !== received?.page.document.query.limit
    )
      throw corrupt();
    if (items.length < query.limit) items.push(inboxPageSummary(selected));
    previousSequence = sequence;
    previousDigest = digest;
    previousCursor = selected.page.document.page.data.next_cursor;
    progress.checked_pending_pages = sequence - after;
  }
  const has_more = rows.length > query.limit;
  if (
    !has_more &&
    (previousSequence !== through ||
      previousDigest !== (received?.page.document_sha256 ?? null) ||
      previousCursor !== (received?.page.document.page.data.next_cursor ?? 0))
  )
    throw corrupt();
  const first = items[0];
  const next_apply_query: SyncInboxApplicationApplyQuery | null = first
    ? {
        expected_identity: query.expected_identity,
        application: query.application,
        timeout_ms: query.timeout_ms,
        document_sha256: first.document_sha256,
        expected_previous_sha256: applied?.page.document_sha256 ?? null,
      }
    : null;
  progress.stage = 'completion';
  check();
  return {
    kind: 'application-pending-pages' as const,
    status: 'listed' as const,
    pending_query: query,
    listing_completed: true,
    application_checkpoint: applied ? inboxApplicationStepSummary(applied) : null,
    received_checkpoint: received ? inboxPageSummary(received) : null,
    pending_page_count: through - after,
    count_basis: 'checkpoint-sequence-difference' as const,
    items,
    has_more,
    limit: query.limit,
    checked_pending_pages: rows.length,
    checked_bytes: checkedBytes,
    next_apply_query,
    refresh_query: query,
    continuation: 'refresh-after-explicit-application' as const,
    budgets: { max_selected_bytes: 64 * 1024 * 1024, timeout_ms: query.timeout_ms },
    consistency: 'current-read-snapshot' as const,
    application_readiness: 'requires-preview-or-apply' as const,
    reducer_execution: 'not-performed' as const,
    received_history_audit: 'not-performed' as const,
    local_write_state: 'not-performed' as const,
  };
}
