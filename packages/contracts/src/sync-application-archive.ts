import { isSyncIdentifier } from './sync.js';
import {
  assertSyncCommandIdentity,
  parseSyncCommandIdentity,
  type SyncCommandIdentity,
} from './sync-command-context.js';
import { parseSyncSavedPageFile, type SyncSavedPageFile } from './sync-saved-page.js';
import { syncJsonSnapshot } from './sync-upload-receipt.js';

export const SYNC_APPLICATION_ARCHIVE_MAX_PAGES = 1000;
export const SYNC_APPLICATION_ARCHIVE_DOCUMENT_BYTES = 16 * 1024 * 1024;
export const SYNC_APPLICATION_ARCHIVE_FILE_BYTES = SYNC_APPLICATION_ARCHIVE_DOCUMENT_BYTES + 4096;
export const SYNC_APPLICATION_ARCHIVE_PROJECTION_BYTES = 1024 * 1024;

export interface SyncApplicationDescriptor {
  name: string;
  version: string;
}
export interface SyncApplicationArchiveStep {
  page: SyncSavedPageFile;
  projection: unknown;
  projection_sha256: string;
  application_trace_id: string;
}
export interface SyncApplicationArchiveDocument {
  schema_version: 1;
  kind: 'workctx.sync-application-history';
  expected_identity: SyncCommandIdentity;
  application: SyncApplicationDescriptor;
  steps: SyncApplicationArchiveStep[];
}
export interface SyncApplicationArchiveFile {
  document: SyncApplicationArchiveDocument;
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
    throw new TypeError('Invalid application archive fields');
  return value as Record<string, unknown>;
}
function digest(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value))
    throw new TypeError('Invalid application archive digest');
  return value;
}
export function parseSyncApplicationDescriptor(value: unknown): SyncApplicationDescriptor {
  const input = row(JSON.parse(syncJsonSnapshot(value, 16384)), ['name', 'version']);
  if (!isSyncIdentifier(input.name) || !isSyncIdentifier(input.version))
    throw new TypeError('Invalid application descriptor');
  return { name: input.name, version: input.version };
}
export function syncApplicationArchiveProjectionJson(value: unknown): string {
  return syncJsonSnapshot(value, SYNC_APPLICATION_ARCHIVE_PROJECTION_BYTES);
}
/** Structural validation. Adapters MUST verify all page/projection/outer SHA-256 digests. */
export function parseSyncApplicationArchiveDocument(
  value: unknown,
): SyncApplicationArchiveDocument {
  const input = row(JSON.parse(syncJsonSnapshot(value, SYNC_APPLICATION_ARCHIVE_DOCUMENT_BYTES)), [
    'schema_version',
    'kind',
    'expected_identity',
    'application',
    'steps',
  ]);
  if (input.schema_version !== 1 || input.kind !== 'workctx.sync-application-history')
    throw new TypeError();
  const expected_identity = parseSyncCommandIdentity(input.expected_identity);
  const application = parseSyncApplicationDescriptor(input.application);
  if (!Array.isArray(input.steps) || input.steps.length > SYNC_APPLICATION_ARCHIVE_MAX_PAGES)
    throw new TypeError('Too many archived application steps');
  const pages = new Set<string>();
  const events = new Set<string>();
  let previous: string | null = null;
  let cursor = 0;
  let limit: number | undefined;
  let previousProjection = 'null';
  const steps = input.steps.map((value: unknown) => {
    const step = row(value, ['page', 'projection', 'projection_sha256', 'application_trace_id']);
    const page = parseSyncSavedPageFile(step.page);
    const document = page.document;
    assertSyncCommandIdentity(document.expected_identity, expected_identity);
    if (
      pages.has(page.document_sha256) ||
      document.previous_page_sha256 !== previous ||
      document.query.cursor !== cursor ||
      (limit !== undefined && document.query.limit !== limit)
    )
      throw new TypeError('Application archive must contain one complete root-to-head chain');
    const trace = step.application_trace_id;
    if (
      typeof trace !== 'string' ||
      !trace.trim() ||
      trace.length > 1024 ||
      /[\u0000-\u001f\u007f\p{Cs}]/u.test(trace)
    )
      throw new TypeError('Invalid original application trace');
    const projectionJson = syncApplicationArchiveProjectionJson(step.projection);
    if (!document.page.data.changes.length && projectionJson !== previousProjection)
      throw new TypeError('Empty pages must preserve their preceding projection');
    for (const event of document.page.data.changes) {
      if (events.has(event.event_id)) throw new TypeError('Application archive reuses an event ID');
      events.add(event.event_id);
    }
    pages.add(page.document_sha256);
    previous = page.document_sha256;
    cursor = document.page.data.next_cursor;
    limit = document.query.limit;
    previousProjection = projectionJson;
    return {
      page,
      projection: JSON.parse(projectionJson) as unknown,
      projection_sha256: digest(step.projection_sha256),
      application_trace_id: trace,
    };
  });
  return {
    schema_version: 1,
    kind: 'workctx.sync-application-history',
    expected_identity,
    application,
    steps,
  };
}
/** Stable outer field order; original event/projection property order remains intact. */
export function syncApplicationArchiveDocumentJson(value: unknown): string {
  return syncJsonSnapshot(
    parseSyncApplicationArchiveDocument(value),
    SYNC_APPLICATION_ARCHIVE_DOCUMENT_BYTES,
  );
}
export function parseSyncApplicationArchiveFile(value: unknown): SyncApplicationArchiveFile {
  const input = row(JSON.parse(syncJsonSnapshot(value, SYNC_APPLICATION_ARCHIVE_FILE_BYTES)), [
    'document',
    'document_sha256',
  ]);
  return {
    document: parseSyncApplicationArchiveDocument(input.document),
    document_sha256: digest(input.document_sha256),
  };
}
export function syncApplicationArchiveSummary(document: SyncApplicationArchiveDocument) {
  const head = document.steps.at(-1);
  return {
    expected_identity: document.expected_identity,
    application: document.application,
    page_count: document.steps.length,
    event_count: document.steps.reduce(
      (count, step) => count + step.page.document.page.data.changes.length,
      0,
    ),
    root_sha256: document.steps[0]?.page.document_sha256 ?? null,
    head_sha256: head?.page.document_sha256 ?? null,
    applied_cursor: head?.page.document.page.data.next_cursor ?? 0,
    head_projection_sha256: head?.projection_sha256 ?? null,
    recorded: head !== undefined,
    archive_scope: 'consumer-application-history' as const,
    event_ledger: 'derived-from-original-pages' as const,
    received_suffix: 'not-included' as const,
    acknowledgement_history: 'not-included' as const,
    server_application: 'not-verified' as const,
    source_authenticity: 'not-verified' as const,
    projection_semantics: 'not-verified' as const,
    provenance: 'local-archive-not-authenticated' as const,
  };
}
