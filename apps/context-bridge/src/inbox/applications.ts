import { createHash } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import {
  ContractError,
  syncJsonSnapshot,
  SYNC_CHANGES_RESPONSE_BYTES,
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
  type SyncInboxApplicationState,
  type SyncInboxApplicationHandlers,
} from './application-model.js';
import { SYNC_INBOX_APPLICATION_SCHEMA_V1 } from './application-schema.js';

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
      const cause = error instanceof ContractError ? error.envelope : undefined;
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
              phase: committing ? 'commit' : 'body',
              rollback,
            },
          },
        );
      if (cause) {
        if (rollback !== 'failed') throw error;
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
  apply(input: unknown, suppliedHandlers: SyncInboxApplicationHandlers, trace: string) {
    const query = parseInboxApplicationApplyQuery(input, trace);
    const handlers = applicationHandlers(suppliedHandlers, trace);
    const key = keys(query);
    return this.run(trace, query.timeout_ms, true, (check) => {
      this.require(trace);
      const current = this.head(query, trace, check);
      const duplicate = this.step(query, query.document_sha256, trace);
      if (duplicate) {
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
        return {
          status: 'already-applied' as const,
          document_sha256: query.document_sha256,
          state: this.state(query, current, trace),
        };
      }
      const selected = this.readPage(query.expected_identity, query.document_sha256, trace);
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
      const prepared = selected.page.document.page.data.changes.map((event) => {
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
      for (const item of prepared) {
        check();
        processedBytes += size(projectionJson) + size(item.json);
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
        } catch {
          throw applicationFailure(
            'INBOX_APPLICATION_REDUCER_FAILED',
            'A reducer failed, returned asynchronous work or produced an invalid/oversized projection; the page was not applied',
            trace,
          );
        }
        processedBytes += size(projectionJson);
        if (processedBytes > INBOX_APPLICATION_REDUCTION_BYTES)
          throw applicationFailure(
            'INBOX_APPLICATION_LIMIT_REACHED',
            'The complete page exceeds the local reduction byte budget; no partial application was committed',
            trace,
          );
        check();
      }
      const projectionHash = hash(projectionJson);
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
