import {
  parseSyncChangesQuery,
  parseSyncChangesEnvelope,
  SYNC_CHANGES_RESPONSE_BYTES,
  type SyncChangesEnvelope,
} from './sync-changes.js';
import { parseSyncCommandIdentity, type SyncCommandIdentity } from './sync-command-context.js';
import { syncJsonSnapshot } from './sync-upload-receipt.js';

export const SYNC_SAVED_PAGE_DOCUMENT_BYTES = SYNC_CHANGES_RESPONSE_BYTES + 32 * 1024;
export const SYNC_SAVED_PAGE_FILE_BYTES = SYNC_SAVED_PAGE_DOCUMENT_BYTES + 4096;

/** A local archive, not a server receipt or proof of event application. */
export interface SyncSavedPageDocument {
  schema_version: 1;
  kind: 'workctx.sync-page';
  expected_identity: SyncCommandIdentity;
  query: { cursor: number; limit: number };
  previous_page_sha256: string | null;
  page: SyncChangesEnvelope;
}
export interface SyncSavedPageFile {
  document: SyncSavedPageDocument;
  document_sha256: string;
}
function record(value: unknown, keys: string[]): Record<string, unknown> {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).length !== keys.length ||
    Object.keys(value).some((key) => !keys.includes(key))
  )
    throw new TypeError('Invalid saved sync page fields');
  return value as Record<string, unknown>;
}
function digest(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value))
    throw new TypeError('Invalid saved sync page digest');
  return value;
}
export function parseSyncSavedPageDocument(value: unknown): SyncSavedPageDocument {
  const input = record(JSON.parse(syncJsonSnapshot(value, SYNC_SAVED_PAGE_DOCUMENT_BYTES)), [
    'schema_version',
    'kind',
    'expected_identity',
    'query',
    'previous_page_sha256',
    'page',
  ]);
  if (input.schema_version !== 1 || input.kind !== 'workctx.sync-page') throw new TypeError();
  const expected_identity = parseSyncCommandIdentity(input.expected_identity);
  const query = parseSyncChangesQuery(input.query);
  // Omitted cursor would depend on a later server acknowledgement; archives must be explicit.
  if (query.cursor === undefined || query.limit === undefined) throw new TypeError();
  const pageRecord = record(input.page, [
    'schema_version',
    'trace_id',
    'source_refs',
    'server_cursor',
    'data',
  ]);
  if (typeof pageRecord.trace_id !== 'string') throw new TypeError();
  const page = parseSyncChangesEnvelope(input.page, query, expected_identity, pageRecord.trace_id);
  return {
    schema_version: 1,
    kind: 'workctx.sync-page',
    expected_identity,
    query: { cursor: query.cursor, limit: query.limit },
    previous_page_sha256:
      input.previous_page_sha256 === null ? null : digest(input.previous_page_sha256),
    page,
  };
}
/** Fixed outer order; event payload/extra field order is preserved. Hash these UTF-8 bytes. */
export function syncSavedPageDocumentJson(value: unknown): string {
  return syncJsonSnapshot(parseSyncSavedPageDocument(value), SYNC_SAVED_PAGE_DOCUMENT_BYTES);
}
/** Structural validation only: storage adapters MUST verify document_sha256 independently. */
export function parseSyncSavedPageFile(value: unknown): SyncSavedPageFile {
  const input = record(JSON.parse(syncJsonSnapshot(value, SYNC_SAVED_PAGE_FILE_BYTES)), [
    'document',
    'document_sha256',
  ]);
  return {
    document: parseSyncSavedPageDocument(input.document),
    document_sha256: digest(input.document_sha256),
  };
}
