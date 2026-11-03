import { createHash } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import {
  ContractError,
  isSyncIdentifier,
  assertSyncCommandIdentity,
  parseSyncApplicationArchiveFile,
  syncApplicationArchiveDocumentJson,
  syncApplicationArchiveProjectionJson,
  syncSavedPageDocumentJson,
  syncJsonSnapshot,
  SYNC_CHANGES_RESPONSE_BYTES,
  type SyncApplicationArchiveFile,
  type SyncCommandIdentity,
  type SyncSavedPageFile,
} from '@planemem/contracts';
import {
  applicationDigest,
  applicationFailure,
  parseInboxApplicationQuery,
  type SyncInboxApplicationQuery,
} from './application-model.js';
import {
  compareInboxApplicationRestoreHistory,
  type InboxApplicationRestoreReads,
} from './application-restore-comparison.js';
import {
  assertInboxApplicationRestoreTargetHistory,
  inboxApplicationRestoreTarget,
  parseInboxApplicationRestoreTarget,
  type SyncInboxApplicationRestoreTarget,
} from './application-restore-target.js';

export interface SyncInboxApplicationRestoreQuery extends SyncInboxApplicationQuery {
  archive_document_sha256: string;
  expected_target?: SyncInboxApplicationRestoreTarget;
  restore_request_id?: string;
}
export interface InboxApplicationSourceRestoreResult {
  added_received_pages: number;
  received_page_count: number;
  received_head_sha256: string | null;
  received_cursor: number;
  received_history_audit: 'verified-structure';
  previous_received_history_sha256: string;
  received_history_sha256: string;
}
export type InboxApplicationSourceRestore = (
  identity: SyncCommandIdentity,
  pages: readonly SyncSavedPageFile[],
  trace: string,
  check: () => void,
  expectedHistory?: string,
) => InboxApplicationSourceRestoreResult;
export interface InboxApplicationRestoreProgress {
  stage: string;
  prepared_received_pages: number;
  prepared_application_pages: number;
  prepared_application_events: number;
  selected_sequence: number | null;
  selected_document_sha256: string | null;
}
export function parseInboxApplicationRestoreQuery(
  input: unknown,
  trace: string,
): SyncInboxApplicationRestoreQuery {
  try {
    const value: unknown = JSON.parse(syncJsonSnapshot(input, 16384));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError();
    const { archive_document_sha256, expected_target, restore_request_id, ...base } =
      value as Record<string, unknown>;
    if (restore_request_id !== undefined && !isSyncIdentifier(restore_request_id))
      throw new TypeError();
    return {
      ...parseInboxApplicationQuery(base, trace),
      archive_document_sha256: applicationDigest(archive_document_sha256),
      ...(restore_request_id === undefined
        ? {}
        : { restore_request_id: restore_request_id as string }),
      ...(expected_target === undefined
        ? {}
        : {
            expected_target: parseInboxApplicationRestoreTarget(expected_target),
          }),
    };
  } catch {
    throw applicationFailure(
      'INBOX_APPLICATION_RESTORE_QUERY_INVALID',
      'Supply the complete original identity/application, exact archive_document_sha256, optional restore_request_id, complete v1 expected_target and timeout_ms',
      trace,
    );
  }
}
const hash = (json: string) => createHash('sha256').update(json).digest('hex');
/** Independent verification for Bridge callers, before any transaction or source-page writes. */
export function prepareInboxApplicationRestore(
  value: unknown,
  query: SyncInboxApplicationRestoreQuery,
  trace: string,
) {
  let archive: SyncApplicationArchiveFile;
  try {
    archive = parseSyncApplicationArchiveFile(value);
    if (hash(syncApplicationArchiveDocumentJson(archive.document)) !== archive.document_sha256)
      throw new TypeError();
    for (const step of archive.document.steps) {
      if (
        hash(syncSavedPageDocumentJson(step.page.document)) !== step.page.document_sha256 ||
        hash(syncApplicationArchiveProjectionJson(step.projection)) !== step.projection_sha256
      )
        throw new TypeError();
    }
  } catch {
    throw applicationFailure(
      'INBOX_APPLICATION_ARCHIVE_INVALID',
      'The complete application archive or one of its original digests is invalid',
      trace,
    );
  }
  try {
    assertSyncCommandIdentity(archive.document.expected_identity, query.expected_identity);
    if (
      archive.document_sha256 !== query.archive_document_sha256 ||
      JSON.stringify(archive.document.application) !== JSON.stringify(query.application)
    )
      throw new TypeError();
  } catch {
    throw applicationFailure(
      'INBOX_APPLICATION_RESTORE_INPUT_MISMATCH',
      'The archive differs from the original identity, application or digest selected for restore',
      trace,
    );
  }
  const incoming = archive.document.steps.map((step) => ({
    ...step,
    pageJson: syncSavedPageDocumentJson(step.page.document),
    projectionJson: syncApplicationArchiveProjectionJson(step.projection),
  }));
  return { archive, incoming };
}

