import type { DatabaseSync } from 'node:sqlite';
import { syncApplicationArchiveSummary } from '@planemem/contracts';
import {
  compareInboxApplicationRestoreHistory,
  type InboxApplicationRestoreReads,
  type InboxApplicationSourceCompare,
} from './application-restore-comparison.js';
import type {
  prepareInboxApplicationRestore,
  SyncInboxApplicationRestoreQuery,
} from './application-restore.js';

/** Reads only. The surrounding readonly transaction supplies one target snapshot. */
export function previewInboxApplicationRestore(
  db: DatabaseSync,
  key: { consumer: string; application: string },
  query: SyncInboxApplicationRestoreQuery,
  prepared: ReturnType<typeof prepareInboxApplicationRestore>,
  trace: string,
  check: () => void,
  progress: { stage: string },
  reads: InboxApplicationRestoreReads & { sources: InboxApplicationSourceCompare },
) {
  progress.stage = 'application-history';
  const application = compareInboxApplicationRestoreHistory(
    db,
    key,
    query,
    prepared,
    trace,
    check,
    reads,
  ).comparison;
  progress.stage = 'received-history';
  const received = reads.sources(
    query.expected_identity,
    prepared.incoming.map((step) => step.page),
    trace,
    check,
  );
  check();
  const archive = syncApplicationArchiveSummary(prepared.archive.document);
  const compatible = application.compatible && received.compatible;
  const conflicts: string[] = [];
  if (!application.compatible) conflicts.push('application-history-policy');
  if (!received.compatible) conflicts.push('received-chain-diverged');
  progress.stage = 'result';
  return {
    preview_completed: true,
    restore_allowed: compatible,
    status: !compatible
      ? ('conflict' as const)
      : application.relation === 'identical'
        ? ('already-restored' as const)
        : archive.page_count === 0
          ? ('empty' as const)
          : ('ready' as const),
    archive_document_sha256: prepared.archive.document_sha256,
    archive,
    target_application: application,
    target_received: received,
    conflicts,
    planned_changes: compatible
      ? {
          added_received_pages: Math.max(0, archive.page_count - received.page_count),
          added_application_pages: application.relation === 'empty' ? archive.page_count : 0,
          added_application_events: application.relation === 'empty' ? archive.event_count : 0,
          preserved_received_suffix_pages: Math.max(0, received.page_count - archive.page_count),
          resulting_received_page_count: Math.max(received.page_count, archive.page_count),
          resulting_received_head_sha256:
            received.page_count >= archive.page_count ? received.head_sha256 : archive.head_sha256,
          resulting_application_page_count: archive.page_count,
          resulting_application_head_sha256: archive.head_sha256,
        }
      : null,
    restore_query: compatible ? { ...query } : null,
    target_snapshot: 'current-read-transaction-only' as const,
    restore_rechecks_target: true,
    application_history_policy: 'empty-or-identical' as const,
    source_page_policy: 'preserve-compatible-received-chain' as const,
    full_application_history_audit: 'verified-structure' as const,
    received_history_audit: 'verified-structure' as const,
    local_write_state: 'not-performed' as const,
    reducer_replay: 'not-performed' as const,
    restore_provenance: 'local-archive-not-authenticated' as const,
    event_ledger: 'derived-from-original-pages' as const,
  };
}
