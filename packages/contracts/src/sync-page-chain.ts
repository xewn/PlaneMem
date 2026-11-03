import {
  assertSyncCommandIdentity,
  parseSyncCommandIdentity,
  type SyncCommandIdentity,
} from './sync-command-context.js';
import { parseSyncSavedPageFile, type SyncSavedPageFile } from './sync-saved-page.js';
import { syncJsonSnapshot } from './sync-upload-receipt.js';

export const SYNC_PAGE_CHAIN_MAX_PAGES = 1000;
export const SYNC_PAGE_CHAIN_DOCUMENT_BYTES = 16 * 1024 * 1024;
export const SYNC_PAGE_CHAIN_FILE_BYTES = SYNC_PAGE_CHAIN_DOCUMENT_BYTES + 4096;

/** Complete received pages for one consumer; excludes acknowledgement and application state. */
export interface SyncPageChainDocument {
  schema_version: 1;
  kind: 'workctx.sync-page-chain';
  expected_identity: SyncCommandIdentity;
  pages: SyncSavedPageFile[];
}
export interface SyncPageChainFile {
  document: SyncPageChainDocument;
  document_sha256: string;
}
function row(value: unknown, fields: string[]): Record<string, unknown> {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).length !== fields.length ||
    Object.keys(value).some((key) => !fields.includes(key))
  )
    throw new TypeError('Invalid page chain fields');
  return value as Record<string, unknown>;
}
export function parseSyncPageChainDocument(value: unknown): SyncPageChainDocument {
  const input = row(JSON.parse(syncJsonSnapshot(value, SYNC_PAGE_CHAIN_DOCUMENT_BYTES)), [
    'schema_version',
    'kind',
    'expected_identity',
    'pages',
  ]);
  if (input.schema_version !== 1 || input.kind !== 'workctx.sync-page-chain') throw new TypeError();
  const expected_identity = parseSyncCommandIdentity(input.expected_identity);
  if (!Array.isArray(input.pages) || input.pages.length > SYNC_PAGE_CHAIN_MAX_PAGES)
    throw new TypeError('The complete chain exceeds its page limit');
  const seen = new Set<string>();
  let previous: string | null = null;
  let cursor = 0;
  let limit: number | undefined;
  const pages = input.pages.map((value: unknown) => {
    const saved = parseSyncSavedPageFile(value);
    const document = saved.document;
    assertSyncCommandIdentity(document.expected_identity, expected_identity);
    if (
      seen.has(saved.document_sha256) ||
      document.previous_page_sha256 !== previous ||
      document.query.cursor !== cursor ||
      (limit !== undefined && document.query.limit !== limit)
    )
      throw new TypeError('The archive must contain one complete root-to-head page chain');
    seen.add(saved.document_sha256);
    previous = saved.document_sha256;
    cursor = document.page.data.next_cursor;
    limit = document.query.limit;
    return saved;
  });
  return { schema_version: 1, kind: 'workctx.sync-page-chain', expected_identity, pages };
}
/** Fixed field order; original page payload order and download traces remain intact. */
export function syncPageChainDocumentJson(value: unknown): string {
  return syncJsonSnapshot(parseSyncPageChainDocument(value), SYNC_PAGE_CHAIN_DOCUMENT_BYTES);
}
/** Structural validation only; file/storage adapters MUST verify every nested and outer digest. */
export function parseSyncPageChainFile(value: unknown): SyncPageChainFile {
  const input = row(JSON.parse(syncJsonSnapshot(value, SYNC_PAGE_CHAIN_FILE_BYTES)), [
    'document',
    'document_sha256',
  ]);
  if (typeof input.document_sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(input.document_sha256))
    throw new TypeError('Invalid page chain digest');
  return {
    document: parseSyncPageChainDocument(input.document),
    document_sha256: input.document_sha256,
  };
}
export function syncPageChainSummary(document: SyncPageChainDocument) {
  const root = document.pages[0];
  const head = document.pages.at(-1);
  return {
    expected_identity: document.expected_identity,
    page_count: document.pages.length,
    event_count: document.pages.reduce(
      (count, page) => count + page.document.page.data.changes.length,
      0,
    ),
    root_sha256: root?.document_sha256 ?? null,
    head_sha256: head?.document_sha256 ?? null,
    received_cursor: head?.document.page.data.next_cursor ?? 0,
    page_limit: head?.document.query.limit ?? null,
    recorded: head !== undefined,
    archive_scope: 'consumer-received-page-chain' as const,
    acknowledgement_history: 'not-included' as const,
    event_application: 'not-verified' as const,
    provenance: 'local-archive-not-authenticated' as const,
  };
}
