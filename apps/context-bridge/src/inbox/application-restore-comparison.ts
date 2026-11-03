import type { DatabaseSync } from 'node:sqlite';
import {
  ContractError,
  syncSavedPageDocumentJson,
  SYNC_APPLICATION_ARCHIVE_DOCUMENT_BYTES,
  SYNC_APPLICATION_ARCHIVE_MAX_PAGES,
  type SyncCommandIdentity,
  type SyncSavedPageFile,
} from '@planemem/contracts';
import { auditInboxApplicationHistory } from './application-audit.js';
import { auditInboxPageChain } from './page-audit.js';
import type { InboxApplicationHistoryStep } from './application-history.js';
import type {
  prepareInboxApplicationRestore,
  SyncInboxApplicationRestoreQuery,
} from './application-restore.js';

export interface InboxApplicationRestoreReads {
  head(): InboxApplicationHistoryStep | undefined;
  step(digest: string): InboxApplicationHistoryStep | undefined;
  events(step: InboxApplicationHistoryStep): void;
}
export interface InboxApplicationRestoreDifference {
  sequence: number;
  field: 'page' | 'projection' | 'application_trace_id';
  target_document_sha256: string;
  archive_document_sha256: string;
  target_projection_sha256?: string;
  archive_projection_sha256?: string;
}

/** Only a completed structural audit returns differences; corruption and limits remain errors. */
export function compareInboxApplicationRestoreHistory(
  db: DatabaseSync,
  key: { consumer: string; application: string },
  query: SyncInboxApplicationRestoreQuery,
  prepared: ReturnType<typeof prepareInboxApplicationRestore>,
  trace: string,
  check: () => void,
  reads: InboxApplicationRestoreReads,
) {
  const { incoming } = prepared;
  const progress: { first_difference: InboxApplicationRestoreDifference | null } = {
    first_difference: null,
  };
  const inspect = (selected: InboxApplicationHistoryStep | undefined) => {
    check();
    if (selected) {
      const expected = incoming[selected.sequence - 1];
      if (expected) {
        const field =
          selected.page.document_sha256 !== expected.page.document_sha256 ||
          syncSavedPageDocumentJson(selected.page.document) !== expected.pageJson
            ? 'page'
            : selected.projectionJson !== expected.projectionJson ||
                selected.projectionHash !== expected.projection_sha256
              ? 'projection'
              : selected.trace !== expected.application_trace_id
                ? 'application_trace_id'
                : null;
        if (
          field &&
          (!progress.first_difference || selected.sequence < progress.first_difference.sequence)
        )
          progress.first_difference = {
            sequence: selected.sequence,
            field,
            target_document_sha256: selected.page.document_sha256,
            archive_document_sha256: expected.page.document_sha256,
            target_projection_sha256: selected.projectionHash,
            archive_projection_sha256: expected.projection_sha256,
          };
      }
    }
    check();
    return selected;
  };
  const audited = auditInboxApplicationHistory(
    db,
    key,
    {
      ...query,
      max_pages: SYNC_APPLICATION_ARCHIVE_MAX_PAGES,
      max_events: SYNC_APPLICATION_ARCHIVE_MAX_PAGES * 500,
      max_bytes: SYNC_APPLICATION_ARCHIVE_DOCUMENT_BYTES,
    },
    trace,
    check,
    {
      head: () => inspect(reads.head()),
      step: (digest) => inspect(reads.step(digest)),
      events: reads.events,
    },
  );
  const relation = !audited.head
    ? ('empty' as const)
    : progress.first_difference
      ? ('different' as const)
      : audited.checked_pages < incoming.length
        ? ('target-prefix' as const)
        : audited.checked_pages > incoming.length
          ? ('target-longer' as const)
          : ('identical' as const);
  return {
    audited,
    comparison: {
      relation,
      compatible: relation === 'empty' || relation === 'identical',
      page_count: audited.checked_pages,
      event_count: audited.checked_events,
      checked_bytes: audited.checked_bytes,
      head_sha256: audited.head?.page.document_sha256 ?? null,
      head_projection_sha256: audited.head?.projectionHash ?? null,
      applied_cursor: audited.head?.page.document.page.data.next_cursor ?? 0,
      overlap_pages: Math.min(audited.checked_pages, incoming.length),
      first_difference: progress.first_difference,
      history_audit: 'verified-structure' as const,
    },
  };
}

