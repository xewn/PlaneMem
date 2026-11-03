import { createHash } from 'node:crypto';
import { parseArgs } from 'node:util';
import {
  ContractError,
  assertSyncIdentityScope,
  parseSyncSavedPageDocument,
  parseSyncSavedPageFile,
  parseSyncChangesEnvelope,
  syncSavedPageDocumentJson,
  syncJsonSnapshot,
  SYNC_SAVED_PAGE_FILE_BYTES,
  type SyncCommandIdentity,
  type SyncSavedPageFile,
  type SyncChangesQuery,
} from '@planemem/contracts';
import { readBoundedArtifactFile } from './artifact-files.js';
import {
  prepareArtifactOutput,
  saveArtifactOutput,
  type ArtifactOutput,
} from './artifact-output.js';

type Scope = { tenant_id: string; workspace_id: string; project_id: string };
const hash = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');

export async function readSyncPageFile(path: string, trace: string, scope?: Scope) {
  const expectedScope = scope === undefined ? undefined : { ...scope };
  let bytes: Uint8Array;
  try {
    if (!path.trim() || path === '-') throw new TypeError();
    bytes = await readBoundedArtifactFile(path, SYNC_SAVED_PAGE_FILE_BYTES, trace);
  } catch {
    throw new ContractError(
      'SYNC_PAGE_FILE_UNAVAILABLE',
      'Read an existing stable regular saved-page file within its size limit',
      { trace_id: trace, retryable: false, dispatch_state: 'not-sent' },
    );
  }
  try {
    const raw = new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^\uFEFF/, '');
    const saved = parseSyncSavedPageFile(JSON.parse(raw));
    if (hash(syncSavedPageDocumentJson(saved.document)) !== saved.document_sha256)
      throw new TypeError();
    if (expectedScope) assertSyncIdentityScope(saved.document.expected_identity, expectedScope);
    return { ...saved, file_bytes: bytes.byteLength, file_sha256: hash(bytes) };
  } catch {
    throw new ContractError(
      'SYNC_PAGE_FILE_INVALID',
      'The complete saved page, digest or project binding is invalid; preserve the file for inspection',
      { trace_id: trace, retryable: false, dispatch_state: 'not-sent' },
    );
  }
}
export async function prepareSyncPageOutput(path: string, trace: string) {
  try {
    return await prepareArtifactOutput(path, trace);
  } catch {
    throw new ContractError(
      'SYNC_PAGE_OUTPUT_UNAVAILABLE',
      'Choose a new page file in an existing directory; existing files and links are never replaced',
      { trace_id: trace, retryable: false, acknowledgement_dispatch_state: 'not-sent' },
    );
  }
}
function summary(saved: SyncSavedPageFile, trace: string) {
  const document = saved.document;
  const identity = document.expected_identity;
  return {
    schema_version: 1 as const,
    trace_id: trace,
    source_refs: [],
    scope: {
      tenant_id: identity.tenant_id,
      workspace_id: identity.workspace_id,
      project_id: identity.project_id,
    },
    data: {
      document_sha256: saved.document_sha256,
      previous_page_sha256: document.previous_page_sha256,
      page_trace_id: document.page.trace_id,
      expected_identity: identity,
      from_cursor: document.query.cursor,
      next_cursor: document.page.data.next_cursor,
      has_more: document.page.data.has_more,
      event_count: document.page.data.changes.length,
      acknowledgement: { expected_identity: identity, cursor: document.page.data.next_cursor },
      continuation: {
        expected_identity: identity,
        cursor: document.page.data.next_cursor,
        limit: document.query.limit,
      },
      event_application: 'not-verified' as const,
      acknowledgement_dispatch_state: 'not-sent' as const,
    },
  };
}

export async function saveSyncPage(
  value: unknown,
  identity: SyncCommandIdentity,
  query: SyncChangesQuery,
  previous_page_sha256: string | null,
  output: ArtifactOutput,
  trace: string,
) {
  let saved: SyncSavedPageFile;
  try {
    const document = parseSyncSavedPageDocument({
      schema_version: 1,
      kind: 'workctx.sync-page',
      expected_identity: identity,
      query: { cursor: query.cursor, limit: query.limit ?? 100 },
      previous_page_sha256,
      page: parseSyncChangesEnvelope(value, query, identity, trace),
    });
    saved = { document, document_sha256: hash(syncSavedPageDocumentJson(document)) };
  } catch {
    throw new ContractError(
      'SYNC_PAGE_INVALID',
      'The complete page could not be represented as a saved file',
      {
        trace_id: trace,
        retryable: false,
        acknowledgement_dispatch_state: 'not-sent',
      },
    );
  }
  return saveSyncPageArchive(saved, output, trace);
}

