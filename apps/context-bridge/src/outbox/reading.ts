import type { DatabaseSync } from 'node:sqlite';
import {
  ContractError,
  isUlid,
  isSyncIdentifier,
  parseSyncCommandIdentity,
  syncJsonSnapshot,
  MAX_SYNC_BATCH_BYTES,
} from '@planemem/contracts';
import type { LocalEvent, OutboxScope } from './sqlite.js';

export interface OutboxListQuery {
  scope: OutboxScope;
  limit: number;
  status?: LocalEvent['status'];
  after_event_id?: string;
}
const statuses = ['pending', 'sending', 'sent', 'failed', 'conflict'] as const;
function fail(code: string, message: string, trace: string) {
  return new ContractError(code, message, { trace_id: trace, retryable: false });
}
export function parseOutboxReadScope(value: unknown, trace: string): OutboxScope {
  try {
    const row: unknown = JSON.parse(syncJsonSnapshot(value, 16384));
    if (!row || typeof row !== 'object' || Array.isArray(row)) throw new TypeError();
    const scope = row as Record<string, unknown>;
    if (
      Object.keys(scope).length !== 3 ||
      Object.keys(scope).some(
        (key) => !['tenant_id', 'workspace_id', 'project_id'].includes(key),
      ) ||
      !isUlid(scope.tenant_id) ||
      !isUlid(scope.workspace_id) ||
      !isUlid(scope.project_id)
    )
      throw new TypeError();
    return {
      tenant_id: scope.tenant_id,
      workspace_id: scope.workspace_id,
      project_id: scope.project_id,
    };
  } catch {
    throw fail('OUTBOX_READ_SCOPE_INVALID', 'Supply the complete original project scope', trace);
  }
}
export function parseOutboxListQuery(value: unknown, trace: string): OutboxListQuery {
  try {
    const snapshot: unknown = JSON.parse(syncJsonSnapshot(value, 16384));
    if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) throw new TypeError();
    const row = snapshot as Record<string, unknown>;
    if (
      Object.keys(row).some((key) => !['scope', 'limit', 'status', 'after_event_id'].includes(key))
    )
      throw new TypeError();
    const limit = row.limit === undefined ? 20 : row.limit;
    if (typeof limit !== 'number' || !Number.isSafeInteger(limit) || limit < 1 || limit > 50)
      throw new TypeError();
    const result: OutboxListQuery = { scope: parseOutboxReadScope(row.scope, trace), limit };
    if (row.status !== undefined) {
      if (typeof row.status !== 'string' || !statuses.includes(row.status as LocalEvent['status']))
        throw new TypeError();
      result.status = row.status as LocalEvent['status'];
    }
    if (row.after_event_id !== undefined) {
      if (!isSyncIdentifier(row.after_event_id)) throw new TypeError();
      result.after_event_id = row.after_event_id;
    }
    return result;
  } catch {
    throw fail(
      'OUTBOX_LIST_QUERY_INVALID',
      'Supply scope and optional status, limit (1 to 50), and after_event_id',
      trace,
    );
  }
}

const text: [string, number, boolean][] = [
  ['event_id', 1020, false],
  ['tenant_id', 26, false],
  ['workspace_id', 26, false],
  ['project_id', 26, false],
  ['event_type', 1020, false],
  ['idempotency_key', 4096, false],
  ['next_retry_at', 64, false],
  ['checksum', 71, false],
  ['status', 16, false],
  ['trace_id', 4096, false],
  ['lease_token', 1020, true],
  ['sensitivity', 16, true],
  ['server_event_id', 1020, true],
  ['conflict_id', 1020, true],
  ['last_error', 4096, true],
  ['expected_actor_id', 4096, true],
  ['expected_client_id', 4096, true],
  ['command_checksum', 71, true],
];
const numbers: [string, number, boolean][] = [
  ['attempt', 0, false],
  ['client_cursor', 1, true],
  ['server_cursor', 1, true],
];

/** Preserve all known stored columns; derived read flags are not part of an archive. */
export function outboxStoredColumns(row: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const name of [...text, ...numbers].map(([name]) => name).concat(['payload', 'source_refs']))
    result[name] = row[name];
  return result;
}

