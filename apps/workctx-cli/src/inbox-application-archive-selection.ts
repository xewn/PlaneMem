import {
  syncJsonSnapshot,
  type SyncApplicationArchiveFile,
  type SyncApplicationArchiveStep,
} from '@planemem/contracts';
import { applicationArchiveFailure as fail } from './inbox-application-archive-file.js';

function row(value: unknown, fields: string[]) {
  const input: unknown = JSON.parse(syncJsonSnapshot(value, 16384));
  if (
    !input ||
    typeof input !== 'object' ||
    Array.isArray(input) ||
    Object.keys(input).some((key) => !fields.includes(key))
  )
    throw new TypeError();
  return input as Record<string, unknown>;
}
function digest(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) throw new TypeError();
  return value;
}
function integer(value: unknown, minimum: number, maximum = Number.MAX_SAFE_INTEGER): number {
  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value) ||
    value < minimum ||
    value > maximum
  )
    throw new TypeError();
  return value;
}
function assertArchive(
  saved: SyncApplicationArchiveFile,
  expected: string | undefined,
  trace: string,
) {
  if (expected !== undefined && expected !== saved.document_sha256)
    throw fail(
      'INBOX_APPLICATION_ARCHIVE_CHANGED',
      'The archive differs from the original selected document',
      trace,
    );
}
function summary(step: SyncApplicationArchiveStep, sequence: number) {
  return {
    sequence,
    document_sha256: step.page.document_sha256,
    previous_sha256: step.page.document.previous_page_sha256,
    projection_sha256: step.projection_sha256,
    applied_cursor: step.page.document.page.data.next_cursor,
    event_count: step.page.document.page.data.changes.length,
    page_trace_id: step.page.document.page.trace_id,
    application_trace_id: step.application_trace_id,
  };
}
/** Only call after the file adapter verifies the entire archive and all digests. */
export function inspectApplicationArchive(
  saved: SyncApplicationArchiveFile,
  input: unknown,
  trace: string,
) {
  let after: number;
  let limit: number;
  let expected: string | undefined;
  try {
    const query = row(input, ['archive_document_sha256', 'after_sequence', 'limit']);
    after = integer(query.after_sequence === undefined ? 0 : query.after_sequence, 0);
    limit = integer(query.limit === undefined ? 20 : query.limit, 1, 50);
    expected =
      query.archive_document_sha256 === undefined
        ? undefined
        : digest(query.archive_document_sha256);
    if (after > 0 && expected === undefined) throw new TypeError();
  } catch {
    throw fail(
      'INBOX_APPLICATION_ARCHIVE_HISTORY_QUERY_INVALID',
      'Supply optional limit (1–50) and after_sequence; continuations must also bind archive_document_sha256',
      trace,
    );
  }
  assertArchive(saved, expected, trace);
  if (after > saved.document.steps.length)
    throw fail(
      'INBOX_APPLICATION_ARCHIVE_POSITION_INVALID',
      'The selected position is beyond this archive head',
      trace,
    );
  const items = saved.document.steps.slice(after, after + limit).map((step, index) => ({
    ...summary(step, after + index + 1),
    selection_query: {
      archive_document_sha256: saved.document_sha256,
      document_sha256: step.page.document_sha256,
    },
  }));
  const has_more = after + items.length < saved.document.steps.length;
  return {
    kind: 'application-archive-history' as const,
    items,
    after_sequence: after,
    limit,
    has_more,
    next_query: has_more
      ? {
          archive_document_sha256: saved.document_sha256,
          after_sequence: after + items.length,
          limit,
        }
      : null,
    consistency: 'content-bound-archive' as const,
  };
}
/** Exact content selection, with absence distinct from a malformed or changed archive. */
export function selectApplicationArchiveSnapshot(
  saved: SyncApplicationArchiveFile,
  input: unknown,
  trace: string,
) {
  let archive: string;
  let page: string;
  try {
    const query = row(input, ['archive_document_sha256', 'document_sha256']);
    archive = digest(query.archive_document_sha256);
    page = digest(query.document_sha256);
  } catch {
    throw fail(
      'INBOX_APPLICATION_ARCHIVE_SELECTION_INVALID',
      'Supply the exact archive_document_sha256 and original page document_sha256',
      trace,
    );
  }
  assertArchive(saved, archive, trace);
  const index = saved.document.steps.findIndex((step) => step.page.document_sha256 === page);
  const step = saved.document.steps[index];
  return {
    kind: 'application-archive-snapshot' as const,
    document_sha256: page,
    found: step !== undefined,
    snapshot: step ? { ...summary(step, index + 1), projection: step.projection } : null,
  };
}
