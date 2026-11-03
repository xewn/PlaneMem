import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { closeSync, lstatSync, openSync } from 'node:fs';
import {
  ContractError,
  parseSyncCommandIdentity,
  assertSyncCommandIdentity,
  parseSyncSavedPageFile,
  syncSavedPageDocumentJson,
  SYNC_SAVED_PAGE_DOCUMENT_BYTES,
  parseSyncPageChainDocument,
  parseSyncPageChainFile,
  syncPageChainDocumentJson,
  SYNC_PAGE_CHAIN_DOCUMENT_BYTES,
  SYNC_PAGE_CHAIN_MAX_PAGES,
  type SyncCommandIdentity,
  type SyncSavedPageFile,
  type SyncPageChainFile,
} from '@planemem/contracts';
import { SYNC_INBOX_SCHEMA_V1, SYNC_INBOX_SCHEMA_VERSION } from './schema.js';
import { InboxApplications } from './applications.js';
export { parseInboxApplicationAuditQuery } from './application-audit.js';
export type { SyncInboxApplicationAuditQuery } from './application-audit.js';
import {
  contextItemApplicationAdapter,
  parseInboxBuiltInApplicationApplyQuery,
} from './context-item-application.js';
export {
  CONTEXT_ITEM_APPLICATION,
  parseInboxBuiltInApplicationApplyQuery,
  type ContextItemLifecycleProjection,
} from './context-item-application.js';
import type { SyncInboxApplicationHandlers } from './application-model.js';
export {
  parseInboxApplicationQuery,
  parseInboxApplicationApplyQuery,
} from './application-model.js';
export type {
  SyncInboxApplication,
  SyncInboxApplicationQuery,
  SyncInboxApplicationApplyQuery,
  SyncInboxApplicationReducer,
  SyncInboxApplicationHandlers,
  SyncInboxApplicationState,
} from './application-model.js';
import { auditInboxPageChain, parseInboxPageAuditQuery } from './page-audit.js';
import { parseInboxConsumersQuery, readInboxConsumers } from './consumers.js';
import {
  parseInboxPageChainAppendQuery,
  type SyncInboxPageChainAppendQuery,
} from './page-chain-append.js';
export { parseInboxPageChainAppendQuery } from './page-chain-append.js';
export type { SyncInboxPageChainAppendQuery } from './page-chain-append.js';
export { parseInboxConsumersQuery } from './consumers.js';
export type { SyncInboxConsumersQuery } from './consumers.js';
import {
  inboxPageSummary,
  parseInboxPageDetailQuery,
  parseInboxPageHistoryQuery,
  readInboxPageHistory,
} from './page-history.js';
export { parseInboxPageDetailQuery, parseInboxPageHistoryQuery } from './page-history.js';
export type { SyncInboxPageDetailQuery, SyncInboxPageHistoryQuery } from './page-history.js';
export { parseInboxPageAuditQuery } from './page-audit.js';
export type { SyncInboxPageAuditQuery } from './page-audit.js';
import {
  InboxAcknowledgements,
  type SyncInboxAcknowledgement,
  type SyncInboxAcknowledgementDispatch,
} from './acknowledgements.js';
export type {
  SyncInboxAcknowledgement,
  SyncInboxAcknowledgementDispatch,
  SyncInboxAcknowledgementSummary,
  SyncInboxAcknowledgementDispatchSummary,
  SyncInboxAcknowledgementRecovery,
} from './acknowledgements.js';
export { parseInboxAckHistoryQuery, parseInboxAckDetailQuery } from './ack-history-query.js';
export type { SyncInboxAckHistoryQuery } from './ack-history-query.js';
export { parseInboxAckAuditQuery } from './ack-audit.js';
export type { SyncInboxAckAuditQuery } from './ack-audit.js';

type Row = Record<string, unknown>;
const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');
function failure(code: string, message: string, trace: string, state = 'not-committed') {
  return new ContractError(code, message, {
    trace_id: trace,
    retryable: false,
    local_commit_state: state,
    acknowledgement_dispatch_state: 'not-sent',
  });
}
function safeInteger(value: unknown, minimum = 0) {
  if (typeof value !== 'string' || !/^(0|[1-9][0-9]*)$/.test(value)) throw new TypeError();
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < minimum) throw new TypeError();
  return result;
}
function identityFor(value: unknown, trace: string) {
  try {
    const identity = parseSyncCommandIdentity(value);
    const json = JSON.stringify(identity);
    return { identity, json, key: sha256(json) };
  } catch {
    throw failure(
      'INBOX_IDENTITY_INVALID',
      'Supply the complete original consumer identity',
      trace,
    );
  }
}
function checkedPage(value: unknown, trace: string) {
  try {
    const page = parseSyncSavedPageFile(value);
    const json = syncSavedPageDocumentJson(page.document);
    if (sha256(json) !== page.document_sha256) throw new TypeError();
    return { page, json };
  } catch {
    throw failure(
      'INBOX_PAGE_INVALID',
      'The complete saved page or document digest is invalid',
      trace,
    );
  }
}
function checkedPageChain(value: unknown, trace: string) {
  try {
    const archive = parseSyncPageChainFile(value);
    if (sha256(syncPageChainDocumentJson(archive.document)) !== archive.document_sha256)
      throw new TypeError();
    const incoming = archive.document.pages.map((page) => checkedPage(page, trace));
    return { archive, incoming };
  } catch {
    throw failure(
      'INBOX_PAGE_CHAIN_INVALID',
      'The complete root-to-head archive, identity or one of its digests is invalid',
      trace,
    );
  }
}
export interface SyncInboxState {
  identity: SyncCommandIdentity;
  recorded: boolean;
  received_cursor: number;
  page_count: number;
  head_sha256: string | null;
  page_limit: number | null;
  event_application: 'not-verified';
}
interface Head {
  page: SyncSavedPageFile;
  sequence: number;
  json: string;
}

