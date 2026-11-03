import { createHash } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import {
  ContractError,
  parseSyncCommandIdentity,
  syncJsonSnapshot,
  type SyncCommandIdentity,
} from '@planemem/contracts';
import type { SyncInboxState } from './sqlite.js';

export interface SyncInboxConsumersQuery {
  limit: number;
  after_consumer_key?: string;
}
function fail(code: string, message: string, trace: string) {
  return new ContractError(code, message, {
    trace_id: trace,
    retryable: false,
    acknowledgement_dispatch_state: 'not-sent',
  });
}
function consumerKey(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) throw new TypeError();
  return value;
}
export function parseInboxConsumersQuery(value: unknown, trace: string): SyncInboxConsumersQuery {
  try {
    const snapshot: unknown = JSON.parse(syncJsonSnapshot(value, 16384));
    if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) throw new TypeError();
    const input = snapshot as Record<string, unknown>;
    if (Object.keys(input).some((key) => !['limit', 'after_consumer_key'].includes(key)))
      throw new TypeError();
    const limit = input.limit === undefined ? 20 : input.limit;
    if (typeof limit !== 'number' || !Number.isSafeInteger(limit) || limit < 1 || limit > 50)
      throw new TypeError();
    const result: SyncInboxConsumersQuery = { limit };
    if (input.after_consumer_key !== undefined)
      result.after_consumer_key = consumerKey(input.after_consumer_key);
    return result;
  } catch {
    throw fail(
      'INBOX_CONSUMERS_QUERY_INVALID',
      'Supply an object with optional limit (1 to 50) and lowercase 64-hex after_consumer_key',
      trace,
    );
  }
}

/** The caller provides a single read transaction and fully validated checkpoint reads. */
export function readInboxConsumers(
  db: DatabaseSync,
  query: SyncInboxConsumersQuery,
  read: (identity: SyncCommandIdentity) => SyncInboxState,
  trace: string,
) {
  const corrupt = () =>
    fail(
      'INBOX_CONSUMERS_CORRUPT',
      'A selected consumer identity, lookup key or checkpoint is inconsistent; preserve the inbox',
      trace,
    );
  const statement = db.prepare(
    `SELECT CASE WHEN typeof(consumer_key) = 'text' AND length(CAST(consumer_key AS BLOB)) = 64
      THEN consumer_key ELSE NULL END AS consumer_key,
    CASE WHEN typeof(identity_json) = 'text' AND length(CAST(identity_json AS BLOB)) <= 16384
      THEN identity_json ELSE NULL END AS identity_json
    FROM sync_inbox_consumers AS consumer
    ${query.after_consumer_key === undefined ? '' : 'WHERE consumer.consumer_key COLLATE BINARY > ?'}
    ORDER BY consumer.consumer_key COLLATE BINARY ASC LIMIT ?`,
  );
  // No first-page predicate: malformed empty/null keys must not disappear from discovery.
  const rows =
    query.after_consumer_key === undefined
      ? statement.all(query.limit + 1)
      : statement.all(query.after_consumer_key, query.limit + 1);
  let previous = query.after_consumer_key;
  const selected = rows.map((row) => {
    try {
      const key = consumerKey(row.consumer_key);
      if (previous !== undefined && key <= previous) throw new TypeError();
      if (typeof row.identity_json !== 'string') throw new TypeError();
      const identity = parseSyncCommandIdentity(JSON.parse(row.identity_json));
      const json = JSON.stringify(identity);
      if (json !== row.identity_json || createHash('sha256').update(json).digest('hex') !== key)
        throw new TypeError();
      previous = key;
      return { key, identity };
    } catch {
      throw corrupt();
    }
  });
  const has_more = selected.length > query.limit;
  const items = selected.slice(0, query.limit).map(({ key, identity }) => {
    // Storage and complete head failures retain their original categories.
    const state = read(identity);
    if (!state.recorded) throw corrupt();
    return { consumer_key: key, state };
  });
  const last = items.at(-1);
  const result = {
    kind: 'consumers' as const,
    items,
    limit: query.limit,
    after_consumer_key: query.after_consumer_key ?? null,
    has_more,
    next_query:
      has_more && last ? { limit: query.limit, after_consumer_key: last.consumer_key } : null,
    consistency: 'keyset-current-state' as const,
    full_chain_audit: 'not-performed' as const,
    acknowledgement_history: 'not-audited' as const,
    database_integrity: 'not-audited' as const,
  };
  try {
    syncJsonSnapshot(result, 512 * 1024);
  } catch {
    throw fail(
      'INBOX_CONSUMERS_TOO_LARGE',
      'The complete consumer list exceeds 512 KiB; select a smaller limit',
      trace,
    );
  }
  return result;
}
