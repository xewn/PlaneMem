import type { DatabaseSync } from 'node:sqlite';
import { isSyncIdentifier, syncJsonSnapshot } from '@planemem/contracts';
import {
  applicationFailure,
  parseInboxApplicationQuery,
  type SyncInboxApplicationQuery,
} from './application-model.js';
import type { SyncInboxApplicationRestoreReceipt } from './application-restore-receipts.js';

export interface SyncInboxApplicationRestoreReceiptAuditQuery extends SyncInboxApplicationQuery {
  max_receipts: number;
  max_bytes: number;
}

export function parseInboxApplicationRestoreReceiptAuditQuery(
  input: unknown,
  trace: string,
): SyncInboxApplicationRestoreReceiptAuditQuery {
  try {
    const value: unknown = JSON.parse(syncJsonSnapshot(input, 16384));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError();
    const {
      max_receipts = 1000,
      max_bytes = 64 * 1024 * 1024,
      ...base
    } = value as Record<string, unknown>;
    if (
      typeof max_receipts !== 'number' ||
      !Number.isSafeInteger(max_receipts) ||
      max_receipts < 1 ||
      max_receipts > 10000 ||
      typeof max_bytes !== 'number' ||
      !Number.isSafeInteger(max_bytes) ||
      max_bytes < 1 ||
      max_bytes > 512 * 1024 * 1024
    )
      throw new TypeError();
    return { ...parseInboxApplicationQuery(base, trace), max_receipts, max_bytes };
  } catch {
    throw applicationFailure(
      'INBOX_APPLICATION_RESTORE_RECEIPT_AUDIT_QUERY_INVALID',
      'Supply original identity/application and optional max_receipts (1–10000), max_bytes (1–536870912) and timeout_ms (1–90000)',
      trace,
    );
  }
}

/** Mutable progress remains available if the owning transaction cannot finish. */
export interface InboxApplicationRestoreReceiptAuditProgress {
  stage: 'schema' | 'membership' | 'receipts' | 'transaction-completion';
  receipt_count: number | null;
  checked_receipts: number;
  checked_bytes: number;
  selected_request_id: string | null;
}

/** Caller owns one read transaction and validates complete records, including their scope keys. */
export function auditInboxApplicationRestoreReceipts(
  db: DatabaseSync,
  key: { consumer: string; application: string },
  query: SyncInboxApplicationRestoreReceiptAuditQuery,
  trace: string,
  check: () => void,
  read: (id: string) => SyncInboxApplicationRestoreReceipt | undefined,
  progress: InboxApplicationRestoreReceiptAuditProgress,
) {
  const corrupt = () =>
    applicationFailure(
      'INBOX_APPLICATION_RESTORE_RECEIPT_AUDIT_CORRUPT',
      'The selected restore receipt membership, ordering or stored size is inconsistent; preserve the inbox',
      trace,
    );
  const budget = () =>
    applicationFailure(
      'INBOX_APPLICATION_RESTORE_RECEIPT_AUDIT_LIMIT_REACHED',
      'The complete selected restore receipt history exceeds the requested budget; audit is incomplete',
      trace,
    );
  progress.stage = 'membership';
  check();
  const membership = db
    .prepare(
      `SELECT CAST(COUNT(*) AS TEXT) AS count FROM (
    SELECT 1 FROM sync_inbox_application_restore_receipts
    WHERE consumer_key = ? AND application_key = ? LIMIT ?
  )`,
    )
    .get(key.consumer, key.application, query.max_receipts + 1);
  check();
  if (typeof membership?.count !== 'string' || !/^(0|[1-9][0-9]{0,4})$/.test(membership.count))
    throw corrupt();
  const total = Number(membership.count);
  if (total > query.max_receipts) throw budget();
  progress.receipt_count = total;
  progress.stage = 'receipts';
  let previous: string | undefined;
  let first: string | null = null;
  let target_bound_receipts = 0;
  const outcomes = { restored: 0, 'already-restored': 0, empty: 0 };
  while (true) {
    check();
    // Fetch only bounded metadata. Receipt bodies are read one at a time after checking budgets.
    const statement = db.prepare(`SELECT
      CASE WHEN typeof(restore_request_id) = 'text' AND length(CAST(restore_request_id AS BLOB)) <= 1020 THEN restore_request_id END AS restore_request_id,
      CASE WHEN typeof(receipt_json) = 'text' AND length(CAST(receipt_json AS BLOB)) BETWEEN 1 AND 65536 THEN length(CAST(receipt_json AS BLOB)) END AS receipt_bytes
      FROM sync_inbox_application_restore_receipts WHERE consumer_key = ? AND application_key = ?
      ${previous === undefined ? '' : 'AND restore_request_id COLLATE BINARY > ?'}
      ORDER BY restore_request_id COLLATE BINARY ASC LIMIT ?`);
    // Include one possible excess row so membership changes/inconsistencies never silently pass.
    const batchSize = Math.min(50, total - progress.checked_receipts + 1);
    const rows =
      previous === undefined
        ? statement.all(key.consumer, key.application, batchSize)
        : statement.all(key.consumer, key.application, previous, batchSize);
    check();
    if (rows.length === 0) break;
    for (const row of rows) {
      progress.selected_request_id = null;
      check();
      const id = row.restore_request_id;
      if (!isSyncIdentifier(id)) throw corrupt();
      progress.selected_request_id = id;
      if (
        previous !== undefined &&
        Buffer.compare(Buffer.from(id, 'utf8'), Buffer.from(previous, 'utf8')) <= 0
      )
        throw corrupt();
      const bytes = row.receipt_bytes;
      if (
        typeof bytes !== 'number' ||
        !Number.isSafeInteger(bytes) ||
        bytes < 1 ||
        bytes > 65536 ||
        progress.checked_receipts >= total
      )
        throw corrupt();
      if (bytes > query.max_bytes - progress.checked_bytes) throw budget();
      const receipt = read(id);
      if (
        !receipt ||
        receipt.query.restore_request_id !== id ||
        Buffer.byteLength(JSON.stringify(receipt), 'utf8') !== bytes
      )
        throw corrupt();
      check();
      progress.checked_receipts += 1;
      progress.checked_bytes += bytes;
      outcomes[receipt.outcome.status] += 1;
      if (receipt.query.expected_target !== undefined) target_bound_receipts += 1;
      first ??= id;
      previous = id;
      progress.selected_request_id = null;
    }
  }
  if (progress.checked_receipts !== total) throw corrupt();
  check();
  progress.stage = 'transaction-completion';
  return {
    kind: 'application-restore-receipt-audit' as const,
    audit_scope: 'original-consumer-application-restore-receipts' as const,
    audit_completed: true,
    full_receipt_history_audit: 'completed' as const,
    receipt_count: total,
    checked_receipts: progress.checked_receipts,
    checked_bytes: progress.checked_bytes,
    max_receipts: query.max_receipts,
    max_bytes: query.max_bytes,
    timeout_ms: query.timeout_ms,
    first_request_id: first,
    last_request_id: previous ?? null,
    outcomes,
    target_bound_receipts,
    order: 'request-id-binary-ascending' as const,
    consistency: 'single-read-transaction' as const,
    receipt_scope: 'historical-local-transaction' as const,
    current_state: 'not-read' as const,
    absence_proves_rollback: false,
    local_write_state: 'not-performed' as const,
  };
}
