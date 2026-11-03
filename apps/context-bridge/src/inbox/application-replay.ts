import { createHash } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import {
  ContractError,
  syncJsonSnapshot,
  SYNC_CHANGES_RESPONSE_BYTES,
  type SyncChange,
} from '@planemem/contracts';
import {
  applicationDigest,
  applicationFailure,
  applicationHandlers,
  INBOX_APPLICATION_REDUCTION_BYTES,
  INBOX_APPLICATION_STATE_BYTES,
} from './application-model.js';
import {
  auditInboxApplicationHistory,
  parseInboxApplicationAuditQuery,
  type SyncInboxApplicationAuditQuery,
} from './application-audit.js';
import type { InboxApplicationHistoryStep } from './application-history.js';
import { builtInApplicationAdapter, requireBuiltInApplication } from './built-in-applications.js';
import { InboxApplicationRejection } from './application-rejection.js';

export interface SyncInboxApplicationReplayQuery extends SyncInboxApplicationAuditQuery {
  max_replay_bytes: number;
}
/** Select a fixed built-in adapter before storage is opened. No executable query fields. */
export function parseInboxBuiltInApplicationReplayQuery(
  input: unknown,
  trace: string,
): SyncInboxApplicationReplayQuery {
  let query: SyncInboxApplicationReplayQuery;
  try {
    const value: unknown = JSON.parse(syncJsonSnapshot(input, 16384));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError();
    const { max_replay_bytes, ...base } = value as Record<string, unknown>;
    const replayBytes = max_replay_bytes === undefined ? 64 * 1024 * 1024 : max_replay_bytes;
    if (
      typeof replayBytes !== 'number' ||
      !Number.isSafeInteger(replayBytes) ||
      replayBytes < 1 ||
      replayBytes > 512 * 1024 * 1024
    )
      throw new TypeError();
    query = { ...parseInboxApplicationAuditQuery(base, trace), max_replay_bytes: replayBytes };
  } catch {
    throw applicationFailure(
      'INBOX_APPLICATION_REPLAY_QUERY_INVALID',
      'Supply the original identity/application, optional audit budgets and max_replay_bytes (1–536870912)',
      trace,
    );
  }
  requireBuiltInApplication(query.application, trace);
  return query;
}
const hash = (json: string) => createHash('sha256').update(json).digest('hex');
const bytes = (json: string) => Buffer.byteLength(json, 'utf8');

