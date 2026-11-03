import { createHash } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import {
  parseSyncCommandIdentity,
  syncJsonSnapshot,
  syncSavedPageDocumentJson,
} from '@planemem/contracts';
import {
  applicationDigest,
  applicationFailure,
  applicationTrace,
  parseInboxApplicationQuery,
  type SyncInboxApplicationQuery,
} from './application-model.js';
import {
  inboxApplicationStepSummary,
  type InboxApplicationHistoryStep,
} from './application-history.js';

export interface SyncInboxApplicationCatalogQuery
  extends Pick<SyncInboxApplicationQuery, 'expected_identity' | 'timeout_ms'> {
  limit: number;
  after_application_key?: string;
}
export function parseInboxApplicationCatalogQuery(
  input: unknown,
  trace: string,
): SyncInboxApplicationCatalogQuery {
  try {
    applicationTrace(trace);
    const value: unknown = JSON.parse(syncJsonSnapshot(input, 16384));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError();
    const row = value as Record<string, unknown>;
    if (
      Object.keys(row).some(
        (field) =>
          !['expected_identity', 'timeout_ms', 'limit', 'after_application_key'].includes(field),
      )
    )
      throw new TypeError();
    const limit = row.limit === undefined ? 20 : row.limit;
    const timeout = row.timeout_ms === undefined ? 30_000 : row.timeout_ms;
    if (
      typeof limit !== 'number' ||
      !Number.isSafeInteger(limit) ||
      limit < 1 ||
      limit > 50 ||
      typeof timeout !== 'number' ||
      !Number.isSafeInteger(timeout) ||
      timeout < 1 ||
      timeout > 90_000
    )
      throw new TypeError();
    return {
      expected_identity: parseSyncCommandIdentity(row.expected_identity),
      timeout_ms: timeout,
      limit,
      ...(row.after_application_key === undefined
        ? {}
        : {
            after_application_key: applicationDigest(row.after_application_key),
          }),
    };
  } catch {
    throw applicationFailure(
      'INBOX_APPLICATION_CATALOG_QUERY_INVALID',
      'Supply the complete original identity with optional limit (1–50), timeout_ms (1–90000) and lowercase 64-hex after_application_key',
      trace,
    );
  }
}
const hash = (json: string) => createHash('sha256').update(json).digest('hex');

