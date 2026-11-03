import type { DatabaseSync } from 'node:sqlite';
import {
  syncJsonSnapshot,
  syncSavedPageDocumentJson,
  type SyncSavedPageFile,
} from '@planemem/contracts';
import { parseInboxPageHistoryQuery, type SyncInboxPageHistoryQuery } from './page-history.js';
import {
  applicationDigest,
  applicationFailure,
  parseInboxApplicationQuery,
  type SyncInboxApplicationQuery,
} from './application-model.js';

export interface SyncInboxApplicationHistoryQuery
  extends SyncInboxApplicationQuery,
    Omit<SyncInboxPageHistoryQuery, 'expected_identity'> {
  after_projection_sha256?: string;
  through_projection_sha256?: string;
}
export interface SyncInboxApplicationSnapshotQuery extends SyncInboxApplicationQuery {
  document_sha256: string;
  expected_projection_sha256?: string;
}
export interface InboxApplicationHistoryStep {
  page: SyncSavedPageFile;
  sequence: number;
  projectionJson: string;
  projectionHash: string;
  trace: string;
}
function object(value: unknown) {
  const input: unknown = JSON.parse(syncJsonSnapshot(value, 16384));
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TypeError();
  return input as Record<string, unknown>;
}
export function parseInboxApplicationHistoryQuery(
  value: unknown,
  trace: string,
): SyncInboxApplicationHistoryQuery {
  try {
    const input = object(value);
    const {
      after_sequence,
      after_sha256,
      through_sequence,
      through_sha256,
      limit,
      after_projection_sha256,
      through_projection_sha256,
      ...base
    } = input;
    const query = parseInboxApplicationQuery(base, trace);
    const pagination = parseInboxPageHistoryQuery(
      {
        expected_identity: query.expected_identity,
        ...Object.fromEntries(
          Object.entries({
            after_sequence,
            after_sha256,
            through_sequence,
            through_sha256,
            limit,
          }).filter(([, entry]) => entry !== undefined),
        ),
      },
      trace,
    );
    const result: SyncInboxApplicationHistoryQuery = { ...query, ...pagination };
    if (pagination.through_sha256 !== undefined)
      result.through_projection_sha256 = applicationDigest(through_projection_sha256);
    else if (through_projection_sha256 !== undefined) throw new TypeError();
    if (pagination.after_sha256 !== undefined)
      result.after_projection_sha256 = applicationDigest(after_projection_sha256);
    else if (after_projection_sha256 !== undefined) throw new TypeError();
    if (
      pagination.after_sequence === pagination.through_sequence &&
      result.after_projection_sha256 !== result.through_projection_sha256
    )
      throw new TypeError();
    return result;
  } catch {
    throw applicationFailure(
      'INBOX_APPLICATION_HISTORY_QUERY_INVALID',
      'Supply the original identity/application and history query; continuation boundaries require sequence, page and projection digests',
      trace,
    );
  }
}
export function parseInboxApplicationSnapshotQuery(
  value: unknown,
  trace: string,
): SyncInboxApplicationSnapshotQuery {
  try {
    const { document_sha256, expected_projection_sha256, ...base } = object(value);
    return {
      ...parseInboxApplicationQuery(base, trace),
      document_sha256: applicationDigest(document_sha256),
      ...(expected_projection_sha256 === undefined
        ? {}
        : { expected_projection_sha256: applicationDigest(expected_projection_sha256) }),
    };
  } catch {
    throw applicationFailure(
      'INBOX_APPLICATION_SNAPSHOT_QUERY_INVALID',
      'Supply the original identity/application, exact page digest and optional expected projection digest',
      trace,
    );
  }
}
export function inboxApplicationStepSummary(step: InboxApplicationHistoryStep) {
  const document = step.page.document;
  return {
    sequence: step.sequence,
    document_sha256: step.page.document_sha256,
    previous_sha256: document.previous_page_sha256,
    projection_sha256: step.projectionHash,
    projection_bytes: Buffer.byteLength(step.projectionJson, 'utf8'),
    from_cursor: document.query.cursor,
    applied_cursor: document.page.data.next_cursor,
    event_count: document.page.data.changes.length,
    page_trace_id: document.page.trace_id,
    application_trace_id: step.trace,
  };
}
/** Charges distinct selected snapshots. Per-step decoding and adjacent-page reads have separate limits. */
export function applicationHistoryBudget(trace: string, check: () => void) {
  const seen = new Set<string>();
  let bytes = 0;
  return (step: InboxApplicationHistoryStep) => {
    check();
    if (seen.has(step.page.document_sha256)) return;
    bytes +=
      Buffer.byteLength(syncSavedPageDocumentJson(step.page.document), 'utf8') +
      Buffer.byteLength(step.projectionJson, 'utf8');
    if (bytes > 64 * 1024 * 1024)
      throw applicationFailure(
        'INBOX_APPLICATION_HISTORY_LIMIT_REACHED',
        'The selected application snapshots exceed 64 MiB; request a smaller history page',
        trace,
      );
    seen.add(step.page.document_sha256);
    check();
  };
}
/** Requires a caller-owned read transaction and fully checked step/ledger reads. */
export function readInboxApplicationHistory(
  db: DatabaseSync,
  key: { consumer: string; application: string },
  query: SyncInboxApplicationHistoryQuery,
  head: InboxApplicationHistoryStep | undefined,
  read: (digest: string) => InboxApplicationHistoryStep | undefined,
  trace: string,
  check: () => void,
) {
  const changed = () =>
    applicationFailure(
      'INBOX_APPLICATION_HISTORY_BOUND_CHANGED',
      'A saved application boundary is absent or its sequence/page/projection digest changed',
      trace,
    );
  const corrupt = () =>
    applicationFailure(
      'INBOX_APPLICATION_HISTORY_CORRUPT',
      'The selected application history contains a gap or inconsistent snapshot',
      trace,
    );
  const bound = query.through_sha256 === undefined ? head : read(query.through_sha256);
  if (
    query.through_sha256 !== undefined &&
    (!bound ||
      bound.sequence !== query.through_sequence ||
      bound.projectionHash !== query.through_projection_sha256)
  )
    throw changed();
  const after = query.after_sha256 === undefined ? undefined : read(query.after_sha256);
  if (
    query.after_sha256 !== undefined &&
    (!after ||
      after.sequence !== query.after_sequence ||
      after.projectionHash !== query.after_projection_sha256)
  )
    throw changed();
  const through = bound?.sequence ?? 0;
  check();
  const rows = db
    .prepare(
      `SELECT
    CASE WHEN typeof(document_sha256) = 'text' AND length(document_sha256) = 64 THEN document_sha256 ELSE NULL END AS digest,
    CASE WHEN typeof(sequence) = 'integer' THEN CAST(sequence AS TEXT) ELSE NULL END AS sequence
    FROM sync_inbox_application_steps WHERE consumer_key = ? AND application_key = ?
    AND sequence > ? AND sequence <= ? ORDER BY sequence LIMIT ?`,
    )
    .all(key.consumer, key.application, query.after_sequence, through, query.limit + 1);
  check();
  let previousSequence = query.after_sequence;
  let previousDigest = after?.page.document_sha256 ?? null;
  let previousCursor = after?.page.document.page.data.next_cursor ?? 0;
  let previousProjection = after?.projectionJson ?? 'null';
  const items: (ReturnType<typeof inboxApplicationStepSummary> & {
    selection_query: SyncInboxApplicationSnapshotQuery;
  })[] = [];
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
    if (sequence !== previousSequence + 1 || sequence > through) throw corrupt();
    const step = read(digest);
    if (
      !step ||
      step.sequence !== sequence ||
      step.page.document_sha256 !== digest ||
      step.page.document.previous_page_sha256 !== previousDigest ||
      step.page.document.query.cursor !== previousCursor ||
      step.page.document.query.limit !== bound?.page.document.query.limit ||
      (step.page.document.page.data.changes.length === 0 &&
        step.projectionJson !== previousProjection)
    )
      throw corrupt();
    if (items.length < query.limit)
      items.push({
        ...inboxApplicationStepSummary(step),
        selection_query: {
          expected_identity: query.expected_identity,
          application: query.application,
          timeout_ms: query.timeout_ms,
          document_sha256: digest,
          expected_projection_sha256: step.projectionHash,
        },
      });
    previousSequence = sequence;
    previousDigest = digest;
    previousCursor = step.page.document.page.data.next_cursor;
    previousProjection = step.projectionJson;
  }
  const has_more = rows.length > query.limit;
  if (
    !has_more &&
    (previousSequence !== through || previousDigest !== (bound?.page.document_sha256 ?? null))
  )
    throw corrupt();
  const last = items.at(-1);
  const result = {
    kind: 'application-history' as const,
    items,
    limit: query.limit,
    has_more,
    after_sequence: query.after_sequence,
    after_sha256: query.after_sha256 ?? null,
    after_projection_sha256: query.after_projection_sha256 ?? null,
    through_sequence: through,
    through_sha256: bound?.page.document_sha256 ?? null,
    through_projection_sha256: bound?.projectionHash ?? null,
    current_checkpoint: head ? inboxApplicationStepSummary(head) : null,
    next_query:
      has_more && last && bound
        ? {
            expected_identity: query.expected_identity,
            application: query.application,
            timeout_ms: query.timeout_ms,
            limit: query.limit,
            after_sequence: last.sequence,
            after_sha256: last.document_sha256,
            after_projection_sha256: last.projection_sha256,
            through_sequence: through,
            through_sha256: bound.page.document_sha256,
            through_projection_sha256: bound.projectionHash,
          }
        : null,
    consistency: 'fixed-boundaries-current-read' as const,
  };
  try {
    syncJsonSnapshot(result, 512 * 1024);
  } catch {
    throw applicationFailure(
      'INBOX_APPLICATION_HISTORY_LIMIT_REACHED',
      'The history response exceeds 512 KiB; request a smaller limit',
      trace,
    );
  }
  check();
  return result;
}