interface SourcePage {
  page: SyncSavedPageFile;
  sequence: number;
  json: string;
}
export type InboxApplicationSourceCompare = (
  identity: SyncCommandIdentity,
  pages: readonly SyncSavedPageFile[],
  trace: string,
  check: () => void,
) => ReturnType<typeof compareInboxApplicationRestoreSources>;

/** Caller owns a transaction; this function only reads the complete received chain. */
export function compareInboxApplicationRestoreSources(
  db: DatabaseSync,
  key: string,
  pages: readonly SyncSavedPageFile[],
  trace: string,
  check: () => void,
  reads: { head(): SourcePage | undefined; page(digest: string): SourcePage | undefined },
) {
  let bytes = 0;
  let selected_digest: string | null = null;
  const progress: { first_difference: InboxApplicationRestoreDifference | null } = {
    first_difference: null,
  };
  try {
    const inspect = (selected: SourcePage | undefined) => {
      check();
      if (selected) {
        selected_digest = selected.page.document_sha256;
        bytes += Buffer.byteLength(selected.json, 'utf8');
        if (bytes > 64 * 1024 * 1024)
          throw new ContractError(
            'INBOX_APPLICATION_RESTORE_SOURCE_LIMIT_REACHED',
            'The received source chain exceeds its 64 MiB restore comparison budget',
            { trace_id: trace, retryable: false },
          );
        const expected = pages[selected.sequence - 1];
        if (
          expected &&
          (selected.page.document_sha256 !== expected.document_sha256 ||
            selected.json !== syncSavedPageDocumentJson(expected.document)) &&
          (!progress.first_difference || selected.sequence < progress.first_difference.sequence)
        )
          progress.first_difference = {
            sequence: selected.sequence,
            field: 'page',
            target_document_sha256: selected.page.document_sha256,
            archive_document_sha256: expected.document_sha256,
          };
      }
      check();
      return selected;
    };
    check();
    const audited = auditInboxPageChain(db, key, 10000, trace, {
      head: () => inspect(reads.head()),
      page: (digest) => {
        check();
        return inspect(reads.page(digest));
      },
    });
    check();
    const relation = !audited.head
      ? ('empty' as const)
      : progress.first_difference
        ? ('diverged' as const)
        : audited.checked_pages < pages.length
          ? ('target-prefix' as const)
          : audited.checked_pages > pages.length
            ? ('target-suffix' as const)
            : ('identical' as const);
    return {
      relation,
      compatible: relation !== 'diverged',
      page_count: audited.checked_pages,
      event_count: audited.checked_events,
      checked_bytes: bytes,
      head_sha256: audited.head?.page.document_sha256 ?? null,
      received_cursor: audited.head?.page.document.page.data.next_cursor ?? 0,
      overlap_pages: Math.min(audited.checked_pages, pages.length),
      first_difference: progress.first_difference,
      history_audit: 'verified-structure' as const,
    };
  } catch (error) {
    throw new ContractError(
      error instanceof ContractError ? error.envelope.code : 'INBOX_STORAGE_UNAVAILABLE',
      error instanceof ContractError
        ? error.envelope.message
        : 'The complete received chain could not be compared',
      {
        trace_id: trace,
        retryable: false,
        details: {
          ...(error instanceof ContractError ? error.envelope.details : {}),
          source_selected_digest: selected_digest,
          source_checked_bytes: bytes,
          max_received_pages: 10000,
          max_received_bytes: 64 * 1024 * 1024,
          comparison_completed: false,
          acknowledgement_dispatch_state: 'not-sent',
        },
      },
    );
  }
}