/** Separate received-page storage. Never updates an outbox or acknowledges the server. */
export class SqliteSyncInbox {
  private readonly db: DatabaseSync;
  private readonly readOnly: boolean;

  constructor(path: string, options: { create?: boolean; readonly?: boolean; trace_id: string }) {
    const trace = options.trace_id;
    this.readOnly = options.readonly === true;
    try {
      if (
        !path.trim() ||
        path === ':memory:' ||
        path === '-' ||
        (options.create && this.readOnly) ||
        (options.create !== undefined && typeof options.create !== 'boolean') ||
        (options.readonly !== undefined && typeof options.readonly !== 'boolean')
      )
        throw new TypeError();
      if (options.create) {
        // The newly reserved path is retained on any later failure for explicit inspection.
        const handle = openSync(path, 'wx', 0o600);
        closeSync(handle);
      } else if (!lstatSync(path).isFile()) throw new TypeError();
      this.db = new DatabaseSync(path);
    } catch {
      throw failure(
        'INBOX_STORAGE_UNAVAILABLE',
        'Use an existing inbox, or explicitly create a new file in a directory you control',
        trace,
      );
    }
    try {
      this.db.exec('PRAGMA busy_timeout = 5000');
      this.db.exec('PRAGMA foreign_keys = ON');
      this.db.exec('PRAGMA synchronous = FULL');
      if (this.db.prepare('PRAGMA foreign_keys').get()?.foreign_keys !== 1) throw new TypeError();
      if (this.db.prepare('PRAGMA synchronous').get()?.synchronous !== 2) throw new TypeError();
      if (options.create) this.transaction(() => this.db.exec(SYNC_INBOX_SCHEMA_V1), trace, true);
      this.requireSchema(trace);
      if (this.readOnly) this.db.exec('PRAGMA query_only = ON');
    } catch (error) {
      try {
        this.db.close();
      } catch {
        /* Keep the original initialization failure. */
      }
      if (error instanceof ContractError) throw error;
      throw failure(
        'INBOX_STORAGE_UNAVAILABLE',
        'The local inbox could not be opened; keep the file for inspection',
        trace,
      );
    }
  }
  private requireSchema(trace: string) {
    try {
      const metadata = this.db
        .prepare('SELECT version FROM sync_inbox_schema WHERE singleton = 1')
        .get();
      if (metadata?.version !== SYNC_INBOX_SCHEMA_VERSION) throw new TypeError();
      for (const [table, required] of Object.entries({
        sync_inbox_pages: [
          'consumer_key',
          'document_sha256',
          'sequence',
          'previous_sha256',
          'from_cursor',
          'next_cursor',
          'page_limit',
          'document_json',
        ],
        sync_inbox_consumers: [
          'consumer_key',
          'identity_json',
          'tenant_id',
          'workspace_id',
          'project_id',
          'actor_id',
          'client_id',
          'head_sha256',
          'received_cursor',
          'page_count',
        ],
      })) {
        const columns = new Set(
          this.db
            .prepare('PRAGMA table_info(' + table + ')')
            .all()
            .map((row) => row.name),
        );
        if (required.some((name) => !columns.has(name))) throw new TypeError();
      }
    } catch {
      throw failure(
        'INBOX_SCHEMA_REQUIRED',
        'Use an explicitly initialized version 1 inbox; existing files are never upgraded automatically',
        trace,
      );
    }
  }
  private transaction<T>(run: () => T, trace: string, write: boolean): T {
    let begun = false;
    let committing = false;
    try {
      if (write && this.readOnly)
        throw failure('INBOX_READ_ONLY', 'This inbox was opened for reading', trace);
      this.db.exec(write ? 'BEGIN IMMEDIATE' : 'BEGIN');
      begun = true;
      const result = run();
      committing = true;
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      if (begun) {
        try {
          this.db.exec('ROLLBACK');
        } catch {
          /* A commit error can already have persisted. */
        }
      }
      if (committing && write)
        throw failure(
          'INBOX_COMMIT_UNKNOWN',
          'The local commit could not be confirmed; reopen and inspect the original consumer before repeating the local operation',
          trace,
          'unknown',
        );
      if (error instanceof ContractError) throw error;
      throw failure(
        'INBOX_STORAGE_UNAVAILABLE',
        'The local inbox operation could not be completed',
        trace,
      );
    }
  }
  private pageRow(key: string, digest: string): Row | undefined {
    return this.db
      .prepare(
        `SELECT document_sha256,
      CASE WHEN previous_sha256 IS NULL OR length(previous_sha256) = 64 THEN previous_sha256 ELSE '' END AS previous_sha256,
      CASE WHEN typeof(sequence) = 'integer' THEN CAST(sequence AS TEXT) ELSE NULL END AS sequence,
      CASE WHEN typeof(from_cursor) = 'integer' THEN CAST(from_cursor AS TEXT) ELSE NULL END AS from_cursor,
      CASE WHEN typeof(next_cursor) = 'integer' THEN CAST(next_cursor AS TEXT) ELSE NULL END AS next_cursor,
      CASE WHEN typeof(page_limit) = 'integer' THEN CAST(page_limit AS TEXT) ELSE NULL END AS page_limit,
      CASE WHEN length(CAST(document_json AS BLOB)) <= ? THEN document_json ELSE NULL END AS document_json
      FROM sync_inbox_pages WHERE consumer_key = ? AND document_sha256 = ?`,
      )
      .get(SYNC_SAVED_PAGE_DOCUMENT_BYTES, key, digest);
  }
  private decode(row: Row, identity: SyncCommandIdentity, trace: string): Head {
    try {
      if (typeof row.document_json !== 'string') throw new TypeError();
      const { page, json } = checkedPage(
        { document: JSON.parse(row.document_json), document_sha256: row.document_sha256 },
        trace,
      );
      assertSyncCommandIdentity(page.document.expected_identity, identity);
      const sequence = safeInteger(row.sequence, 1);
      if (
        json !== row.document_json ||
        page.document.previous_page_sha256 !== row.previous_sha256 ||
        page.document.query.cursor !== safeInteger(row.from_cursor) ||
        page.document.page.data.next_cursor !== safeInteger(row.next_cursor) ||
        page.document.query.limit !== safeInteger(row.page_limit, 1) ||
        (sequence === 1 && (row.previous_sha256 !== null || page.document.query.cursor !== 0)) ||
        (sequence > 1 && row.previous_sha256 === null)
      )
        throw new TypeError();
      return { page, json, sequence };
    } catch {
      throw failure(
        'INBOX_CORRUPT',
        'A stored page or its metadata is inconsistent; preserve the inbox',
        trace,
      );
    }
  }
  private head(original: ReturnType<typeof identityFor>, trace: string): Head | undefined {
    const row = this.db
      .prepare(
        `SELECT CASE WHEN length(head_sha256) = 64 THEN head_sha256 ELSE NULL END AS head_sha256,
      CASE WHEN typeof(received_cursor) = 'integer' THEN CAST(received_cursor AS TEXT) ELSE NULL END AS received_cursor,
      CASE WHEN typeof(page_count) = 'integer' THEN CAST(page_count AS TEXT) ELSE NULL END AS page_count,
      CASE WHEN identity_json = ? AND tenant_id = ? AND workspace_id = ? AND project_id = ? AND actor_id = ? AND client_id = ?
        THEN 1 ELSE 0 END AS identity_matches
      FROM sync_inbox_consumers WHERE consumer_key = ?`,
      )
      .get(
        original.json,
        original.identity.tenant_id,
        original.identity.workspace_id,
        original.identity.project_id,
        original.identity.actor_id,
        original.identity.client_id,
        original.key,
      );
    if (!row) {
      if (
        this.db
          .prepare('SELECT 1 AS present FROM sync_inbox_pages WHERE consumer_key = ? LIMIT 1')
          .get(original.key)
      )
        throw failure('INBOX_CORRUPT', 'Stored pages have no consumer checkpoint', trace);
      return undefined;
    }
    const corrupt = () =>
      failure(
        'INBOX_CORRUPT',
        'The stored consumer checkpoint does not match its complete head page',
        trace,
      );
    let count: number;
    let cursor: number;
    let digest: string;
    try {
      if (
        row.identity_matches !== 1 ||
        typeof row.head_sha256 !== 'string' ||
        !/^[a-f0-9]{64}$/.test(row.head_sha256)
      )
        throw new TypeError();
      digest = row.head_sha256;
      count = safeInteger(row.page_count, 1);
      cursor = safeInteger(row.received_cursor);
    } catch {
      throw corrupt();
    }
    // Keep storage failures outside validation catches so I/O errors do not allege corruption.
    const stored = this.pageRow(original.key, digest);
    if (!stored) throw corrupt();
    const head = this.decode(stored, original.identity, trace);
    if (head.sequence !== count || head.page.document.page.data.next_cursor !== cursor)
      throw corrupt();
    const previous = head.page.document.previous_page_sha256;
    if (previous !== null) {
      const parentRow = this.pageRow(original.key, previous);
      if (!parentRow) throw corrupt();
      const parent = this.decode(parentRow, original.identity, trace);
      if (
        parent.sequence !== head.sequence - 1 ||
        parent.page.document.page.data.next_cursor !== head.page.document.query.cursor ||
        parent.page.document.query.limit !== head.page.document.query.limit
      )
        throw corrupt();
    }
    // Detect orphaned/future rows without loading an unbounded history.
    if (
      this.db
        .prepare(
          'SELECT 1 AS present FROM sync_inbox_pages WHERE consumer_key = ? AND sequence > ? LIMIT 1',
        )
        .get(original.key, head.sequence)
    )
      throw corrupt();
    return head;
  }
  private state(
    identity: SyncCommandIdentity,
    head: Pick<Head, 'page' | 'sequence'> | undefined,
  ): SyncInboxState {
    return {
      identity: { ...identity },
      recorded: head !== undefined,
      received_cursor: head?.page.document.page.data.next_cursor ?? 0,
      page_count: head?.sequence ?? 0,
      head_sha256: head?.page.document_sha256 ?? null,
      page_limit: head?.page.document.query.limit ?? null,
      event_application: 'not-verified',
    };
  }
  inspect(identity: SyncCommandIdentity, trace: string): SyncInboxState {
    const original = identityFor(identity, trace);
    return this.transaction(
      () => this.state(original.identity, this.head(original, trace)),
      trace,
      false,
    );
  }
  listConsumers(input: unknown, trace: string) {
    const query = parseInboxConsumersQuery(input, trace);
    return this.transaction(
      () =>
        readInboxConsumers(
          this.db,
          query,
          (identity) => {
            const original = identityFor(identity, trace);
            return this.state(original.identity, this.head(original, trace));
          },
          trace,
        ),
      trace,
      false,
    );
  }
  readHead(identity: SyncCommandIdentity, trace: string): SyncSavedPageFile {
    const original = identityFor(identity, trace);
    return this.transaction(
      () => {
        const head = this.head(original, trace);
        if (!head)
          throw failure('INBOX_NOT_FOUND', 'No page is stored for this original consumer', trace);
        return head.page;
      },
      trace,
      false,
    );
  }
  auditPages(input: unknown, trace: string) {
    const query = parseInboxPageAuditQuery(input, trace);
    const original = identityFor(query.expected_identity, trace);
    try {
      return this.transaction(
        () => {
          const audit = auditInboxPageChain(this.db, original.key, query.max_pages, trace, {
            head: () => this.head(original, trace),
            page: (digest) => {
              const row = this.pageRow(original.key, digest);
              return row ? this.decode(row, original.identity, trace) : undefined;
            },
          });
          return {
            status: 'complete' as const,
            audit_completed: true as const,
            audit_scope: 'consumer-page-chain' as const,
            consistency: 'single-read-transaction' as const,
            state: this.state(original.identity, audit.head),
            checked_pages: audit.checked_pages,
            checked_events: audit.checked_events,
            root_sha256: audit.root_sha256,
            max_pages: query.max_pages,
            acknowledgement_history: 'not-audited' as const,
            database_integrity: 'not-audited' as const,
            acknowledgement_dispatch_state: 'not-sent' as const,
          };
        },
        trace,
        false,
      );
    } catch (error) {
      if (!(error instanceof ContractError)) throw error;
      throw new ContractError(error.envelope.code, error.envelope.message, {
        trace_id: trace,
        retryable: false,
        details: {
          ...error.envelope.details,
          audit_scope: 'consumer-page-chain',
          audit_completed: false,
          acknowledgement_dispatch_state: 'not-sent',
        },
      });
    }
  }
  private historyPage(
    original: ReturnType<typeof identityFor>,
    digest: string,
    head: Head | undefined,
    trace: string,
  ): Head | undefined {
    const row = this.pageRow(original.key, digest);
    if (!row) return undefined;
    const selected = this.decode(row, original.identity, trace);
    const corrupt = () =>
      failure(
        'INBOX_CORRUPT',
        'The selected historical page differs from its checkpoint or adjacent predecessor',
        trace,
      );
    if (
      !head ||
      selected.page.document_sha256 !== digest ||
      selected.sequence > head.sequence ||
      selected.page.document.query.limit !== head.page.document.query.limit ||
      (selected.sequence === head.sequence && digest !== head.page.document_sha256)
    )
      throw corrupt();
    const previous = selected.page.document.previous_page_sha256;
    if (previous !== null) {
      const parentRow = this.pageRow(original.key, previous);
      if (!parentRow) throw corrupt();
      const parent = this.decode(parentRow, original.identity, trace);
      if (
        parent.page.document_sha256 !== previous ||
        parent.sequence !== selected.sequence - 1 ||
        parent.page.document.page.data.next_cursor !== selected.page.document.query.cursor ||
        parent.page.document.query.limit !== selected.page.document.query.limit
      )
        throw corrupt();
    }
    return selected;
  }
  readPageHistory(input: unknown, trace: string) {
    const query = parseInboxPageHistoryQuery(input, trace);
    const original = identityFor(query.expected_identity, trace);
    return this.transaction(
      () => {
        const head = this.head(original, trace);
        return readInboxPageHistory(
          this.db,
          original.key,
          query,
          head,
          (digest) => this.historyPage(original, digest, head, trace),
          trace,
        );
      },
      trace,
      false,
    );
  }
  readPageByDigest(input: unknown, trace: string) {
    const query = parseInboxPageDetailQuery(input, trace);
    const original = identityFor(query.expected_identity, trace);
    return this.transaction(
      () => {
        const head = this.head(original, trace);
        const selected = this.historyPage(original, query.document_sha256, head, trace);
        return {
          kind: 'page' as const,
          expected_identity: original.identity,
          document_sha256: query.document_sha256,
          page: selected?.page ?? null,
          summary: selected ? inboxPageSummary(selected) : null,
          current_state: this.state(original.identity, head),
          full_chain_audit: 'not-performed' as const,
        };
      },
      trace,
      false,
    );
  }
  importPage(
    value: unknown,
    trace: string,
  ): { status: 'stored' | 'already-stored'; imported_sha256: string; state: SyncInboxState } {
    const incoming = checkedPage(value, trace);
    return this.transaction(() => this.importCheckedPage(incoming, trace), trace, true);
  }
  /** Runs only within the owner's existing write transaction. */
  private importCheckedPage(incoming: ReturnType<typeof checkedPage>, trace: string) {
    const document = incoming.page.document;
    const original = identityFor(document.expected_identity, trace);
    const head = this.head(original, trace);
    const duplicate = this.pageRow(original.key, incoming.page.document_sha256);
    if (duplicate) {
      const stored = this.decode(duplicate, original.identity, trace);
      if (!head || stored.json !== incoming.json || stored.sequence > head.sequence)
        throw failure(
          'INBOX_CORRUPT',
          'The stored page conflicts with its original content or consumer head',
          trace,
        );
      return {
        status: 'already-stored' as const,
        imported_sha256: incoming.page.document_sha256,
        state: this.state(original.identity, head),
      };
    }
    if (
      head
        ? document.previous_page_sha256 !== head.page.document_sha256 ||
          document.query.cursor !== head.page.document.page.data.next_cursor ||
          document.query.limit !== head.page.document.query.limit
        : document.previous_page_sha256 !== null || document.query.cursor !== 0
    )
      throw failure(
        'INBOX_CHAIN_MISMATCH',
        'Import the missing predecessor or use the current head; a new consumer must start at cursor zero',
        trace,
      );
    const sequence = (head?.sequence ?? 0) + 1;
    if (!Number.isSafeInteger(sequence))
      throw failure('INBOX_LIMIT_REACHED', 'The local page sequence cannot advance safely', trace);
    this.db
      .prepare(
        `INSERT INTO sync_inbox_pages
        (consumer_key, document_sha256, sequence, previous_sha256, from_cursor, next_cursor, page_limit, document_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        original.key,
        incoming.page.document_sha256,
        sequence,
        document.previous_page_sha256,
        document.query.cursor,
        document.page.data.next_cursor,
        document.query.limit,
        incoming.json,
      );
    if (head) {
      const changed = this.db
        .prepare(
          `UPDATE sync_inbox_consumers SET head_sha256 = ?, received_cursor = ?, page_count = ?
          WHERE consumer_key = ? AND head_sha256 = ? AND received_cursor = ? AND page_count = ?`,
        )
        .run(
          incoming.page.document_sha256,
          document.page.data.next_cursor,
          sequence,
          original.key,
          head.page.document_sha256,
          head.page.document.page.data.next_cursor,
          head.sequence,
        ).changes;
      if (changed !== 1 && changed !== 1n)
        throw failure(
          'INBOX_CORRUPT',
          'The consumer checkpoint changed before it could advance',
          trace,
        );
    } else {
      const id = original.identity;
      this.db
        .prepare(
          `INSERT INTO sync_inbox_consumers
          (consumer_key, identity_json, tenant_id, workspace_id, project_id, actor_id, client_id, head_sha256, received_cursor, page_count)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          original.key,
          original.json,
          id.tenant_id,
          id.workspace_id,
          id.project_id,
          id.actor_id,
          id.client_id,
          incoming.page.document_sha256,
          document.page.data.next_cursor,
          sequence,
        );
    }
    const committedHead = this.head(original, trace);
    if (!committedHead || committedHead.page.document_sha256 !== incoming.page.document_sha256)
      throw failure(
        'INBOX_CORRUPT',
        'The prepared checkpoint could not be read back completely',
        trace,
      );
    return {
      status: 'stored' as const,
      imported_sha256: incoming.page.document_sha256,
      state: this.state(original.identity, committedHead),
    };
  }
  readPageChainArchive(identity: SyncCommandIdentity, trace: string): SyncPageChainFile {
    const original = identityFor(identity, trace);
    return this.transaction(
      () => {
        const pages: SyncSavedPageFile[] = [];
        const document = {
          schema_version: 1 as const,
          kind: 'workctx.sync-page-chain' as const,
          expected_identity: original.identity,
          pages,
        };
        let bytes = Buffer.byteLength(JSON.stringify(document), 'utf8');
        const collect = (selected: Head | undefined) => {
          if (selected) {
            bytes +=
              Buffer.byteLength(JSON.stringify(selected.page), 'utf8') + (pages.length ? 1 : 0);
            if (bytes > SYNC_PAGE_CHAIN_DOCUMENT_BYTES)
              throw failure(
                'INBOX_PAGE_CHAIN_LIMIT_REACHED',
                'The complete page chain exceeds the 16 MiB archive limit; no partial archive was produced',
                trace,
              );
            pages.push(selected.page);
          }
          return selected;
        };
        auditInboxPageChain(this.db, original.key, SYNC_PAGE_CHAIN_MAX_PAGES, trace, {
          head: () => collect(this.head(original, trace)),
          page: (digest) => {
            const row = this.pageRow(original.key, digest);
            return collect(row ? this.decode(row, original.identity, trace) : undefined);
          },
        });
        pages.reverse();
        try {
          const parsed = parseSyncPageChainDocument(document);
          return { document: parsed, document_sha256: sha256(syncPageChainDocumentJson(parsed)) };
        } catch {
          throw failure(
            'INBOX_PAGE_CHAIN_LIMIT_REACHED',
            'The complete page chain exceeds the archive representation or JSON complexity limit',
            trace,
          );
        }
      },
      trace,
      false,
    );
  }
  restorePageChainArchive(value: unknown, trace: string) {
    const { archive, incoming } = checkedPageChain(value, trace);
    const original = identityFor(archive.document.expected_identity, trace);
    return this.transaction(
      () => {
        const conflict = () =>
          failure(
            'INBOX_PAGE_CHAIN_CONFLICT',
            'Restore requires an empty consumer or the exact same complete chain; existing pages are never merged, replaced or rewound',
            trace,
          );
        const audit = () =>
          auditInboxPageChain(this.db, original.key, SYNC_PAGE_CHAIN_MAX_PAGES, trace, {
            head: () => {
              const head = this.head(original, trace);
              if (head && head.sequence !== incoming.length) throw conflict();
              if (head && head.json !== incoming[head.sequence - 1]?.json) throw conflict();
              return head;
            },
            page: (digest) => {
              const row = this.pageRow(original.key, digest);
              const selected = row ? this.decode(row, original.identity, trace) : undefined;
              if (selected && selected.json !== incoming[selected.sequence - 1]?.json)
                throw conflict();
              return selected;
            },
          });
        const before = audit();
        if (before.head) {
          return {
            status: 'already-stored' as const,
            archive_document_sha256: archive.document_sha256,
            added_pages: 0,
            state: this.state(original.identity, before.head),
          };
        }
        for (const page of incoming) this.importCheckedPage(page, trace);
        const restored = audit();
        if (restored.checked_pages !== incoming.length)
          throw failure(
            'INBOX_CORRUPT',
            'The restored page chain could not be read back completely',
            trace,
          );
        return {
          status: incoming.length ? ('stored' as const) : ('empty' as const),
          archive_document_sha256: archive.document_sha256,
          added_pages: incoming.length,
          state: this.state(original.identity, restored.head),
        };
      },
      trace,
      true,
    );
  }
  /** The caller owns one transaction for every local read and any subsequent append. */
  private compareCheckedPageChain(checked: ReturnType<typeof checkedPageChain>, trace: string) {
    const { archive, incoming } = checked;
    const original = identityFor(archive.document.expected_identity, trace);
    const diagnostic: {
      first_difference: { sequence: number; local_sha256: string; archive_sha256: string } | null;
    } = { first_difference: null };
    const compare = (selected: Head | undefined) => {
      if (selected) {
        const archived = incoming[selected.sequence - 1];
        if (
          archived &&
          (selected.json !== archived.json ||
            selected.page.document_sha256 !== archived.page.document_sha256) &&
          (diagnostic.first_difference === null ||
            selected.sequence < diagnostic.first_difference.sequence)
        )
          diagnostic.first_difference = {
            sequence: selected.sequence,
            local_sha256: selected.page.document_sha256,
            archive_sha256: archived.page.document_sha256,
          };
      }
      return selected;
    };
    const audited = auditInboxPageChain(this.db, original.key, SYNC_PAGE_CHAIN_MAX_PAGES, trace, {
      head: () => compare(this.head(original, trace)),
      page: (digest) => {
        const row = this.pageRow(original.key, digest);
        return compare(row ? this.decode(row, original.identity, trace) : undefined);
      },
    });
    const state = this.state(original.identity, audited.head);
    const difference = diagnostic.first_difference;
    const relationship =
      difference !== null
        ? ('diverged' as const)
        : state.page_count === incoming.length
          ? ('identical' as const)
          : state.page_count === 0
            ? ('local-empty' as const)
            : state.page_count < incoming.length
              ? ('local-prefix' as const)
              : ('archive-prefix' as const);
    const append_allowed =
      relationship === 'identical' ||
      relationship === 'local-empty' ||
      relationship === 'local-prefix';
    const append_query: SyncInboxPageChainAppendQuery | null = append_allowed
      ? {
          expected_identity: original.identity,
          archive_document_sha256: archive.document_sha256,
          expected_head_sha256: state.head_sha256,
          expected_page_count: state.page_count,
        }
      : null;
    return {
      archive_document_sha256: archive.document_sha256,
      archive_page_count: incoming.length,
      relationship,
      state,
      matching_prefix_pages:
        difference === null ? Math.min(state.page_count, incoming.length) : difference.sequence - 1,
      first_difference: difference,
      append_allowed,
      pages_to_append: append_allowed ? incoming.length - state.page_count : null,
      append_query,
      checked_local_pages: audited.checked_pages,
      local_acknowledgement_history: 'not-audited' as const,
      database_integrity: 'not-audited' as const,
      event_application: 'not-verified' as const,
    };
  }
  comparePageChainArchive(value: unknown, trace: string) {
    const checked = checkedPageChain(value, trace);
    return this.transaction(
      () => ({
        ...this.compareCheckedPageChain(checked, trace),
        consistency: 'single-read-transaction' as const,
      }),
      trace,
      false,
    );
  }
  appendPageChainArchive(value: unknown, input: unknown, trace: string) {
    const query = parseInboxPageChainAppendQuery(input, trace);
    const checked = checkedPageChain(value, trace);
    try {
      assertSyncCommandIdentity(
        checked.archive.document.expected_identity,
        query.expected_identity,
      );
      if (checked.archive.document_sha256 !== query.archive_document_sha256) throw new TypeError();
    } catch {
      throw failure(
        'INBOX_PAGE_CHAIN_APPEND_INPUT_MISMATCH',
        'The archive differs from the original identity or digest selected for append',
        trace,
      );
    }
    return this.transaction(
      () => {
        const before = this.compareCheckedPageChain(checked, trace);
        if (
          before.state.head_sha256 !== query.expected_head_sha256 ||
          before.state.page_count !== query.expected_page_count
        )
          throw failure(
            'INBOX_PAGE_CHAIN_APPEND_STALE',
            'The local head changed after selection; compare again before explicitly choosing another append',
            trace,
          );
        if (!before.append_allowed)
          throw failure(
            'INBOX_PAGE_CHAIN_CONFLICT',
            'Append requires the complete local chain to be a matching prefix of the selected archive; divergent or newer local pages are preserved',
            trace,
          );
        const added_pages = checked.incoming.length - before.state.page_count;
        for (const page of checked.incoming.slice(before.state.page_count))
          this.importCheckedPage(page, trace);
        const after = added_pages ? this.compareCheckedPageChain(checked, trace) : before;
        if (after.relationship !== 'identical')
          throw failure(
            'INBOX_CORRUPT',
            'The appended page chain could not be read back completely',
            trace,
          );
        return {
          status: added_pages ? ('appended' as const) : ('already-stored' as const),
          archive_document_sha256: checked.archive.document_sha256,
          added_pages,
          previous_state: before.state,
          state: after.state,
          acknowledgement_journal_update: 'not-performed' as const,
        };
      },
      trace,
      true,
    );
  }
  private applications() {
    return new InboxApplications(this.db, this.readOnly, (identity, digest, trace) => {
      const original = identityFor(identity, trace);
      const head = this.head(original, trace);
      const selected = this.historyPage(original, digest, head, trace);
      if (!selected)
        throw failure(
          'INBOX_APPLICATION_PAGE_UNAVAILABLE',
          'The exact original page must already exist in the contiguous received chain',
          trace,
        );
      return selected;
    });
  }
  /** Explicit optional schema initialization; constructor/import do not enable applications. */
  enableApplications(trace: string) {
    return this.applications().enable(trace);
  }
  readApplicationState(input: unknown, trace: string) {
    return this.applications().read(input, trace);
  }
  /** Complete structural coverage in one read transaction; never re-executes reducers. */
  auditApplicationHistory(input: unknown, trace: string) {
    return this.applications().audit(input, trace);
  }
  /** Only pure synchronous handlers are supported. External effects are outside this transaction. */
  applyApplicationPage(input: unknown, handlers: SyncInboxApplicationHandlers, trace: string) {
    return this.applications().apply(input, handlers, trace);
  }
  /** Fixed built-in semantics; the complete original page and predecessor remain caller-selected. */
  applyBuiltInApplicationPage(input: unknown, trace: string) {
    const query = parseInboxBuiltInApplicationApplyQuery(input, trace);
    const adapter = contextItemApplicationAdapter(query.expected_identity);
    return {
      ...this.applications().apply(query, adapter.handlers, trace, adapter.validateProjection),
      adapter: adapter.descriptor,
    };
  }
  private acknowledgementJournal() {
    return new InboxAcknowledgements(
      this.db,
      (run, trace, write) => this.transaction(run, trace, write),
      (identity, digest, trace) => {
        const original = identityFor(identity, trace);
        if (typeof digest !== 'string' || !/^[a-f0-9]{64}$/.test(digest))
          throw failure('INBOX_PAGE_INVALID', 'Supply the original saved-page digest', trace);
        const head = this.head(original, trace);
        const row = this.pageRow(original.key, digest);
        if (!head || !row)
          throw failure(
            'INBOX_NOT_FOUND',
            'Import the original page before acknowledging it',
            trace,
          );
        const stored = this.decode(row, original.identity, trace);
        if (stored.sequence > head.sequence)
          throw failure(
            'INBOX_CORRUPT',
            'The acknowledgement page is beyond its stored consumer head',
            trace,
          );
        return stored.page;
      },
    );
  }
  enableAcknowledgements(trace: string) {
    return this.acknowledgementJournal().enable(trace);
  }
  enableAcknowledgementDispatches(trace: string) {
    return this.acknowledgementJournal().enableDispatches(trace);
  }
  enableAcknowledgementRecoveries(trace: string) {
    return this.acknowledgementJournal().enableRecoveries(trace);
  }
  readAcknowledgementRecovery(input: unknown, trace: string) {
    return this.acknowledgementJournal().recoveryDetail(input, trace);
  }
  readAcknowledgementRecoveryEvidence(input: unknown, trace: string) {
    return this.acknowledgementJournal().recoveryEvidenceDocument(input, trace);
  }
  startAcknowledgementRecovery(
    identity: SyncCommandIdentity,
    digest: string,
    recordId: string,
    trace: string,
    timeout: number,
  ) {
    return this.acknowledgementJournal().startRecovery(identity, digest, recordId, trace, timeout);
  }
  readAcknowledgementDispatch(identity: SyncCommandIdentity, trace: string) {
    return this.acknowledgementJournal().dispatchStatus(identity, trace);
  }
  startAcknowledgementDispatch(
    identity: SyncCommandIdentity,
    digest: string,
    trace: string,
    timeout: number,
    previousDispatchId?: string,
  ) {
    return this.acknowledgementJournal().startDispatch(
      identity,
      digest,
      trace,
      timeout,
      previousDispatchId,
    );
  }
  assertAcknowledgementDispatch(
    ticket: SyncInboxAcknowledgement,
    dispatch: SyncInboxAcknowledgementDispatch,
    trace: string,
  ) {
    return this.acknowledgementJournal().assertDispatch(ticket, dispatch, trace);
  }
  settleAcknowledgementDispatch(
    ticket: SyncInboxAcknowledgement,
    dispatch: SyncInboxAcknowledgementDispatch,
    value: unknown | null,
    trace: string,
  ) {
    return this.acknowledgementJournal().settleDispatch(ticket, dispatch, value, trace);
  }
  readAcknowledgement(identity: SyncCommandIdentity, trace: string) {
    return this.acknowledgementJournal().status(identity, trace);
  }
  readAcknowledgementHistory(input: unknown, trace: string) {
    return this.acknowledgementJournal().history(input, trace, false);
  }
  auditAcknowledgements(input: unknown, trace: string) {
    return this.acknowledgementJournal().audit(input, trace);
  }
  readAcknowledgementDispatchHistory(input: unknown, trace: string) {
    return this.acknowledgementJournal().history(input, trace, true);
  }
  readAcknowledgementById(input: unknown, trace: string) {
    return this.acknowledgementJournal().detail(input, trace, false);
  }
  readAcknowledgementEvidence(input: unknown, trace: string) {
    return this.acknowledgementJournal().evidenceDocument(input, trace, false);
  }
  readAcknowledgementDispatchEvidence(input: unknown, trace: string) {
    return this.acknowledgementJournal().evidenceDocument(input, trace, true);
  }
  readAcknowledgementDispatchById(input: unknown, trace: string) {
    return this.acknowledgementJournal().detail(input, trace, true);
  }
  prepareAcknowledgement(identity: SyncCommandIdentity, digest: string, trace: string) {
    return this.acknowledgementJournal().prepare(identity, digest, trace);
  }
  confirmAcknowledgement(ticket: SyncInboxAcknowledgement, value: unknown, trace: string) {
    return this.acknowledgementJournal().confirm(ticket, value, trace);
  }
  observeAcknowledgement(ticket: SyncInboxAcknowledgement, value: unknown, trace: string) {
    return this.acknowledgementJournal().observe(ticket, value, trace);
  }
  close(): void {
    this.db.close();
  }
}