/** Offline equivalent of the complete SQL projection; no validity flags are trusted from files. */
export function parseOutboxStoredRow(input: unknown, trace: string): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(syncJsonSnapshot(input, 4 * MAX_SYNC_BATCH_BYTES + 65536));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError();
    const row = value as Record<string, unknown>;
    const names = [...text, ...numbers].map(([name]) => name).concat(['payload', 'source_refs']);
    if (
      Object.keys(row).length !== names.length ||
      Object.keys(row).some((name) => !names.includes(name))
    )
      throw new TypeError();
    for (const [name, maximum, nullable] of [
      ...text,
      ['payload', MAX_SYNC_BATCH_BYTES, false],
      ['source_refs', MAX_SYNC_BATCH_BYTES, false],
    ] as [string, number, boolean][]) {
      const field = row[name];
      if (nullable && field === null) continue;
      if (typeof field !== 'string' || Buffer.byteLength(field, 'utf8') > maximum)
        throw new TypeError();
    }
    for (const [name, minimum, nullable] of numbers) {
      const field = row[name];
      if (nullable && field === null) continue;
      if (typeof field !== 'number' || !Number.isSafeInteger(field) || field < minimum)
        throw new TypeError();
    }
    return {
      ...outboxStoredColumns(row),
      metadata_valid: 1,
      payload_bytes: Buffer.byteLength(row.payload as string, 'utf8'),
      source_refs_bytes: Buffer.byteLength(row.source_refs as string, 'utf8'),
    };
  } catch {
    throw fail(
      'OUTBOX_ARCHIVE_RECORD_INVALID',
      'An archived original has missing, invalid or oversized columns',
      trace,
    );
  }
}

/** Only fixed column names enter SQL. Oversized values never cross into JavaScript. */
export function outboxReadProjection(content: boolean): string {
  const valid: string[] = [];
  const fields: string[] = [];
  for (const [name, maximum, nullable] of text) {
    const condition = `(typeof(${name}) = 'text' AND length(CAST(${name} AS BLOB)) <= ${maximum})`;
    valid.push(nullable ? `(${name} IS NULL OR ${condition})` : condition);
    fields.push(`CASE WHEN ${condition} THEN ${name} ELSE NULL END AS ${name}`);
  }
  for (const [name, minimum, nullable] of numbers) {
    const condition = `(typeof(${name}) = 'integer' AND ${name} BETWEEN ${minimum} AND 9007199254740991)`;
    valid.push(nullable ? `(${name} IS NULL OR ${condition})` : condition);
    fields.push(`CASE WHEN ${condition} THEN ${name} ELSE NULL END AS ${name}`);
  }
  for (const name of ['payload', 'source_refs']) {
    valid.push(`typeof(${name}) = 'text'`);
    fields.push(
      `CASE WHEN typeof(${name}) = 'text' THEN length(CAST(${name} AS BLOB)) ELSE NULL END AS ${name}_bytes`,
    );
    if (content)
      fields.push(
        `CASE WHEN typeof(${name}) = 'text' AND length(CAST(${name} AS BLOB)) <= ${MAX_SYNC_BATCH_BYTES} THEN ${name} ELSE NULL END AS ${name}`,
      );
  }
  fields.push(`CASE WHEN ${valid.join(' AND ')} THEN 1 ELSE 0 END AS metadata_valid`);
  return fields.join(', ');
}

export function outboxRecordSummary(
  row: Record<string, unknown>,
  scope: OutboxScope,
  now: number,
  trace: string,
) {
  try {
    if (
      row.metadata_valid !== 1 ||
      !isSyncIdentifier(row.event_id) ||
      !isSyncIdentifier(row.event_type) ||
      typeof row.status !== 'string' ||
      !statuses.includes(row.status as LocalEvent['status']) ||
      row.tenant_id !== scope.tenant_id ||
      row.workspace_id !== scope.workspace_id ||
      row.project_id !== scope.project_id ||
      typeof row.next_retry_at !== 'string' ||
      !Number.isFinite(Date.parse(row.next_retry_at)) ||
      new Date(row.next_retry_at).toISOString() !== row.next_retry_at ||
      typeof row.trace_id !== 'string' ||
      !row.trace_id.trim() ||
      row.trace_id.length > 1024 ||
      /[\u0000-\u001f\u007f\p{Cs}]/u.test(row.trace_id) ||
      typeof row.checksum !== 'string' ||
      !/^sha256:(?:[a-f0-9]{8}|[a-f0-9]{64})$/.test(row.checksum) ||
      (row.command_checksum !== null &&
        (typeof row.command_checksum !== 'string' ||
          !/^sha256:[a-f0-9]{64}$/.test(row.command_checksum))) ||
      (row.sensitivity !== null &&
        !['public', 'internal', 'confidential', 'restricted'].includes(String(row.sensitivity))) ||
      (row.lease_token !== null &&
        (!isSyncIdentifier(row.lease_token) || row.status !== 'sending')) ||
      (row.server_event_id !== null && !isSyncIdentifier(row.server_event_id)) ||
      (row.conflict_id !== null && !isSyncIdentifier(row.conflict_id))
    )
      throw new TypeError();
    for (const name of ['attempt', 'payload_bytes', 'source_refs_bytes']) {
      const value = row[name];
      if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0)
        throw new TypeError();
    }
    const identity =
      row.expected_actor_id === null && row.expected_client_id === null
        ? null
        : parseSyncCommandIdentity({
            ...scope,
            actor_id: row.expected_actor_id,
            client_id: row.expected_client_id,
          });
    return {
      event_id: row.event_id,
      event_type: row.event_type,
      status: row.status as LocalEvent['status'],
      attempt: row.attempt as number,
      next_retry_at: row.next_retry_at,
      trace_id: row.trace_id,
      expected_identity: identity,
      identity_state: identity === null ? ('missing' as const) : ('recorded' as const),
      payload_bytes: row.payload_bytes as number,
      source_refs_bytes: row.source_refs_bytes as number,
      last_error: row.last_error as string | null,
      delivery: {
        server_event_id: row.server_event_id as string | null,
        server_cursor: row.server_cursor as number | null,
        conflict_id: row.conflict_id as string | null,
      },
      send_lease:
        row.status === 'sending'
          ? Date.parse(row.next_retry_at) > now
            ? ('active' as const)
            : ('expired' as const)
          : ('none' as const),
      original_content: 'not-validated' as const,
    };
  } catch {
    throw fail(
      'OUTBOX_RECORD_CORRUPT',
      'A selected queue row has invalid or oversized metadata; preserve the original file',
      trace,
    );
  }
}

