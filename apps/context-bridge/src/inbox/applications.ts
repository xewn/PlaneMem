import { createHash } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import {
  ContractError,
  syncJsonSnapshot,
  SYNC_CHANGES_RESPONSE_BYTES,
  parseSyncApplicationArchiveDocument,
  syncApplicationArchiveDocumentJson,
  SYNC_APPLICATION_ARCHIVE_DOCUMENT_BYTES,
  SYNC_APPLICATION_ARCHIVE_MAX_PAGES,
  type SyncApplicationArchiveStep,
  type SyncApplicationArchiveFile,
  type SyncCommandIdentity,
  type SyncSavedPageFile,
  type SyncChange,
} from '@planemem/contracts';
import {
  applicationDigest,
  applicationFailure,
  applicationHandlers,
  applicationTrace,
  parseInboxApplicationQuery,
  parseInboxApplicationApplyQuery,
  INBOX_APPLICATION_STATE_BYTES,
  INBOX_APPLICATION_REDUCTION_BYTES,
  type SyncInboxApplicationQuery,
  type SyncInboxApplicationApplyQuery,
  type SyncInboxApplicationState,
  type SyncInboxApplicationHandlers,
} from './application-model.js';
import { SYNC_INBOX_APPLICATION_SCHEMA_V1 } from './application-schema.js';
import { InboxApplicationRejection } from './application-rejection.js';
import {
  builtInApplicationAdapter,
  parseInboxBuiltInApplicationApplyQuery,
} from './built-in-applications.js';
import {
  parseInboxApplicationRestoreQuery,
  prepareInboxApplicationRestore,
  restoreInboxApplicationHistory,
  type InboxApplicationRestoreProgress,
  type InboxApplicationSourceRestore,
} from './application-restore.js';
import { previewInboxApplicationRestore } from './application-restore-preview.js';
import {
  InboxApplicationRestoreReceipts,
  parseInboxApplicationRestoreReceiptQuery,
  parseInboxApplicationRestoreReceiptSelection,
  type SyncInboxApplicationRestoreReceipt,
} from './application-restore-receipts.js';
import type { InboxApplicationSourceCompare } from './application-restore-comparison.js';
import {
  parseInboxApplicationRestoreReceiptCatalogQuery,
  readInboxApplicationRestoreReceiptCatalog,
} from './application-restore-receipt-catalog.js';
import {
  parseInboxApplicationRestoreReceiptScopesQuery,
  readInboxApplicationRestoreReceiptScopes,
} from './application-restore-receipt-scopes.js';
import {
  auditInboxApplicationRestoreReceipts,
  parseInboxApplicationRestoreReceiptAuditQuery,
  type InboxApplicationRestoreReceiptAuditProgress,
} from './application-restore-receipt-audit.js';
import {
  parseInboxApplicationCatalogQuery,
  readInboxApplicationCatalog,
} from './application-catalog.js';
import {
  parseInboxBuiltInApplicationReplayQuery,
  replayInboxApplicationHistory,
} from './application-replay.js';
import {
  applicationHistoryBudget,
  inboxApplicationStepSummary,
  parseInboxApplicationHistoryQuery,
  parseInboxApplicationSnapshotQuery,
  readInboxApplicationHistory,
} from './application-history.js';
import {
  auditInboxApplicationHistory,
  parseInboxApplicationAuditQuery,
} from './application-audit.js';

type ReadPage = (
  identity: SyncCommandIdentity,
  digest: string,
  trace: string,
) => { page: SyncSavedPageFile; sequence: number };
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const size = (value: string) => new TextEncoder().encode(value).byteLength;
function integer(value: unknown) {
  if (typeof value !== 'string' || !/^(0|[1-9][0-9]*)$/.test(value)) throw new TypeError();
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new TypeError();
  return parsed;
}
function keys(query: SyncInboxApplicationQuery) {
  const applicationJson = JSON.stringify(query.application);
  return {
    consumer: hash(JSON.stringify(query.expected_identity)),
    application: hash(applicationJson),
    applicationJson,
  };
}
interface Step {
  page: SyncSavedPageFile;
  sequence: number;
  projectionJson: string;
  projectionHash: string;
  trace: string;
}
const schema = {
  sync_inbox_application_schema: ['singleton', 'version'],
  sync_inbox_application_steps: [
    'consumer_key',
    'application_key',
    'document_sha256',
    'previous_sha256',
    'sequence',
    'next_cursor',
    'event_count',
    'projection_json',
    'projection_sha256',
    'trace_id',
  ],
  sync_inbox_applications: ['consumer_key', 'application_key', 'application_json', 'head_sha256'],
  sync_inbox_application_events: [
    'consumer_key',
    'application_key',
    'event_id',
    'server_cursor',
    'document_sha256',
    'event_sha256',
  ],
};
const objects = [
  ...Object.keys(schema).map((name) => [name, 'table'] as const),
  ['idx_sync_inbox_application_root', 'index'],
  ['idx_sync_inbox_application_page_events', 'index'],
  ['sync_inbox_application_steps_no_update', 'trigger'],
  ['sync_inbox_application_steps_no_delete', 'trigger'],
  ['sync_inbox_application_events_no_update', 'trigger'],
  ['sync_inbox_application_events_no_delete', 'trigger'],
] as const;