/** Re-export a stored page without replacing its original download trace or digest. */
export async function saveSyncPageArchive(value: unknown, output: ArtifactOutput, trace: string) {
  const destination = { ...output };
  let saved: SyncSavedPageFile;
  let bytes: Uint8Array;
  try {
    saved = parseSyncSavedPageFile(value);
    if (hash(syncSavedPageDocumentJson(saved.document)) !== saved.document_sha256)
      throw new TypeError();
    bytes = new TextEncoder().encode(syncJsonSnapshot(saved, SYNC_SAVED_PAGE_FILE_BYTES));
  } catch {
    throw new ContractError(
      'SYNC_PAGE_INVALID',
      'The complete stored page or document digest is invalid',
      {
        trace_id: trace,
        retryable: false,
        acknowledgement_dispatch_state: 'not-sent',
      },
    );
  }
  let local;
  try {
    local = await saveArtifactOutput(destination, bytes, hash(bytes), trace);
  } catch (error) {
    throw new ContractError(
      'SYNC_PAGE_SAVE_FAILED',
      'The page file could not be saved completely; inspect reported paths before downloading again',
      {
        trace_id: trace,
        retryable: false,
        details: {
          ...(error instanceof ContractError
            ? error.envelope.details
            : { output_path: destination.path }),
          acknowledgement_dispatch_state: 'not-sent',
        },
      },
    );
  }
  try {
    const stored = await readSyncPageFile(local.path, trace, saved.document.expected_identity);
    if (
      stored.file_bytes !== bytes.byteLength ||
      stored.file_sha256 !== hash(bytes) ||
      stored.document_sha256 !== saved.document_sha256 ||
      syncSavedPageDocumentJson(stored.document) !== syncSavedPageDocumentJson(saved.document)
    )
      throw new TypeError();
  } catch {
    throw new ContractError(
      'SYNC_PAGE_READBACK_FAILED',
      'The page file was created but final contents could not be confirmed; keep it for inspection',
      {
        trace_id: trace,
        retryable: false,
        details: {
          local_state: 'published-unconfirmed',
          output_path: local.path,
          cleanup_pending: local.cleanup_pending,
          ...(local.temporary_path === undefined ? {} : { temporary_path: local.temporary_path }),
          acknowledgement_dispatch_state: 'not-sent',
        },
      },
    );
  }
  const result = summary(saved, trace);
  return {
    ...result,
    data: {
      ...result.data,
      local: { ...local, file_bytes: bytes.byteLength, file_sha256: hash(bytes) },
    },
  };
}

/** Local inspection needs neither an access token nor a router call. */
export async function inspectSyncPageArguments(argv: string[], trace: string) {
  let file: string;
  try {
    const args = parseArgs({
      args: [...argv],
      allowPositionals: true,
      tokens: true,
      options: { 'page-file': { type: 'string' } },
    });
    const path = args.values['page-file'];
    if (
      args.positionals.join(' ') !== 'sync inspect' ||
      args.positionals.length !== 2 ||
      args.tokens.filter((token) => token.kind === 'option').length !== 1 ||
      !path?.trim() ||
      path === '-'
    )
      throw new TypeError();
    file = path;
  } catch {
    throw new ContractError(
      'USAGE_ERROR',
      'Use sync inspect --page-file SAVED_PAGE.json; no other options or stdin',
      {
        trace_id: trace,
        retryable: false,
      },
    );
  }
  const saved = await readSyncPageFile(file, trace);
  const result = summary(saved, trace);
  return {
    ...result,
    data: {
      ...result.data,
      local: {
        state: 'read-and-verified' as const,
        path: file,
        file_bytes: saved.file_bytes,
        file_sha256: saved.file_sha256,
      },
    },
  };
}