/** Caller holds one read transaction; membership and states may change between pages. */
export function readOutboxRecords(db: DatabaseSync, query: OutboxListQuery, trace: string) {
  const params: (string | number)[] = [
    query.scope.tenant_id,
    query.scope.workspace_id,
    query.scope.project_id,
  ];
  let filter = '';
  if (query.status !== undefined) {
    filter += ' AND local_events.status = ?';
    params.push(query.status);
  }
  if (query.after_event_id !== undefined) {
    filter += ' AND local_events.event_id COLLATE BINARY > ?';
    params.push(query.after_event_id);
  }
  params.push(query.limit + 1);
  const rows = db
    .prepare(
      `SELECT ${outboxReadProjection(false)} FROM local_events
    WHERE tenant_id = ? AND workspace_id = ? AND project_id = ? ${filter}
    ORDER BY local_events.event_id COLLATE BINARY ASC LIMIT ?`,
    )
    .all(...params);
  const now = Date.now();
  let previous = query.after_event_id;
  const summaries = rows.map((row) => {
    const summary = outboxRecordSummary(row, query.scope, now, trace);
    // Keep ordering and continuation comparisons in SQLite's same BINARY collation.
    // Do not compare Unicode identifiers with JavaScript's UTF-16 ordering.
    if (previous === summary.event_id)
      throw fail('OUTBOX_RECORD_CORRUPT', 'The selected event IDs are duplicated', trace);
    previous = summary.event_id;
    return summary;
  });
  const items = summaries.slice(0, query.limit);
  const has_more = summaries.length > query.limit;
  const last = items.at(-1);
  const result = {
    scope: query.scope,
    items,
    limit: query.limit,
    status: query.status ?? null,
    after_event_id: query.after_event_id ?? null,
    has_more,
    next_query: has_more && last ? { ...query, after_event_id: last.event_id } : null,
    observed_at: new Date(now).toISOString(),
    consistency: 'keyset-current-state' as const,
    original_content: 'not-validated' as const,
    database_integrity: 'not-audited' as const,
  };
  try {
    syncJsonSnapshot(result, 512 * 1024);
  } catch {
    throw fail(
      'OUTBOX_LIST_TOO_LARGE',
      'The complete metadata page exceeds 512 KiB; choose a smaller limit',
      trace,
    );
  }
  return result;
}

/** Read failures and rollback cleanup are separate; no queue mutation is performed. */
export function outboxReadTransaction<T>(db: DatabaseSync, run: () => T, trace: string): T {
  let begun = false;
  try {
    db.exec('BEGIN');
    begun = true;
    const result = run();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    let rollback_pending = false;
    if (begun) {
      try {
        db.exec('ROLLBACK');
      } catch {
        rollback_pending = true;
      }
    }
    throw new ContractError(
      error instanceof ContractError ? error.envelope.code : 'OUTBOX_STORAGE_UNAVAILABLE',
      error instanceof ContractError
        ? error.envelope.message
        : 'The selected queue records could not be read completely',
      {
        trace_id: trace,
        retryable: false,
        details: {
          ...(error instanceof ContractError ? error.envelope.details : {}),
          ...(rollback_pending ? { rollback_pending: true } : {}),
        },
      },
    );
  }
}
