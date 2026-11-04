import {
  ContractError,
  createUlid,
  contextItemDirectoryPosition,
  encodeContextItemDirectoryCursor,
  parseContextItemDirectoryCursor,
  parseContextItemDirectoryEnvelope,
  parseContextItemDirectoryQuery,
  syncJsonSnapshot,
  type ContextItemDirectoryPosition,
  type ContextItemDirectoryQuery,
  type ContextItemDirectoryRecord,
  type ContextItemDirectoryScope,
  type ContextItemDocument,
  type SyncCommandIdentity,
} from '@planemem/contracts';

/** Explicit query matches from a supplied scenario; never an imitation of PostgreSQL text search. */
export interface MockContextDirectorySeed {
  searches: Array<{ query: string; item_ids: string[] }>;
}
/** Display hints only; no mutation routes are enabled by these flags. */
export interface MockContextDirectoryAccess {
  compile: boolean;
  write: boolean;
  propose: boolean;
}
interface DirectorySession {
  identity: SyncCommandIdentity;
  expires_at: string;
  project_readable: boolean;
  read_context: boolean;
  read_restricted: boolean;
  visible_item_ids: string[];
  visible: Set<string>;
  directory_access: MockContextDirectoryAccess;
}
function fields(value: unknown, names: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError();
  const row = value as Record<string, unknown>;
  if (Object.keys(row).length !== names.length || names.some((name) => !Object.hasOwn(row, name)))
    throw new TypeError();
  return row;
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value !== null && typeof value === 'object')
    return (
      '{' +
      Object.entries(value)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([key, entry]) => JSON.stringify(key) + ':' + canonical(entry))
        .join(',') +
      '}'
    );
  const encoded = JSON.stringify(value);
  if (typeof encoded !== 'string') throw new TypeError();
  return encoded;
}
/** Already validated ordinary JSON; details/history expose milliseconds, directory retains micros. */
export function requireMatchingDirectoryRecord(
  record: ContextItemDirectoryRecord,
  item: ContextItemDocument,
  archived_at: string | null,
) {
  for (const key of [
    'id',
    'title',
    'item_type',
    'layer',
    'classification',
    'status',
    'source_ref',
    'confidence',
    'priority',
    'content',
    'source_refs',
    'trace_id',
    'version',
  ] as const)
    if (canonical(record[key]) !== canonical(item[key])) throw new TypeError();
  const times: Array<[string | null, string | null]> = [
    [record.updated_at, item.updated_at],
    [record.expires_at, item.expires_at],
    [record.archived_at, archived_at],
  ];
  for (const [left, right] of times) {
    if (left === null || right === null) {
      if (left !== right) throw new TypeError();
    } else if (new Date(left).toISOString() !== new Date(right).toISOString()) {
      throw new TypeError();
    }
  }
}
function compareIds(left: string, right: string) {
  const a = Array.from(left),
    b = Array.from(right);
  for (let index = 0; index < Math.min(a.length, b.length); index++) {
    const difference = a[index]!.codePointAt(0)! - b[index]!.codePointAt(0)!;
    if (difference) return difference;
  }
  return a.length - b.length;
}
function compare(left: ContextItemDirectoryPosition, right: ContextItemDirectoryPosition) {
  return (
    left.rank - right.rank ||
    (left.updated === right.updated
      ? compareIds(left.id, right.id)
      : left.updated > right.updated
        ? -1
        : 1)
  );
}
function invalid(trace: string): never {
  throw new ContractError(
    'INVALID_INPUT',
    'Use a configured text query and preserve the original directory filters, identity and page size',
    {
      trace_id: trace,
      retryable: false,
    },
  );
}