/** Caller owns one write transaction for source pages, all restored steps, ledgers and the head. */
export function restoreInboxApplicationHistory(
  db: DatabaseSync,
  key: { consumer: string; application: string; applicationJson: string },
  query: SyncInboxApplicationRestoreQuery,
  prepared: ReturnType<typeof prepareInboxApplicationRestore>,
  trace: string,
  check: () => void,
  progress: InboxApplicationRestoreProgress,
  reads: InboxApplicationRestoreReads & { sources: InboxApplicationSourceRestore },
) {
  const { incoming } = prepared;
  const audit = (expectedHistory?: string) => {
    const compared = compareInboxApplicationRestoreHistory(
      db,
      key,
      query,
      prepared,
      trace,
      check,
      reads,
    );
    assertInboxApplicationRestoreTargetHistory(
      expectedHistory,
      compared.comparison.history_sha256,
      'application-history',
      trace,
    );
    const difference = compared.comparison.first_difference;
    if (difference) {
      progress.selected_sequence = difference.sequence;
      progress.selected_document_sha256 = difference.target_document_sha256;
    }
    if (!compared.comparison.compatible)
      throw new ContractError(
        'INBOX_APPLICATION_RESTORE_CONFLICT',
        'Restore requires an empty application or its exact complete archived history; existing projections are never merged, replaced or rewound',
        {
          trace_id: trace,
          retryable: false,
          details: { application_comparison: compared.comparison },
        },
      );
    return { ...compared.audited, history_sha256: compared.comparison.history_sha256 };
  };
  progress.stage = 'existing-application';
  const before = audit(query.expected_target?.application_history_sha256);
  progress.stage = 'source-pages';
  progress.selected_sequence = null;
  progress.selected_document_sha256 = null;
  const sources = reads.sources(
    query.expected_identity,
    incoming.map((step) => step.page),
    trace,
    check,
    query.expected_target?.received_history_sha256,
  );
  progress.prepared_received_pages = sources.added_received_pages;
  check();
  if (!before.head) {
    progress.stage = 'restore-steps';
    for (const [index, step] of incoming.entries()) {
      progress.selected_sequence = index + 1;
      progress.selected_document_sha256 = step.page.document_sha256;
      check();
      const document = step.page.document;
      db.prepare(
        `INSERT INTO sync_inbox_application_steps
        (consumer_key, application_key, document_sha256, previous_sha256, sequence, next_cursor, event_count, projection_json, projection_sha256, trace_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        key.consumer,
        key.application,
        step.page.document_sha256,
        document.previous_page_sha256,
        index + 1,
        document.page.data.next_cursor,
        document.page.data.changes.length,
        step.projectionJson,
        step.projection_sha256,
        step.application_trace_id,
      );
      progress.prepared_application_pages += 1;
      for (const event of document.page.data.changes) {
        check();
        db.prepare(
          `INSERT INTO sync_inbox_application_events
          (consumer_key, application_key, event_id, server_cursor, document_sha256, event_sha256) VALUES (?, ?, ?, ?, ?, ?)`,
        ).run(
          key.consumer,
          key.application,
          event.event_id,
          event.server_cursor,
          step.page.document_sha256,
          hash(syncJsonSnapshot(event, SYNC_CHANGES_RESPONSE_BYTES)),
        );
        progress.prepared_application_events += 1;
      }
    }
    const head = incoming.at(-1);
    if (head) {
      check();
      db.prepare(
        `INSERT INTO sync_inbox_applications (consumer_key, application_key, application_json, head_sha256) VALUES (?, ?, ?, ?)`,
      ).run(key.consumer, key.application, key.applicationJson, head.page.document_sha256);
    }
  }
  progress.stage = 'readback';
  const restored = audit();
  if (
    restored.checked_pages !== incoming.length ||
    (before.head && sources.added_received_pages !== 0)
  )
    throw applicationFailure(
      'INBOX_APPLICATION_RESTORE_READBACK_FAILED',
      'The complete restored history could not be confirmed before commit',
      trace,
    );
  progress.stage = 'completion';
  return {
    status: before.head
      ? ('already-restored' as const)
      : incoming.length
        ? ('restored' as const)
        : ('empty' as const),
    added_application_pages: progress.prepared_application_pages,
    added_application_events: progress.prepared_application_events,
    sources,
    restored,
    target_precondition:
      query.expected_target === undefined ? ('not-requested' as const) : ('matched' as const),
    target_before: inboxApplicationRestoreTarget(
      before.history_sha256,
      sources.previous_received_history_sha256,
    ),
    target_after: inboxApplicationRestoreTarget(
      restored.history_sha256,
      sources.received_history_sha256,
    ),
  };
}