/** Only the returned local projection is persisted. Reducers must not perform external effects. */
export class InboxApplications {
  constructor(
    private readonly db: DatabaseSync,
    private readonly readOnly: boolean,
    private readonly readPage: ReadPage,
    private readonly restorePages: InboxApplicationSourceRestore,
    private readonly comparePages: InboxApplicationSourceCompare,
  ) {}
  private corrupt(trace: string) {
    return applicationFailure(
      'INBOX_APPLICATION_CORRUPT',
      'The selected application checkpoint, snapshot or event ledger is inconsistent; preserve the inbox',
      trace,
    );
  }
  private run<T>(
    trace: string,
    timeout: number,
    write: boolean,
    work: (check: () => void) => T,
  ): T {
    const deadline = performance.now() + timeout;
    const check = () => {
      if (performance.now() >= deadline)
        throw applicationFailure(
          'INBOX_APPLICATION_TIMEOUT',
          'The local application operation exceeded its budget before commit',
          trace,
        );
    };
    let begun = false;
    let committing = false;
    try {
      applicationTrace(trace);
      if (write && this.readOnly)
        throw applicationFailure('INBOX_READ_ONLY', 'This inbox was opened for reading', trace);
      check();
      this.db.exec(write ? 'BEGIN IMMEDIATE' : 'BEGIN');
      begun = true;
      const result = work(check);
      check();
      committing = true;
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      let rollback = 'not-needed';
      if (begun) {
        try {
          this.db.exec('ROLLBACK');
          rollback = 'succeeded';
        } catch {
          rollback = 'failed';
        }
      }
      const failure =
        error instanceof InboxApplicationRejection
          ? applicationFailure(error.code, error.message, trace)
          : error;
      const cause = failure instanceof ContractError ? failure.envelope : undefined;
      if (write && (committing || rollback === 'failed'))
        throw new ContractError(
          committing ? 'INBOX_APPLICATION_COMMIT_UNKNOWN' : 'INBOX_APPLICATION_ROLLBACK_UNKNOWN',
          'The local application transaction could not be confirmed; reopen and inspect the same application and page before retrying',
          {
            trace_id: trace,
            retryable: false,
            details: {
              local_commit_state: 'unknown',
              acknowledgement_dispatch_state: 'not-sent',
              cause_code: cause?.code ?? 'INBOX_STORAGE_UNAVAILABLE',
              ...(cause === undefined ? {} : { cause_details: cause.details }),
              phase: committing ? 'commit' : 'body',
              rollback,
            },
          },
        );
      if (cause) {
        if (rollback !== 'failed') throw failure;
        throw new ContractError(cause.code, cause.message, {
          trace_id: trace,
          retryable: false,
          details: { ...cause.details, rollback_pending: true },
        });
      }
      if (rollback === 'failed')
        throw new ContractError(
          'INBOX_APPLICATION_STORAGE_UNAVAILABLE',
          'The local application read failed and its transaction could not be closed',
          {
            trace_id: trace,
            retryable: false,
            details: {
              local_commit_state: 'not-committed',
              acknowledgement_dispatch_state: 'not-sent',
              rollback_pending: true,
            },
          },
        );
      throw applicationFailure(
        'INBOX_APPLICATION_STORAGE_UNAVAILABLE',
        'The local application operation could not be completed',
        trace,
      );
    }
  }
  private require(trace: string) {
    try {
      for (const [name, type] of objects) {
        const rows = this.db
          .prepare('SELECT type FROM sqlite_master WHERE name = ? LIMIT 2')
          .all(name);
        if (rows.length !== 1 || rows[0]?.type !== type) throw new TypeError();
      }
      const versions = this.db
        .prepare('SELECT singleton, version FROM sync_inbox_application_schema LIMIT 2')
        .all();
      if (versions.length !== 1 || versions[0]?.singleton !== 1 || versions[0]?.version !== 1)
        throw new TypeError();
      for (const [name, columns] of Object.entries(schema)) {
        const stored = this.db
          .prepare(`PRAGMA table_info(${name})`)
          .all()
          .map((row) => row.name);
        if (stored.length !== columns.length || columns.some((column) => !stored.includes(column)))
          throw new TypeError();
      }
    } catch {
      throw applicationFailure(
        'INBOX_APPLICATION_SCHEMA_REQUIRED',
        'Explicitly enable the complete application extension; existing or partial schemas are never repaired automatically',
        trace,
      );
    }
  }
  enable(trace: string) {
    try {
      applicationTrace(trace);
    } catch {
      throw applicationFailure(
        'INBOX_APPLICATION_QUERY_INVALID',
        'Supply a valid local operation trace',
        trace,
      );
    }
    return this.run(trace, 30_000, true, (check) => {
      const present = objects.some(([name]) =>
        this.db.prepare('SELECT 1 AS present FROM sqlite_master WHERE name = ? LIMIT 1').get(name),
      );
      if (present) {
        this.require(trace);
        return { status: 'already-enabled' as const, version: 1 as const };
      }
      check();
      this.db.exec(SYNC_INBOX_APPLICATION_SCHEMA_V1);
      this.require(trace);
      return { status: 'enabled' as const, version: 1 as const };
    });
  }
  private step(query: SyncInboxApplicationQuery, digest: string, trace: string): Step | undefined {
    const key = keys(query);
    const rows = this.db
      .prepare(
        `SELECT
      CASE WHEN previous_sha256 IS NULL OR length(previous_sha256) = 64 THEN previous_sha256 ELSE '' END AS previous_sha256,
      CASE WHEN typeof(sequence) = 'integer' THEN CAST(sequence AS TEXT) ELSE NULL END AS sequence,
      CASE WHEN typeof(next_cursor) = 'integer' THEN CAST(next_cursor AS TEXT) ELSE NULL END AS next_cursor,
      CASE WHEN typeof(event_count) = 'integer' THEN CAST(event_count AS TEXT) ELSE NULL END AS event_count,
      CASE WHEN typeof(projection_json) = 'text' AND length(CAST(projection_json AS BLOB)) <= ? THEN projection_json ELSE NULL END AS projection_json,
      CASE WHEN length(projection_sha256) = 64 THEN projection_sha256 ELSE NULL END AS projection_sha256,
      CASE WHEN typeof(trace_id) = 'text' AND length(CAST(trace_id AS BLOB)) <= 4096 THEN trace_id ELSE NULL END AS trace_id
      FROM sync_inbox_application_steps WHERE consumer_key = ? AND application_key = ? AND document_sha256 = ? LIMIT 2`,
      )
      .all(INBOX_APPLICATION_STATE_BYTES, key.consumer, key.application, digest);
    if (rows.length > 1) throw this.corrupt(trace);
    const row = rows[0];
    if (!row) return undefined;
    const source = this.readPage(query.expected_identity, digest, trace);
    let projectionJson: string;
    let projectionHash: string;
    let originalTrace: string;
    try {
      originalTrace = applicationTrace(row.trace_id);
      projectionHash = applicationDigest(row.projection_sha256);
      if (typeof row.projection_json !== 'string') throw new TypeError();
      projectionJson = syncJsonSnapshot(
        JSON.parse(row.projection_json),
        INBOX_APPLICATION_STATE_BYTES,
      );
      if (
        projectionJson !== row.projection_json ||
        hash(projectionJson) !== projectionHash ||
        source.sequence !== integer(row.sequence) ||
        source.page.document.page.data.next_cursor !== integer(row.next_cursor) ||
        source.page.document.page.data.changes.length !== integer(row.event_count) ||
        source.page.document.previous_page_sha256 !== row.previous_sha256
      )
        throw new TypeError();
    } catch {
      throw this.corrupt(trace);
    }
    const previous = source.page.document.previous_page_sha256;
    if (previous !== null) {
      const parents = this.db
        .prepare(
          `SELECT
        CASE WHEN typeof(sequence) = 'integer' THEN CAST(sequence AS TEXT) ELSE NULL END AS sequence,
        CASE WHEN typeof(next_cursor) = 'integer' THEN CAST(next_cursor AS TEXT) ELSE NULL END AS next_cursor
        FROM sync_inbox_application_steps WHERE consumer_key = ? AND application_key = ? AND document_sha256 = ? LIMIT 2`,
        )
        .all(key.consumer, key.application, previous);
      try {
        if (
          parents.length !== 1 ||
          integer(parents[0]?.sequence) !== source.sequence - 1 ||
          integer(parents[0]?.next_cursor) !== source.page.document.query.cursor
        )
          throw new TypeError();
      } catch {
        throw this.corrupt(trace);
      }
    }
    return { ...source, projectionJson, projectionHash, trace: originalTrace };
  }
  private verifyEvents(
    query: SyncInboxApplicationQuery,
    step: Step,
    trace: string,
    check: () => void,
  ) {
    const key = keys(query);
    const changes = step.page.document.page.data.changes;
    const count = this.db
      .prepare(
        `SELECT CAST(COUNT(*) AS TEXT) AS count FROM (SELECT 1 FROM sync_inbox_application_events
      WHERE consumer_key = ? AND application_key = ? AND document_sha256 = ? LIMIT 501)`,
      )
      .get(key.consumer, key.application, step.page.document_sha256);
    try {
      if (integer(count?.count) !== changes.length) throw new TypeError();
    } catch {
      throw this.corrupt(trace);
    }
    for (const event of changes) {
      check();
      const rows = this.db
        .prepare(
          `SELECT CASE WHEN length(document_sha256) = 64 THEN document_sha256 ELSE NULL END AS document_sha256,
        CASE WHEN length(event_sha256) = 64 THEN event_sha256 ELSE NULL END AS event_sha256,
        CASE WHEN typeof(server_cursor) = 'integer' THEN CAST(server_cursor AS TEXT) ELSE NULL END AS server_cursor
        FROM sync_inbox_application_events WHERE consumer_key = ? AND application_key = ? AND event_id = ? LIMIT 2`,
        )
        .all(key.consumer, key.application, event.event_id);
      try {
        if (
          rows.length !== 1 ||
          rows[0]?.document_sha256 !== step.page.document_sha256 ||
          integer(rows[0]?.server_cursor) !== event.server_cursor ||
          rows[0]?.event_sha256 !== hash(syncJsonSnapshot(event, SYNC_CHANGES_RESPONSE_BYTES))
        )
          throw new TypeError();
      } catch {
        throw this.corrupt(trace);
      }
    }
  }
  private head(
    query: SyncInboxApplicationQuery,
    trace: string,
    check: () => void,
  ): Step | undefined {
    const key = keys(query);
    const rows = this.db
      .prepare(
        `SELECT CASE WHEN length(head_sha256) = 64 THEN head_sha256 ELSE NULL END AS head_sha256,
      CASE WHEN application_json = ? THEN 1 ELSE 0 END AS application_matches
      FROM sync_inbox_applications WHERE consumer_key = ? AND application_key = ? LIMIT 2`,
      )
      .all(key.applicationJson, key.consumer, key.application);
    if (rows.length > 1) throw this.corrupt(trace);
    const row = rows[0];
    if (!row) {
      for (const table of ['sync_inbox_application_steps', 'sync_inbox_application_events'])
        if (
          this.db
            .prepare(
              `SELECT 1 AS present FROM ${table} WHERE consumer_key = ? AND application_key = ? LIMIT 1`,
            )
            .get(key.consumer, key.application)
        )
          throw this.corrupt(trace);
      return undefined;
    }
    let digest: string;
    try {
      digest = applicationDigest(row.head_sha256);
      if (row.application_matches !== 1) throw new TypeError();
    } catch {
      throw this.corrupt(trace);
    }
    const selected = this.step(query, digest, trace);
    if (
      !selected ||
      this.db
        .prepare(
          `SELECT 1 AS present FROM sync_inbox_application_steps
      WHERE consumer_key = ? AND application_key = ? AND sequence > ? LIMIT 1`,
        )
        .get(key.consumer, key.application, selected.sequence)
    )
      throw this.corrupt(trace);
    this.verifyEvents(query, selected, trace, check);
    return selected;
  }
  private state(
    query: SyncInboxApplicationQuery,
    head: Step | undefined,
    trace: string,
  ): SyncInboxApplicationState {
    return {
      schema_version: 1,
      trace_id: trace,
      source_refs: [],
      scope: {
        tenant_id: query.expected_identity.tenant_id,
        workspace_id: query.expected_identity.workspace_id,
        project_id: query.expected_identity.project_id,
      },
      expected_identity: { ...query.expected_identity },
      application: { ...query.application },
      recorded: head !== undefined,
      applied_cursor: head?.page.document.page.data.next_cursor ?? 0,
      page_count: head?.sequence ?? 0,
      head_sha256: head?.page.document_sha256 ?? null,
      last_application_trace_id: head?.trace ?? null,
      projection_sha256: head?.projectionHash ?? hash('null'),
      projection: JSON.parse(head?.projectionJson ?? 'null') as unknown,
      application_scope: 'local-reducer',
      server_application: 'not-verified',
      source_authenticity: 'not-verified',
      acknowledgement_dispatch_state: 'not-sent',
      full_application_history_audit: 'not-performed',
    };
  }
  read(input: unknown, trace: string) {
    const query = parseInboxApplicationQuery(input, trace);
    return this.run(trace, query.timeout_ms, false, (check) => {
      this.require(trace);
      return this.state(query, this.head(query, trace, check), trace);
    });
  }
  archive(input: unknown, trace: string) {
    const query = parseInboxApplicationQuery(input, trace);
    return this.run(trace, query.timeout_ms, false, (check) => {
      this.require(trace);
      const steps: SyncApplicationArchiveStep[] = [];
      const document = {
        schema_version: 1 as const,
        kind: 'workctx.sync-application-history' as const,
        expected_identity: query.expected_identity,
        application: query.application,
        steps,
      };
      let bytes = Buffer.byteLength(JSON.stringify(document), 'utf8');
      const collect = (step: Step | undefined) => {
        check();
        if (step) {
          const saved: SyncApplicationArchiveStep = {
            page: step.page,
            projection: JSON.parse(step.projectionJson) as unknown,
            projection_sha256: step.projectionHash,
            application_trace_id: step.trace,
          };
          bytes += Buffer.byteLength(JSON.stringify(saved), 'utf8') + (steps.length ? 1 : 0);
          if (
            steps.length >= SYNC_APPLICATION_ARCHIVE_MAX_PAGES ||
            bytes > SYNC_APPLICATION_ARCHIVE_DOCUMENT_BYTES
          )
            throw applicationFailure(
              'INBOX_APPLICATION_ARCHIVE_LIMIT_REACHED',
              'The complete application archive exceeds 1000 pages or 16 MiB; no partial archive was produced',
              trace,
            );
          steps.push(saved);
        }
        return step;
      };
      auditInboxApplicationHistory(
        this.db,
        keys(query),
        {
          ...query,
          max_pages: SYNC_APPLICATION_ARCHIVE_MAX_PAGES,
          max_events: SYNC_APPLICATION_ARCHIVE_MAX_PAGES * 500,
          max_bytes: SYNC_APPLICATION_ARCHIVE_DOCUMENT_BYTES,
        },
        trace,
        check,
        {
          head: () => collect(this.head(query, trace, check)),
          step: (digest) => collect(this.step(query, digest, trace)),
          events: (step) => this.verifyEvents(query, step, trace, check),
        },
      );
      steps.reverse();
      check();
      let archive: SyncApplicationArchiveFile;
      try {
        const parsed = parseSyncApplicationArchiveDocument(document);
        archive = {
          document: parsed,
          document_sha256: hash(syncApplicationArchiveDocumentJson(parsed)),
        };
      } catch {
        throw applicationFailure(
          'INBOX_APPLICATION_ARCHIVE_INVALID',
          'The complete application history cannot be represented by its archive contract',
          trace,
        );
      }
      check();
      return archive;
    });
  }
  enableRestoreReceipts(trace: string) {
    return this.run(trace, 30_000, true, (check) => {
      this.require(trace);
      check();
      return new InboxApplicationRestoreReceipts(this.db).enable(trace);
    });
  }
  readRestoreReceipt(input: unknown, trace: string) {
    const query = parseInboxApplicationRestoreReceiptQuery(input, trace);
    let observedReceipt: SyncInboxApplicationRestoreReceipt | undefined;
    try {
      return this.run(trace, query.timeout_ms, false, (check) => {
        this.require(trace);
        const receipt = new InboxApplicationRestoreReceipts(this.db).read(
          keys(query),
          query,
          trace,
        );
        observedReceipt = receipt;
        check();
        return {
          ...this.historyEnvelope(query, trace),
          query,
          status: receipt ? ('recorded' as const) : ('not-observed' as const),
          receipt: receipt ?? null,
          receipt_scope: 'historical-local-transaction' as const,
          current_state: 'not-read' as const,
          observation_scope: 'current-database-read-snapshot' as const,
          absence_proves_rollback: false,
          local_write_state: 'not-performed' as const,
        };
      });
    } catch (error) {
      if (!(error instanceof ContractError)) throw error;
      throw new ContractError(error.envelope.code, error.envelope.message, {
        trace_id: trace,
        retryable: false,
        details: {
          ...error.envelope.details,
          restore_query: query,
          ...(observedReceipt === undefined
            ? {}
            : { observed_receipt: observedReceipt, receipt_scope: 'historical-local-transaction' }),
          local_write_state: 'not-performed',
          acknowledgement_dispatch_state: 'not-sent',
        },
      });
    }
  }
  getRestoreReceipt(input: unknown, trace: string) {
    const selection = parseInboxApplicationRestoreReceiptSelection(input, trace);
    let observedReceipt: SyncInboxApplicationRestoreReceipt | undefined;
    try {
      return this.run(trace, selection.timeout_ms, false, (check) => {
        this.require(trace);
        const receipt = new InboxApplicationRestoreReceipts(this.db).get(
          keys(selection),
          selection,
          trace,
        );
        observedReceipt = receipt;
        const result = {
          ...this.historyEnvelope(selection, trace),
          selection,
          status: receipt ? ('recorded' as const) : ('not-observed' as const),
          receipt_lookup_completed: true,
          receipt: receipt ?? null,
          restore_query: receipt?.query ?? null,
          query_match: 'not-requested' as const,
          receipt_scope: 'historical-local-transaction' as const,
          current_state: 'not-read' as const,
          observation_scope: 'current-database-read-snapshot' as const,
          absence_proves_rollback: false,
          local_write_state: 'not-performed' as const,
        };
        try {
          syncJsonSnapshot(result, 256 * 1024);
        } catch {
          throw applicationFailure(
            'INBOX_APPLICATION_RESTORE_RECEIPT_GET_TOO_LARGE',
            'The complete restore receipt lookup exceeds 256 KiB',
            trace,
          );
        }
        check();
        return result;
      });
    } catch (error) {
      if (!(error instanceof ContractError)) throw error;
      throw new ContractError(error.envelope.code, error.envelope.message, {
        trace_id: trace,
        retryable: false,
        details: {
          ...error.envelope.details,
          selection,
          receipt_lookup_completed: false,
          ...(observedReceipt === undefined
            ? {}
            : { observed_receipt: observedReceipt, receipt_scope: 'historical-local-transaction' }),
          local_write_state: 'not-performed',
          acknowledgement_dispatch_state: 'not-sent',
        },
      });
    }
  }
  auditRestoreReceipts(input: unknown, trace: string) {
    const query = parseInboxApplicationRestoreReceiptAuditQuery(input, trace);
    const progress: InboxApplicationRestoreReceiptAuditProgress = {
      stage: 'schema',
      receipt_count: null,
      checked_receipts: 0,
      checked_bytes: 0,
      selected_request_id: null,
    };
    try {
      return this.run(trace, query.timeout_ms, false, (check) => {
        this.require(trace);
        const receipts = new InboxApplicationRestoreReceipts(this.db);
        receipts.require(trace);
        const key = keys(query);
        const audit = auditInboxApplicationRestoreReceipts(
          this.db,
          key,
          query,
          trace,
          check,
          (id) => receipts.getByKey(key, id, trace),
          progress,
        );
        const result = { ...this.historyEnvelope(query, trace), ...audit };
        try {
          syncJsonSnapshot(result, 512 * 1024);
        } catch {
          throw applicationFailure(
            'INBOX_APPLICATION_RESTORE_RECEIPT_AUDIT_TOO_LARGE',
            'The complete restore receipt audit response exceeds 512 KiB',
            trace,
          );
        }
        check();
        return result;
      });
    } catch (error) {
      if (!(error instanceof ContractError)) throw error;
      throw new ContractError(error.envelope.code, error.envelope.message, {
        trace_id: trace,
        retryable: false,
        details: {
          ...error.envelope.details,
          audit_query: query,
          audit_scope: 'original-consumer-application-restore-receipts',
          audit_completed: false,
          full_receipt_history_audit: 'not-completed',
          ...progress,
          local_write_state: 'not-performed',
          acknowledgement_dispatch_state: 'not-sent',
        },
      });
    }
  }
  listRestoreReceiptScopes(input: unknown, trace: string) {
    const query = parseInboxApplicationRestoreReceiptScopesQuery(input, trace);
    try {
      return this.run(trace, query.timeout_ms, false, (check) => {
        this.require(trace);
        const receipts = new InboxApplicationRestoreReceipts(this.db);
        receipts.require(trace);
        const catalog = readInboxApplicationRestoreReceiptScopes(
          this.db,
          query,
          (key, id) => receipts.getByKey(key, id, trace),
          trace,
          check,
        );
        const result = {
          schema_version: 1 as const,
          trace_id: trace,
          source_refs: [],
          scope: null,
          application_scope: 'local-reducer' as const,
          server_application: 'not-verified' as const,
          source_authenticity: 'not-verified' as const,
          projection_semantics: 'not-verified' as const,
          full_application_history_audit: 'not-performed' as const,
          acknowledgement_dispatch_state: 'not-sent' as const,
          ...catalog,
        };
        try {
          syncJsonSnapshot(result, 512 * 1024);
        } catch {
          throw applicationFailure(
            'INBOX_APPLICATION_RESTORE_RECEIPT_SCOPES_TOO_LARGE',
            'The complete restore receipt scope catalog exceeds 512 KiB; request a smaller limit',
            trace,
          );
        }
        check();
        return result;
      });
    } catch (error) {
      if (!(error instanceof ContractError)) throw error;
      throw new ContractError(error.envelope.code, error.envelope.message, {
        trace_id: trace,
        retryable: false,
        details: {
          ...error.envelope.details,
          catalog_query: query,
          catalog_completed: false,
          local_write_state: 'not-performed',
          acknowledgement_dispatch_state: 'not-sent',
        },
      });
    }
  }
  listRestoreReceipts(input: unknown, trace: string) {
    const query = parseInboxApplicationRestoreReceiptCatalogQuery(input, trace);
    try {
      return this.run(trace, query.timeout_ms, false, (check) => {
        this.require(trace);
        const receipts = new InboxApplicationRestoreReceipts(this.db);
        receipts.require(trace);
        const key = keys(query);
        const catalog = readInboxApplicationRestoreReceiptCatalog(
          this.db,
          key,
          query,
          (selection) => receipts.get(key, selection, trace),
          trace,
          check,
        );
        const result = { ...this.historyEnvelope(query, trace), ...catalog };
        try {
          syncJsonSnapshot(result, 512 * 1024);
        } catch {
          throw applicationFailure(
            'INBOX_APPLICATION_RESTORE_RECEIPT_CATALOG_TOO_LARGE',
            'The complete restore receipt catalog exceeds 512 KiB; request a smaller limit',
            trace,
          );
        }
        check();
        return result;
      });
    } catch (error) {
      if (!(error instanceof ContractError)) throw error;
      throw new ContractError(error.envelope.code, error.envelope.message, {
        trace_id: trace,
        retryable: false,
        details: {
          ...error.envelope.details,
          catalog_query: query,
          catalog_completed: false,
          local_write_state: 'not-performed',
          acknowledgement_dispatch_state: 'not-sent',
        },
      });
    }
  }
  previewRestore(value: unknown, input: unknown, trace: string) {
    const query = parseInboxApplicationRestoreQuery(input, trace);
    const progress = { stage: 'archive' };
    let observedReceipt: SyncInboxApplicationRestoreReceipt | undefined;
    try {
      const prepared = prepareInboxApplicationRestore(value, query, trace);
      progress.stage = 'transaction';
      return this.run(trace, query.timeout_ms, false, (check) => {
        this.require(trace);
        const receipt = new InboxApplicationRestoreReceipts(this.db).read(
          keys(query),
          query,
          trace,
        );
        if (receipt) {
          observedReceipt = receipt;
          check();
          return {
            ...this.historyEnvelope(query, trace),
            status: 'already-recorded' as const,
            preview_completed: true,
            restore_allowed: false as const,
            restore_query: null,
            planned_changes: null,
            target_application: null,
            target_received: null,
            expected_target: query.expected_target ?? null,
            observed_target: null,
            target_precondition: 'not-read' as const,
            receipt,
            receipt_scope: 'historical-local-transaction' as const,
            current_state: 'not-read' as const,
            local_write_state: 'not-performed' as const,
            archive_document_sha256: query.archive_document_sha256,
          };
        }
        const preview = previewInboxApplicationRestore(
          this.db,
          keys(query),
          query,
          prepared,
          trace,
          check,
          progress,
          {
            head: () => this.head(query, trace, check),
            step: (digest) => this.step(query, digest, trace),
            events: (step) => this.verifyEvents(query, step, trace, check),
            sources: this.comparePages,
          },
        );
        const result = { ...this.historyEnvelope(query, trace), ...preview };
        try {
          syncJsonSnapshot(result, 512 * 1024);
        } catch {
          throw applicationFailure(
            'INBOX_APPLICATION_RESTORE_PREVIEW_TOO_LARGE',
            'The complete restore preview exceeds 512 KiB',
            trace,
          );
        }
        check();
        return result;
      });
    } catch (error) {
      if (!(error instanceof ContractError)) throw error;
      throw new ContractError(error.envelope.code, error.envelope.message, {
        trace_id: trace,
        retryable: false,
        details: {
          ...error.envelope.details,
          expected_identity: query.expected_identity,
          application: query.application,
          archive_document_sha256: query.archive_document_sha256,
          timeout_ms: query.timeout_ms,
          preview_stage: progress.stage,
          preview_completed: false,
          restore_query: query,
          ...(observedReceipt === undefined
            ? {}
            : { observed_receipt: observedReceipt, receipt_scope: 'historical-local-transaction' }),
          ...(query.expected_target === undefined
            ? {}
            : { expected_target: query.expected_target }),
          local_write_state: 'not-performed',
          acknowledgement_dispatch_state: 'not-sent',
        },
      });
    }
  }
  restore(value: unknown, input: unknown, trace: string) {
    const query = parseInboxApplicationRestoreQuery(input, trace);
    let observedReceipt: SyncInboxApplicationRestoreReceipt | undefined;
    const progress: InboxApplicationRestoreProgress = {
      stage: 'archive',
      prepared_received_pages: 0,
      prepared_application_pages: 0,
      prepared_application_events: 0,
      selected_sequence: null,
      selected_document_sha256: null,
    };
    try {
      const prepared = prepareInboxApplicationRestore(value, query, trace);
      progress.stage = 'transaction';
      return this.run(trace, query.timeout_ms, true, (check) => {
        this.require(trace);
        const receipts = new InboxApplicationRestoreReceipts(this.db);
        progress.stage = 'receipt';
        const recorded = receipts.read(keys(query), query, trace);
        if (recorded) {
          observedReceipt = recorded;
          check();
          return {
            ...this.historyEnvelope(query, trace),
            status: 'already-recorded' as const,
            restore_completed: true,
            receipt: recorded,
            receipt_scope: 'historical-local-transaction' as const,
            current_state: 'not-read' as const,
            state: null,
            local_write_state: 'not-performed' as const,
            local_commit_state: 'committed' as const,
            archive_document_sha256: query.archive_document_sha256,
          };
        }
        const restored = restoreInboxApplicationHistory(
          this.db,
          keys(query),
          query,
          prepared,
          trace,
          check,
          progress,
          {
            head: () => this.head(query, trace, check),
            step: (digest) => this.step(query, digest, trace),
            events: (step) => this.verifyEvents(query, step, trace, check),
            sources: this.restorePages,
          },
        );
        progress.stage = 'receipt-save';
        const receipt = receipts.save(keys(query), query, restored, trace);
        const result = {
          ...this.historyEnvelope(query, trace),
          status: restored.status,
          ...(receipt === undefined
            ? {}
            : { receipt, receipt_scope: 'historical-local-transaction' as const }),
          restore_completed: true,
          archive_document_sha256: prepared.archive.document_sha256,
          target_precondition: restored.target_precondition,
          target_before: restored.target_before,
          target_after: restored.target_after,
          added_application_pages: restored.added_application_pages,
          added_application_events: restored.added_application_events,
          ...restored.sources,
          state: {
            ...this.state(query, restored.restored.head, trace),
            full_application_history_audit: 'verified-structure' as const,
          },
          full_application_history_audit: 'verified-structure' as const,
          application_history_policy: 'empty-or-identical' as const,
          source_page_policy: 'preserve-compatible-received-chain' as const,
          restore_provenance: 'local-archive-not-authenticated' as const,
          event_ledger: 'derived-from-original-pages' as const,
          reducer_replay: 'not-performed' as const,
          local_commit_state: 'committed' as const,
        };
        try {
          syncJsonSnapshot(result, 2 * 1024 * 1024);
        } catch {
          throw applicationFailure(
            'INBOX_APPLICATION_RESTORE_RESULT_TOO_LARGE',
            'The complete restore result exceeds 2 MiB',
            trace,
          );
        }
        check();
        return result;
      });
    } catch (error) {
      if (!(error instanceof ContractError)) throw error;
      throw new ContractError(error.envelope.code, error.envelope.message, {
        trace_id: trace,
        retryable: false,
        details: {
          ...progress,
          local_commit_state: 'not-committed',
          ...error.envelope.details,
          restore_stage: progress.stage,
          restore_completed: false,
          restore_query: query,
          ...(observedReceipt === undefined
            ? {}
            : { observed_receipt: observedReceipt, receipt_scope: 'historical-local-transaction' }),
          ...(query.expected_target === undefined
            ? {}
            : { expected_target: query.expected_target }),
          expected_identity: query.expected_identity,
          application: query.application,
          archive_document_sha256: query.archive_document_sha256,
          timeout_ms: query.timeout_ms,
          acknowledgement_dispatch_state: 'not-sent',
        },
      });
    }
  }
  catalog(input: unknown, trace: string) {
    const query = parseInboxApplicationCatalogQuery(input, trace);
    return this.run(trace, query.timeout_ms, false, (check) => {
      this.require(trace);
      return readInboxApplicationCatalog(
        this.db,
        query,
        (selection) => this.head(selection, trace, check),
        trace,
        check,
      );
    });
  }
  private historyReads(query: SyncInboxApplicationQuery, trace: string, check: () => void) {
    this.require(trace);
    const charge = applicationHistoryBudget(trace, check);
    const head = this.head(query, trace, check);
    if (head) charge(head);
    const read = (digest: string) => {
      check();
      if (head?.page.document_sha256 === digest) return head;
      const selected = this.step(query, digest, trace);
      if (!selected) return undefined;
      if (!head || selected.sequence >= head.sequence) throw this.corrupt(trace);
      charge(selected);
      this.verifyEvents(query, selected, trace, check);
      check();
      return selected;
    };
    return { head, read };
  }
  private historyEnvelope(query: SyncInboxApplicationQuery, trace: string) {
    return {
      schema_version: 1 as const,
      trace_id: trace,
      source_refs: [],
      expected_identity: { ...query.expected_identity },
      application: { ...query.application },
      scope: {
        tenant_id: query.expected_identity.tenant_id,
        workspace_id: query.expected_identity.workspace_id,
        project_id: query.expected_identity.project_id,
      },
      application_scope: 'local-reducer' as const,
      server_application: 'not-verified' as const,
      source_authenticity: 'not-verified' as const,
      projection_semantics: 'not-verified' as const,
      full_application_history_audit: 'not-performed' as const,
      acknowledgement_dispatch_state: 'not-sent' as const,
    };
  }
  history(input: unknown, trace: string) {
    const query = parseInboxApplicationHistoryQuery(input, trace);
    return this.run(trace, query.timeout_ms, false, (check) => {
      const { head, read } = this.historyReads(query, trace, check);
      return {
        ...this.historyEnvelope(query, trace),
        ...readInboxApplicationHistory(this.db, keys(query), query, head, read, trace, check),
      };
    });
  }
  snapshot(input: unknown, trace: string) {
    const query = parseInboxApplicationSnapshotQuery(input, trace);
    return this.run(trace, query.timeout_ms, false, (check) => {
      const { head, read } = this.historyReads(query, trace, check);
      const selected = read(query.document_sha256);
      if (
        selected &&
        query.expected_projection_sha256 !== undefined &&
        selected.projectionHash !== query.expected_projection_sha256
      )
        throw applicationFailure(
          'INBOX_APPLICATION_SNAPSHOT_CHANGED',
          'The selected saved projection differs from its expected digest',
          trace,
        );
      const result = {
        ...this.historyEnvelope(query, trace),
        kind: 'application-snapshot' as const,
        document_sha256: query.document_sha256,
        found: selected !== undefined,
        snapshot: selected
          ? {
              ...inboxApplicationStepSummary(selected),
              projection: JSON.parse(selected.projectionJson) as unknown,
            }
          : null,
        current_checkpoint: head ? inboxApplicationStepSummary(head) : null,
      };
      try {
        syncJsonSnapshot(result, 2 * 1024 * 1024);
      } catch {
        throw applicationFailure(
          'INBOX_APPLICATION_SNAPSHOT_TOO_LARGE',
          'The complete application snapshot response exceeds 2 MiB',
          trace,
        );
      }
      check();
      return result;
    });
  }
  audit(input: unknown, trace: string) {
    const query = parseInboxApplicationAuditQuery(input, trace);
    let progress:
      | { checked_pages: number; checked_events: number; checked_bytes: number }
      | undefined;
    try {
      return this.run(trace, query.timeout_ms, false, (check) => {
        this.require(trace);
        const audited = auditInboxApplicationHistory(this.db, keys(query), query, trace, check, {
          head: () => this.head(query, trace, check),
          step: (digest) => this.step(query, digest, trace),
          events: (step) => this.verifyEvents(query, step, trace, check),
        });
        progress = {
          checked_pages: audited.checked_pages,
          checked_events: audited.checked_events,
          checked_bytes: audited.checked_bytes,
        };
        return {
          schema_version: 1 as const,
          trace_id: trace,
          source_refs: [],
          scope: {
            tenant_id: query.expected_identity.tenant_id,
            workspace_id: query.expected_identity.workspace_id,
            project_id: query.expected_identity.project_id,
          },
          expected_identity: { ...query.expected_identity },
          application: { ...query.application },
          status: 'complete' as const,
          audit_scope: 'application-history-structure' as const,
          audit_completed: true,
          checked_pages: audited.checked_pages,
          checked_events: audited.checked_events,
          checked_bytes: audited.checked_bytes,
          root_sha256: audited.root_sha256,
          budgets: {
            max_pages: query.max_pages,
            max_events: query.max_events,
            max_bytes: query.max_bytes,
            timeout_ms: query.timeout_ms,
          },
          state: {
            ...this.state(query, audited.head, trace),
            full_application_history_audit: 'verified-structure' as const,
          },
          reducer_replay: 'not-performed' as const,
          projection_semantics: 'not-verified' as const,
          received_suffix_audit: 'not-performed' as const,
          acknowledgement_audit: 'not-performed' as const,
          physical_database_audit: 'not-performed' as const,
          acknowledgement_dispatch_state: 'not-sent' as const,
        };
      });
    } catch (error) {
      if (!(error instanceof ContractError)) throw error;
      throw new ContractError(error.envelope.code, error.envelope.message, {
        trace_id: trace,
        retryable: false,
        details: {
          ...progress,
          ...error.envelope.details,
          audit_scope: 'application-history-structure',
          audit_completed: false,
          expected_identity: query.expected_identity,
          application: query.application,
          max_pages: query.max_pages,
          max_events: query.max_events,
          max_bytes: query.max_bytes,
          timeout_ms: query.timeout_ms,
          acknowledgement_dispatch_state: 'not-sent',
        },
      });
    }
  }
  replay(input: unknown, trace: string) {
    const query = parseInboxBuiltInApplicationReplayQuery(input, trace);
    let progress: Record<string, unknown> | undefined;
    try {
      return this.run(trace, query.timeout_ms, false, (check) => {
        this.require(trace);
        const replayed = replayInboxApplicationHistory(this.db, keys(query), query, trace, check, {
          head: () => this.head(query, trace, check),
          step: (digest) => this.step(query, digest, trace),
          events: (step) => this.verifyEvents(query, step, trace, check),
        });
        const audited = replayed.audited;
        progress = {
          structure_completed: true,
          checked_pages: audited.checked_pages,
          checked_events: audited.checked_events,
          checked_bytes: audited.checked_bytes,
          replayed_pages: replayed.replayed_pages,
          replayed_events: replayed.replayed_events,
          replayed_bytes: replayed.replayed_bytes,
          stage: 'completion',
        };
        const result = {
          ...this.historyEnvelope(query, trace),
          status: 'complete' as const,
          replay_scope: 'current-built-in-application-history' as const,
          replay_completed: true,
          structure_completed: true,
          checked_pages: audited.checked_pages,
          checked_events: audited.checked_events,
          checked_bytes: audited.checked_bytes,
          replayed_pages: replayed.replayed_pages,
          replayed_events: replayed.replayed_events,
          replayed_bytes: replayed.replayed_bytes,
          replayed_projection_sha256: replayed.replayed_projection_sha256,
          root_sha256: audited.root_sha256,
          adapter: replayed.adapter,
          budgets: {
            max_pages: query.max_pages,
            max_events: query.max_events,
            max_bytes: query.max_bytes,
            max_replay_bytes: query.max_replay_bytes,
            max_page_replay_bytes: INBOX_APPLICATION_REDUCTION_BYTES,
            timeout_ms: query.timeout_ms,
          },
          state: {
            ...this.state(query, audited.head, trace),
            full_application_history_audit: 'verified-structure' as const,
            projection_semantics: 'matches-current-built-in-replay' as const,
          },
          full_application_history_audit: 'verified-structure' as const,
          reducer_replay: 'verified-current-built-in' as const,
          projection_semantics: 'matches-current-built-in-replay' as const,
          received_suffix_audit: 'not-performed' as const,
          acknowledgement_audit: 'not-performed' as const,
          physical_database_audit: 'not-performed' as const,
          history_update: 'not-performed' as const,
        };
        try {
          syncJsonSnapshot(result, 2 * 1024 * 1024);
        } catch {
          throw applicationFailure(
            'INBOX_APPLICATION_REPLAY_RESULT_TOO_LARGE',
            'The complete replay response exceeds 2 MiB',
            trace,
          );
        }
        check();
        return result;
      });
    } catch (error) {
      if (!(error instanceof ContractError)) throw error;
      throw new ContractError(error.envelope.code, error.envelope.message, {
        trace_id: trace,
        retryable: false,
        details: {
          ...progress,
          ...error.envelope.details,
          replay_scope: 'current-built-in-application-history',
          replay_completed: false,
          expected_identity: query.expected_identity,
          application: query.application,
          max_pages: query.max_pages,
          max_events: query.max_events,
          max_bytes: query.max_bytes,
          max_replay_bytes: query.max_replay_bytes,
          timeout_ms: query.timeout_ms,
          history_update: 'not-performed',
          acknowledgement_dispatch_state: 'not-sent',
        },
      });
    }
  }
  preview(input: unknown, trace: string) {
    const query = parseInboxBuiltInApplicationApplyQuery(input, trace);
    const adapter = builtInApplicationAdapter(query.application, query.expected_identity, trace);
    const handlers = applicationHandlers(adapter.handlers, trace);
    const progress: Record<string, unknown> = { stage: 'begin' };
    try {
      return this.run(trace, query.timeout_ms, false, (check) => {
        const plan = this.prepareApply(
          query,
          handlers,
          trace,
          check,
          adapter.validateProjection,
          progress,
        );
        progress.stage = 'completion';
        const result = {
          ...this.historyEnvelope(query, trace),
          status: 'previewed' as const,
          preview_completed: true,
          disposition:
            plan.status === 'already-applied'
              ? ('already-applied' as const)
              : ('would-apply' as const),
          apply_query: query,
          adapter: adapter.descriptor,
          current_state: this.state(query, plan.current, trace),
          selected_page: {
            document_sha256: query.document_sha256,
            previous_sha256: query.expected_previous_sha256,
            sequence: plan.selected.sequence,
            next_cursor: plan.selected.page.document.page.data.next_cursor,
            event_count: plan.selected.page.document.page.data.changes.length,
          },
          planned_application:
            plan.status === 'prepared'
              ? {
                  head_sha256: query.document_sha256,
                  page_count: plan.selected.sequence,
                  applied_cursor: plan.selected.page.document.page.data.next_cursor,
                  projection_sha256: plan.projectionHash,
                  projection: JSON.parse(plan.projectionJson) as unknown,
                }
              : null,
          reduced_events: plan.status === 'prepared' ? plan.prepared.length : 0,
          reduction_bytes: plan.status === 'prepared' ? plan.processedBytes : 0,
          budgets: {
            max_projection_bytes: INBOX_APPLICATION_STATE_BYTES,
            max_reduction_bytes: INBOX_APPLICATION_REDUCTION_BYTES,
            timeout_ms: query.timeout_ms,
          },
          local_write_state: 'not-performed' as const,
          history_update: 'not-performed' as const,
          application_receipt: 'not-created' as const,
          future_application: 'requires-revalidation' as const,
        };
        try {
          syncJsonSnapshot(result, 3 * 1024 * 1024);
        } catch {
          throw applicationFailure(
            'INBOX_APPLICATION_APPLY_PREVIEW_TOO_LARGE',
            'The complete application preview response exceeds 3 MiB',
            trace,
          );
        }
        check();
        return result;
      });
    } catch (error) {
      if (!(error instanceof ContractError)) throw error;
      throw new ContractError(error.envelope.code, error.envelope.message, {
        trace_id: trace,
        retryable: false,
        details: {
          ...progress,
          ...error.envelope.details,
          apply_query: query,
          preview_completed: false,
          local_write_state: 'not-performed',
          history_update: 'not-performed',
          acknowledgement_dispatch_state: 'not-sent',
        },
      });
    }
  }
  /** Shared read/reduce phase: neither preview nor apply may bypass these checks. */
  private prepareApply(
    query: SyncInboxApplicationApplyQuery,
    handlers: ReturnType<typeof applicationHandlers>,
    trace: string,
    check: () => void,
    validateProjection: ((projection: unknown, appliedCursor: number) => void) | undefined,
    progress: Record<string, unknown>,
  ) {
    const key = keys(query);
    progress.stage = 'current-state';
    this.require(trace);
    const current = this.head(query, trace, check);
    if (validateProjection) {
      validateProjection(
        JSON.parse(current?.projectionJson ?? 'null') as unknown,
        current?.page.document.page.data.next_cursor ?? 0,
      );
      check();
    }
    progress.stage = 'duplicate-page';
    const duplicate = this.step(query, query.document_sha256, trace);
    if (duplicate) {
      progress.selected_sequence = duplicate.sequence;
      if (
        !current ||
        duplicate.sequence > current.sequence ||
        duplicate.page.document.previous_page_sha256 !== query.expected_previous_sha256
      )
        throw applicationFailure(
          'INBOX_APPLICATION_PRECONDITION_FAILED',
          'The original page application request differs from its recorded predecessor',
          trace,
        );
      this.verifyEvents(query, duplicate, trace, check);
      if (validateProjection) {
        validateProjection(
          JSON.parse(duplicate.projectionJson) as unknown,
          duplicate.page.document.page.data.next_cursor,
        );
        check();
      }
      return {
        status: 'already-applied' as const,
        current,
        selected: duplicate,
      };
    }
    progress.stage = 'selected-page';
    const selected = this.readPage(query.expected_identity, query.document_sha256, trace);
    progress.selected_sequence = selected.sequence;
    if (
      query.expected_previous_sha256 !== (current?.page.document_sha256 ?? null) ||
      selected.page.document.previous_page_sha256 !== query.expected_previous_sha256 ||
      selected.sequence !== (current?.sequence ?? 0) + 1 ||
      selected.page.document.query.cursor !== (current?.page.document.page.data.next_cursor ?? 0)
    )
      throw applicationFailure(
        'INBOX_APPLICATION_PRECONDITION_FAILED',
        'Apply the exact next saved page from the selected application head; no skipping or resetting',
        trace,
      );
    progress.stage = 'event-validation';
    const prepared = selected.page.document.page.data.changes.map((event) => {
      progress.event_id = event.event_id;
      progress.server_cursor = event.server_cursor;
      check();
      if (!handlers.has(event.event_type))
        throw applicationFailure(
          'INBOX_APPLICATION_EVENT_UNSUPPORTED',
          'Every event type in this page requires an explicit application reducer',
          trace,
        );
      if (
        this.db
          .prepare(
            `SELECT 1 AS present FROM sync_inbox_application_events WHERE consumer_key = ? AND application_key = ?
        AND (event_id = ? OR server_cursor = ?) LIMIT 1`,
          )
          .get(key.consumer, key.application, event.event_id, event.server_cursor)
      )
        throw applicationFailure(
          'INBOX_APPLICATION_EVENT_REUSED',
          'A saved event ID or cursor was already applied in another page; preserve the original chain',
          trace,
        );
      const json = syncJsonSnapshot(event, SYNC_CHANGES_RESPONSE_BYTES);
      return { event, json, digest: hash(json) };
    });
    let projectionJson = current?.projectionJson ?? 'null';
    let processedBytes = 0;
    let reducedEvents = 0;
    progress.reduced_events = reducedEvents;
    progress.reduction_bytes = processedBytes;
    progress.stage = 'reduction';
    for (const item of prepared) {
      progress.event_id = item.event.event_id;
      progress.server_cursor = item.event.server_cursor;
      check();
      processedBytes += size(projectionJson) + size(item.json);
      progress.reduction_bytes = processedBytes;
      if (processedBytes > INBOX_APPLICATION_REDUCTION_BYTES)
        throw applicationFailure(
          'INBOX_APPLICATION_LIMIT_REACHED',
          'The complete page exceeds the local reduction byte budget; no partial application was committed',
          trace,
        );
      try {
        const result = handlers.get(item.event.event_type)!(
          JSON.parse(projectionJson) as unknown,
          JSON.parse(item.json) as SyncChange,
        );
        if (
          result &&
          (typeof result === 'object' || typeof result === 'function') &&
          typeof (result as { then?: unknown }).then === 'function'
        ) {
          void Promise.resolve(result).catch(() => {});
          throw new TypeError('Asynchronous reducers are unsupported');
        }
        projectionJson = syncJsonSnapshot(result, INBOX_APPLICATION_STATE_BYTES);
      } catch (error) {
        if (error instanceof InboxApplicationRejection) throw error;
        throw applicationFailure(
          'INBOX_APPLICATION_REDUCER_FAILED',
          'A reducer failed, returned asynchronous work or produced an invalid/oversized projection; the page was not applied',
          trace,
        );
      }
      processedBytes += size(projectionJson);
      progress.reduction_bytes = processedBytes;
      if (processedBytes > INBOX_APPLICATION_REDUCTION_BYTES)
        throw applicationFailure(
          'INBOX_APPLICATION_LIMIT_REACHED',
          'The complete page exceeds the local reduction byte budget; no partial application was committed',
          trace,
        );
      reducedEvents += 1;
      progress.reduced_events = reducedEvents;
      check();
    }
    progress.stage = 'projection-validation';
    delete progress.event_id;
    delete progress.server_cursor;
    if (validateProjection) {
      validateProjection(
        JSON.parse(projectionJson) as unknown,
        selected.page.document.page.data.next_cursor,
      );
      check();
    }
    const projectionHash = hash(projectionJson);
    return {
      status: 'prepared' as const,
      current,
      selected,
      prepared,
      projectionJson,
      projectionHash,
      processedBytes,
    };
  }
  apply(
    input: unknown,
    suppliedHandlers: SyncInboxApplicationHandlers,
    trace: string,
    validateProjection?: (projection: unknown, appliedCursor: number) => void,
  ) {
    const query = parseInboxApplicationApplyQuery(input, trace);
    const handlers = applicationHandlers(suppliedHandlers, trace);
    const key = keys(query);
    return this.run(trace, query.timeout_ms, true, (check) => {
      const plan = this.prepareApply(query, handlers, trace, check, validateProjection, {});
      if (plan.status === 'already-applied') {
        return {
          status: 'already-applied' as const,
          document_sha256: query.document_sha256,
          state: this.state(query, plan.current, trace),
        };
      }
      const { current, selected, prepared, projectionJson, projectionHash } = plan;
      this.db
        .prepare(
          `INSERT INTO sync_inbox_application_steps
        (consumer_key, application_key, document_sha256, previous_sha256, sequence, next_cursor, event_count, projection_json, projection_sha256, trace_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          key.consumer,
          key.application,
          query.document_sha256,
          query.expected_previous_sha256,
          selected.sequence,
          selected.page.document.page.data.next_cursor,
          prepared.length,
          projectionJson,
          projectionHash,
          trace,
        );
      for (const item of prepared) {
        check();
        this.db
          .prepare(
            `INSERT INTO sync_inbox_application_events
          (consumer_key, application_key, event_id, server_cursor, document_sha256, event_sha256) VALUES (?, ?, ?, ?, ?, ?)`,
          )
          .run(
            key.consumer,
            key.application,
            item.event.event_id,
            item.event.server_cursor,
            query.document_sha256,
            item.digest,
          );
      }
      if (current) {
        const changed = this.db
          .prepare(
            `UPDATE sync_inbox_applications SET head_sha256 = ?
          WHERE consumer_key = ? AND application_key = ? AND application_json = ? AND head_sha256 = ?`,
          )
          .run(
            query.document_sha256,
            key.consumer,
            key.application,
            key.applicationJson,
            current.page.document_sha256,
          ).changes;
        if (Number(changed) !== 1) throw this.corrupt(trace);
      } else {
        this.db
          .prepare(
            `INSERT INTO sync_inbox_applications (consumer_key, application_key, application_json, head_sha256) VALUES (?, ?, ?, ?)`,
          )
          .run(key.consumer, key.application, key.applicationJson, query.document_sha256);
      }
      const complete = this.head(query, trace, check);
      if (
        !complete ||
        complete.page.document_sha256 !== query.document_sha256 ||
        complete.trace !== trace ||
        complete.projectionJson !== projectionJson ||
        complete.projectionHash !== projectionHash
      )
        throw this.corrupt(trace);
      return {
        status: 'applied' as const,
        document_sha256: query.document_sha256,
        state: this.state(query, complete, trace),
      };
    });
  }
}