/** Owned by a history store; its caller supplies the shared lease, deadline and authority checks. */
export class MockContextDirectory {
  readonly #id = createUlid();
  readonly #records: Array<{
    item: ContextItemDirectoryRecord;
    position: ContextItemDirectoryPosition;
  }>;
  readonly #searches = new Map<string, Set<string>>();

  constructor(records: ContextItemDirectoryRecord[], configuration: unknown) {
    const input = fields(configuration, ['searches']);
    if (!Array.isArray(input.searches) || input.searches.length > 1000) throw new TypeError();
    const ids = new Set(records.map((item) => item.id));
    for (const raw of input.searches) {
      const row = fields(raw, ['query', 'item_ids']);
      const query = parseContextItemDirectoryQuery({ query: row.query }).query;
      if (
        !query ||
        query !== row.query ||
        this.#searches.has(query) ||
        !Array.isArray(row.item_ids) ||
        row.item_ids.length > 1000
      )
        throw new TypeError();
      const matches = new Set<string>();
      for (const id of row.item_ids) {
        if (typeof id !== 'string' || !ids.has(id) || matches.has(id)) throw new TypeError();
        matches.add(id);
      }
      this.#searches.set(query, matches);
    }
    this.#records = records
      .map((item) => ({ item, position: contextItemDirectoryPosition(item) }))
      .sort((a, b) => compare(a.position, b.position));
  }

  async read(
    query: ContextItemDirectoryQuery,
    scope: ContextItemDirectoryScope,
    session: DirectorySession,
    trace: string,
    live: () => void,
  ) {
    live();
    const matches = query.query === undefined ? undefined : this.#searches.get(query.query);
    if (query.query !== undefined && !matches) invalid(trace);
    const { cursor, ...filters } = query;
    const binding = syncJsonSnapshot(
      [
        'mock-context-directory-v1',
        this.#id,
        session.identity,
        session.expires_at,
        session.project_readable,
        session.read_context,
        session.read_restricted,
        [...session.visible_item_ids].sort(compareIds),
        session.directory_access,
        filters,
      ],
      1024 * 1024,
    );
    let key: string;
    try {
      // Await the underlying digest directly; an outer timeout must not release its lease early.
      const digest = await globalThis.crypto.subtle.digest(
        'SHA-256',
        new TextEncoder().encode(binding),
      );
      if (!(digest instanceof ArrayBuffer) || digest.byteLength !== 32) throw new TypeError();
      key = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join(
        '',
      );
    } catch {
      live();
      throw new ContractError(
        'CONTEXT_ITEM_INVALID',
        'The simulated cursor binding could not be calculated',
        {
          trace_id: trace,
          retryable: false,
        },
      );
    }
    live();
    const after = cursor === undefined ? undefined : parseContextItemDirectoryCursor(cursor);
    if (after && after.key !== key) invalid(trace);
    const selected: ContextItemDirectoryRecord[] = [];
    for (const { item, position } of this.#records) {
      live();
      if (
        !session.visible.has(item.id) ||
        (item.classification === 'restricted' && !session.read_restricted) ||
        (item.archived_at !== null) !== query.archived ||
        (matches && !matches.has(item.id)) ||
        (after && compare(position, after) <= 0) ||
        (['layer', 'classification', 'status', 'item_type'] as const).some(
          (field) => query[field] !== undefined && query[field] !== item[field],
        )
      )
        continue;
      selected.push(item);
      if (selected.length > query.limit) break;
    }
    const data = selected.slice(0, query.limit);
    const last = data[data.length - 1];
    return parseContextItemDirectoryEnvelope(
      {
        schema_version: 1,
        trace_id: trace,
        scope,
        query,
        // Required wire provenance label, not a claim that the mock queried PostgreSQL.
        source_refs: [{ type: 'postgres', id: 'wcp_context_items' }],
        data,
        ...(selected.length > query.limit && last
          ? {
              next_cursor: encodeContextItemDirectoryCursor(
                key,
                contextItemDirectoryPosition(last),
              ),
            }
          : {}),
        context_permissions: { ...session.directory_access, restricted: session.read_restricted },
      },
      query,
      scope,
      trace,
    );
  }
}