/** The caller owns a read transaction and supplies fully validated application head/ledger reads. */
export function readInboxApplicationCatalog(
  db: DatabaseSync,
  query: SyncInboxApplicationCatalogQuery,
  read: (selection: SyncInboxApplicationQuery) => InboxApplicationHistoryStep | undefined,
  trace: string,
  check: () => void,
) {
  const corrupt = () =>
    applicationFailure(
      'INBOX_APPLICATION_CATALOG_CORRUPT',
      'A selected application descriptor, lookup key or checkpoint is inconsistent; preserve the inbox',
      trace,
    );
  const consumer = hash(JSON.stringify(query.expected_identity));
  check();
  const statement = db.prepare(`SELECT
    CASE WHEN typeof(application_key) = 'text' AND length(CAST(application_key AS BLOB)) = 64 THEN application_key ELSE NULL END AS application_key,
    CASE WHEN typeof(application_json) = 'text' AND length(CAST(application_json AS BLOB)) <= 16384 THEN application_json ELSE NULL END AS application_json
    FROM sync_inbox_applications WHERE consumer_key = ?
    ${query.after_application_key === undefined ? '' : 'AND application_key COLLATE BINARY > ?'}
    ORDER BY application_key COLLATE BINARY ASC LIMIT ?`);
  // The first page has no key predicate, so malformed empty/null keys are not silently skipped.
  const rows =
    query.after_application_key === undefined
      ? statement.all(consumer, query.limit + 1)
      : statement.all(consumer, query.after_application_key, query.limit + 1);
  check();
  const items: {
    application_key: string;
    application: SyncInboxApplicationQuery['application'];
    checkpoint: ReturnType<typeof inboxApplicationStepSummary>;
    application_query: SyncInboxApplicationQuery;
    history_query: SyncInboxApplicationQuery & {
      through_sequence: number;
      through_sha256: string;
      through_projection_sha256: string;
    };
    snapshot_query: SyncInboxApplicationQuery & {
      document_sha256: string;
      expected_projection_sha256: string;
    };
  }[] = [];
  let previous = query.after_application_key;
  let selected_bytes = 0;
  for (const row of rows) {
    check();
    let key: string;
    let selection: SyncInboxApplicationQuery;
    try {
      key = applicationDigest(row.application_key);
      if (previous !== undefined && key <= previous) throw new TypeError();
      if (typeof row.application_json !== 'string') throw new TypeError();
      selection = parseInboxApplicationQuery(
        {
          expected_identity: query.expected_identity,
          timeout_ms: query.timeout_ms,
          application: JSON.parse(row.application_json) as unknown,
        },
        trace,
      );
      const json = JSON.stringify(selection.application);
      if (json !== row.application_json || hash(json) !== key) throw new TypeError();
    } catch {
      throw corrupt();
    }
    // Read and validate the lookahead too. Storage failures keep their original categories.
    const head = read(selection);
    if (!head) throw corrupt();
    selected_bytes +=
      Buffer.byteLength(syncSavedPageDocumentJson(head.page.document), 'utf8') +
      Buffer.byteLength(head.projectionJson, 'utf8');
    if (selected_bytes > 64 * 1024 * 1024)
      throw applicationFailure(
        'INBOX_APPLICATION_CATALOG_LIMIT_REACHED',
        'Selected application heads exceed 64 MiB; request a smaller catalog page',
        trace,
      );
    check();
    if (items.length < query.limit)
      items.push({
        application_key: key,
        application: selection.application,
        checkpoint: inboxApplicationStepSummary(head),
        application_query: selection,
        history_query: {
          ...selection,
          through_sequence: head.sequence,
          through_sha256: head.page.document_sha256,
          through_projection_sha256: head.projectionHash,
        },
        snapshot_query: {
          ...selection,
          document_sha256: head.page.document_sha256,
          expected_projection_sha256: head.projectionHash,
        },
      });
    previous = key;
  }
  const has_more = rows.length > query.limit;
  const last = items.at(-1);
  const result = {
    schema_version: 1 as const,
    trace_id: trace,
    source_refs: [],
    scope: {
      tenant_id: query.expected_identity.tenant_id,
      workspace_id: query.expected_identity.workspace_id,
      project_id: query.expected_identity.project_id,
    },
    expected_identity: query.expected_identity,
    kind: 'application-catalog' as const,
    items,
    limit: query.limit,
    after_application_key: query.after_application_key ?? null,
    has_more,
    next_query:
      has_more && last
        ? {
            expected_identity: query.expected_identity,
            timeout_ms: query.timeout_ms,
            limit: query.limit,
            after_application_key: last.application_key,
          }
        : null,
    selected_bytes,
    checked_applications: rows.length,
    consistency: 'keyset-current-state' as const,
    application_scope: 'local-reducer' as const,
    server_application: 'not-verified' as const,
    source_authenticity: 'not-verified' as const,
    projection_semantics: 'not-verified' as const,
    full_application_history_audit: 'not-performed' as const,
    orphan_application_audit: 'not-performed' as const,
    physical_database_audit: 'not-performed' as const,
    acknowledgement_dispatch_state: 'not-sent' as const,
  };
  try {
    syncJsonSnapshot(result, 512 * 1024);
  } catch {
    throw applicationFailure(
      'INBOX_APPLICATION_CATALOG_TOO_LARGE',
      'The complete application catalog response exceeds 512 KiB; request a smaller limit',
      trace,
    );
  }
  check();
  return result;
}