/** Caller owns a single read transaction covering structural audit and all forward replay. */
export function replayInboxApplicationHistory(
  db: DatabaseSync,
  key: { consumer: string; application: string },
  query: SyncInboxApplicationReplayQuery,
  trace: string,
  check: () => void,
  reads: {
    head(): InboxApplicationHistoryStep | undefined;
    step(digest: string): InboxApplicationHistoryStep | undefined;
    events(step: InboxApplicationHistoryStep): void;
  },
) {
  let stage = 'structure';
  let structure_completed = false;
  let replayed_pages = 0;
  let replayed_events = 0;
  let replayed_bytes = 0;
  let page_replay_bytes = 0;
  let selected_sequence: number | null = null;
  let selected_digest: string | null = null;
  let selected_event_id: string | null = null;
  let structural_progress:
    | { checked_pages: number; checked_events: number; checked_bytes: number }
    | undefined;
  const details = () => ({
    ...structural_progress,
    replay_scope: 'current-built-in-application-history',
    replay_completed: false,
    structure_completed,
    stage,
    replayed_pages,
    replayed_events,
    replayed_bytes,
    page_replay_bytes,
    selected_sequence,
    selected_digest,
    selected_event_id,
    max_replay_bytes: query.max_replay_bytes,
    max_page_replay_bytes: INBOX_APPLICATION_REDUCTION_BYTES,
    acknowledgement_dispatch_state: 'not-sent',
  });
  const fail = (code: string, message: string, extra: Record<string, unknown> = {}) =>
    new ContractError(code, message, {
      trace_id: trace,
      retryable: false,
      details: { ...details(), ...extra },
    });
  const corrupt = () =>
    fail(
      'INBOX_APPLICATION_REPLAY_CORRUPT',
      'The audited application history changed or is inconsistent',
    );
  const charge = (amount: number) => {
    replayed_bytes += amount;
    page_replay_bytes += amount;
    if (
      replayed_bytes > query.max_replay_bytes ||
      page_replay_bytes > INBOX_APPLICATION_REDUCTION_BYTES
    )
      throw fail(
        'INBOX_APPLICATION_REPLAY_LIMIT_REACHED',
        'Replay exceeded the selected cumulative or fixed per-page reduction budget; no partial success is reported',
      );
    check();
  };
  try {
    const audited = auditInboxApplicationHistory(db, key, query, trace, check, reads);
    structure_completed = true;
    structural_progress = {
      checked_pages: audited.checked_pages,
      checked_events: audited.checked_events,
      checked_bytes: audited.checked_bytes,
    };
    const adapter = builtInApplicationAdapter(query.application, query.expected_identity, trace);
    const handlers = applicationHandlers(adapter.handlers, trace);
    stage = 'membership';
    check();
    // Only digest/sequence metadata is retained, bounded by the already checked page budget.
    const rows = db
      .prepare(
        `SELECT
      CASE WHEN typeof(document_sha256) = 'text' AND length(document_sha256) = 64 THEN document_sha256 ELSE NULL END AS digest,
      CASE WHEN typeof(sequence) = 'integer' THEN CAST(sequence AS TEXT) ELSE NULL END AS sequence
      FROM sync_inbox_application_steps WHERE consumer_key = ? AND application_key = ?
      ORDER BY sequence LIMIT ?`,
      )
      .all(key.consumer, key.application, query.max_pages + 1);
    check();
    if (rows.length !== audited.checked_pages) throw corrupt();
    let projectionJson = 'null';
    let previousDigest: string | null = null;
    let previousCursor = 0;
    for (const row of rows) {
      check();
      stage = 'page';
      selected_sequence = replayed_pages + 1;
      selected_digest = null;
      selected_event_id = null;
      page_replay_bytes = 0;
      let digest: string;
      try {
        digest = applicationDigest(row.digest);
        if (row.sequence !== String(selected_sequence)) throw new TypeError();
      } catch {
        throw corrupt();
      }
      selected_digest = digest;
      const step = reads.step(digest);
      check();
      if (
        !step ||
        step.sequence !== selected_sequence ||
        step.page.document_sha256 !== digest ||
        step.page.document.previous_page_sha256 !== previousDigest ||
        step.page.document.query.cursor !== previousCursor ||
        step.page.document.query.limit !== audited.head?.page.document.query.limit
      )
        throw corrupt();
      const changes = step.page.document.page.data.changes;
      stage = 'event-types';
      for (const event of changes) {
        check();
        selected_event_id = event.event_id;
        if (!handlers.has(event.event_type))
          throw fail(
            'INBOX_APPLICATION_EVENT_UNSUPPORTED',
            'Every replayed event type requires an explicit built-in reducer',
          );
      }
      stage = 'reduction';
      for (const event of changes) {
        check();
        selected_event_id = event.event_id;
        const eventJson = syncJsonSnapshot(event, SYNC_CHANGES_RESPONSE_BYTES);
        charge(bytes(projectionJson) + bytes(eventJson));
        try {
          const result = handlers.get(event.event_type)!(
            JSON.parse(projectionJson) as unknown,
            JSON.parse(eventJson) as SyncChange,
          );
          if (
            result &&
            (typeof result === 'object' || typeof result === 'function') &&
            typeof (result as { then?: unknown }).then === 'function'
          ) {
            void Promise.resolve(result).catch(() => {});
            throw new TypeError();
          }
          projectionJson = syncJsonSnapshot(result, INBOX_APPLICATION_STATE_BYTES);
        } catch (error) {
          if (error instanceof InboxApplicationRejection) throw error;
          throw fail(
            'INBOX_APPLICATION_REPLAY_REDUCER_FAILED',
            'The current built-in reducer failed or returned an invalid projection',
          );
        }
        charge(bytes(projectionJson));
        replayed_events += 1;
      }
      selected_event_id = null;
      stage = 'projection';
      adapter.validateProjection(
        JSON.parse(projectionJson) as unknown,
        step.page.document.page.data.next_cursor,
      );
      check();
      if (projectionJson !== step.projectionJson)
        throw fail(
          'INBOX_APPLICATION_REPLAY_MISMATCH',
          'The saved projection differs from replay with the current built-in adapter',
          {
            saved_projection_sha256: step.projectionHash,
            replayed_projection_sha256: hash(projectionJson),
          },
        );
      replayed_pages += 1;
      previousDigest = digest;
      previousCursor = step.page.document.page.data.next_cursor;
    }
    stage = 'coverage';
    check();
    if (
      replayed_pages !== audited.checked_pages ||
      replayed_events !== audited.checked_events ||
      previousDigest !== (audited.head?.page.document_sha256 ?? null) ||
      previousCursor !== (audited.head?.page.document.page.data.next_cursor ?? 0) ||
      projectionJson !== (audited.head?.projectionJson ?? 'null')
    )
      throw corrupt();
    return {
      audited,
      replayed_pages,
      replayed_events,
      replayed_bytes,
      replayed_projection_sha256: hash(projectionJson),
      adapter: adapter.descriptor,
    };
  } catch (error) {
    const cause = error instanceof ContractError ? error.envelope : undefined;
    const rejection = error instanceof InboxApplicationRejection ? error : undefined;
    throw new ContractError(
      cause?.code ?? rejection?.code ?? 'INBOX_APPLICATION_STORAGE_UNAVAILABLE',
      cause?.message ?? rejection?.message ?? 'The application replay could not be completed',
      {
        trace_id: trace,
        retryable: false,
        details: {
          ...cause?.details,
          ...details(),
          ...(stage === 'structure' && cause
            ? {
                structure_stage: cause.details?.stage,
                structure_selected_digest: cause.details?.selected_digest,
              }
            : {}),
        },
      },
    );
  }
}
