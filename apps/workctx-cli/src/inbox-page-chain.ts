import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import type { SqliteSyncInbox, SyncInboxPageChainAppendQuery } from '@planemem/context-bridge';
import {
  ContractError,
  assertSyncCommandIdentity,
  parseSyncCommandIdentity,
  parseSyncPageChainFile,
  syncJsonSnapshot,
  syncPageChainDocumentJson,
  syncPageChainSummary,
  syncSavedPageDocumentJson,
  SYNC_PAGE_CHAIN_FILE_BYTES,
  type SyncCommandIdentity,
  type SyncPageChainFile,
} from '@planemem/contracts';
import { readBoundedArtifactFile } from './artifact-files.js';
import { saveInboxAppendQuery } from './inbox-append-query-file.js';
import { readArchivePageHistory, readArchivePageByDigest } from './inbox-archive-selection.js';
import { prepareSyncPageOutput, saveSyncPageArchive } from './sync-page-file.js';
import {
  prepareArtifactOutput,
  saveArtifactOutput,
  type ArtifactOutput,
} from './artifact-output.js';

export function isInboxPageChainCommand(command: string) {
  return [
    'inbox export-pages',
    'inbox inspect-pages',
    'inbox archive-history',
    'inbox archive-page',
    'inbox restore-pages',
    'inbox compare-pages',
    'inbox append-pages',
  ].includes(command);
}
const hash = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');
function failure(
  code: string,
  message: string,
  trace: string,
  details: Record<string, unknown> = {},
) {
  return new ContractError(code, message, {
    trace_id: trace,
    retryable: false,
    details: { ...details, acknowledgement_dispatch_state: 'not-sent' },
  });
}
function verify(value: unknown): SyncPageChainFile {
  const saved = parseSyncPageChainFile(value);
  if (hash(syncPageChainDocumentJson(saved.document)) !== saved.document_sha256)
    throw new TypeError();
  for (const page of saved.document.pages)
    if (hash(syncSavedPageDocumentJson(page.document)) !== page.document_sha256)
      throw new TypeError();
  return saved;
}
async function readArchive(path: string, trace: string) {
  let bytes: Uint8Array;
  try {
    bytes = await readBoundedArtifactFile(path, SYNC_PAGE_CHAIN_FILE_BYTES, trace);
  } catch {
    throw failure(
      'INBOX_PAGE_CHAIN_FILE_UNAVAILABLE',
      'Read a stable regular page-chain archive within its file size limit',
      trace,
    );
  }
  try {
    const raw = new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^\uFEFF/, '');
    const saved = verify(JSON.parse(raw));
    return { saved, file_bytes: bytes.byteLength, file_sha256: hash(bytes) };
  } catch {
    throw failure(
      'INBOX_PAGE_CHAIN_FILE_INVALID',
      'The archive, complete page chain or one of its digests is invalid; preserve the original file',
      trace,
    );
  }
}
function envelope(saved: SyncPageChainFile, trace: string) {
  const identity = saved.document.expected_identity;
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
      ...syncPageChainSummary(saved.document),
      document_sha256: saved.document_sha256,
      acknowledgement_dispatch_state: 'not-sent' as const,
    },
  };
}
async function saveArchive(value: unknown, output: ArtifactOutput, trace: string) {
  const destination = { ...output };
  let saved: SyncPageChainFile;
  let bytes: Uint8Array;
  try {
    saved = verify(value);
    bytes = new TextEncoder().encode(syncJsonSnapshot(saved, SYNC_PAGE_CHAIN_FILE_BYTES));
  } catch {
    throw failure(
      'INBOX_PAGE_CHAIN_INVALID',
      'The complete archive cannot be represented within the page-chain format limits',
      trace,
    );
  }
  const file_sha256 = hash(bytes);
  let local;
  try {
    local = await saveArtifactOutput(destination, bytes, file_sha256, trace);
  } catch (error) {
    throw failure(
      'INBOX_PAGE_CHAIN_SAVE_FAILED',
      'The archive could not be saved completely; inspect the reported paths before exporting again',
      trace,
      error instanceof ContractError ? error.envelope.details : { output_path: destination.path },
    );
  }
  try {
    const stored = await readArchive(local.path, trace);
    if (
      stored.file_bytes !== bytes.byteLength ||
      stored.file_sha256 !== file_sha256 ||
      stored.saved.document_sha256 !== saved.document_sha256
    )
      throw new TypeError();
  } catch {
    throw failure(
      'INBOX_PAGE_CHAIN_READBACK_FAILED',
      'The archive was created but its final contents could not be confirmed; retain it for inspection',
      trace,
      {
        local_state: 'published-unconfirmed',
        output_path: local.path,
        cleanup_pending: local.cleanup_pending,
        ...(local.temporary_path === undefined ? {} : { temporary_path: local.temporary_path }),
      },
    );
  }
  const result = envelope(saved, trace);
  return {
    ...result,
    data: { ...result.data, local: { ...local, file_bytes: bytes.byteLength, file_sha256 } },
  };
}
function argumentsFor(argv: string[], trace: string) {
  try {
    const args = parseArgs({
      args: [...argv],
      tokens: true,
      allowPositionals: true,
      options: {
        inbox: { type: 'string' },
        'archive-file': { type: 'string' },
        json: { type: 'string' },
        'json-file': { type: 'string' },
        output: { type: 'string' },
      },
    });
    const command = args.positionals.join(' ');
    const { inbox, json, output } = args.values;
    const file = args.values['archive-file'];
    const jsonFile = args.values['json-file'];
    const seen = new Set<string>();
    for (const token of args.tokens) {
      if (token.kind !== 'option') continue;
      if (seen.has(token.name)) throw new TypeError();
      seen.add(token.name);
    }
    if (
      !isInboxPageChainCommand(command) ||
      args.positionals.length !== 2 ||
      [inbox, file, jsonFile, output].some(
        (path) => path !== undefined && (!path.trim() || path === '-'),
      ) ||
      inbox === ':memory:' ||
      json === '-'
    )
      throw new TypeError();
    if (command === 'inbox export-pages') {
      if (
        !inbox ||
        !output ||
        file !== undefined ||
        (json === undefined) === (jsonFile === undefined)
      )
        throw new TypeError();
    } else if (command === 'inbox append-pages') {
      if (
        !inbox ||
        !file ||
        output !== undefined ||
        (json === undefined) === (jsonFile === undefined)
      )
        throw new TypeError();
    } else if (command === 'inbox archive-history' || command === 'inbox archive-page') {
      if (
        !file ||
        inbox !== undefined ||
        (json === undefined) === (jsonFile === undefined) ||
        (command === 'inbox archive-history' && output !== undefined)
      )
        throw new TypeError();
    } else if (command === 'inbox compare-pages') {
      if (!inbox || !file || json !== undefined || jsonFile !== undefined) throw new TypeError();
    } else {
      if (!file || json !== undefined || jsonFile !== undefined || output !== undefined)
        throw new TypeError();
      if (command === 'inbox inspect-pages' ? inbox !== undefined : !inbox) throw new TypeError();
    }
    return {
      command,
      inbox: inbox === undefined ? undefined : resolve(inbox),
      file,
      json,
      jsonFile,
      output,
    };
  } catch {
    throw failure(
      'USAGE_ERROR',
      'Use inbox export-pages with inbox, identity JSON and new output; inspect-pages with archive-file; archive-history/archive-page with archive-file and selection JSON (archive-page optionally exports a new output); restore-pages/compare-pages with inbox and archive-file (compare-pages optionally saves a new query output); append-pages with inbox, archive-file and exact append_query JSON. Queries use --json or --json-file. No stdin, repeated or other options',
      trace,
    );
  }
}
async function readQuery(args: ReturnType<typeof argumentsFor>, trace: string): Promise<unknown> {
  let raw = args.json;
  if (args.jsonFile !== undefined) {
    try {
      const bytes = await readBoundedArtifactFile(args.jsonFile, 16384, trace);
      raw = new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^\uFEFF/, '');
    } catch {
      throw failure(
        'INBOX_PAGE_CHAIN_QUERY_UNAVAILABLE',
        'Read a stable regular UTF-8 page-chain query within 16 KiB',
        trace,
      );
    }
  }
  try {
    if (raw === undefined || Buffer.byteLength(raw, 'utf8') > 16384) throw new TypeError();
    return JSON.parse(raw);
  } catch {
    throw failure(
      'INBOX_PAGE_CHAIN_QUERY_INVALID',
      'Supply a valid page-chain JSON query within 16 KiB',
      trace,
    );
  }
}
async function readIdentity(args: ReturnType<typeof argumentsFor>, trace: string) {
  const query = await readQuery(args, trace);
  try {
    if (
      !query ||
      typeof query !== 'object' ||
      Array.isArray(query) ||
      Object.keys(query).length !== 1 ||
      !Object.hasOwn(query, 'expected_identity')
    )
      throw new TypeError();
    return parseSyncCommandIdentity((query as Record<string, unknown>).expected_identity);
  } catch {
    throw failure(
      'INBOX_PAGE_CHAIN_QUERY_INVALID',
      'Supply only the complete original expected_identity in the export query',
      trace,
    );
  }
}
/** Explicit local archive operations: no gateway, current account or implicit inbox creation. */
export async function runInboxPageChainArguments(argv: string[], trace: string) {
  const args = argumentsFor(argv, trace);
  const input = args.file === undefined ? undefined : await readArchive(args.file, trace);
  if (args.command === 'inbox inspect-pages' && input) {
    const result = envelope(input.saved, trace);
    return {
      ...result,
      data: {
        ...result.data,
        local: {
          state: 'read-and-verified',
          path: resolve(args.file!),
          file_bytes: input.file_bytes,
          file_sha256: input.file_sha256,
        },
      },
    };
  }
  if (
    input &&
    (args.command === 'inbox archive-history' || args.command === 'inbox archive-page')
  ) {
    const query = await readQuery(args, trace);
    const selected =
      args.command === 'inbox archive-history'
        ? readArchivePageHistory(input.saved, query, trace)
        : readArchivePageByDigest(input.saved, query, trace);
    const source = {
      source_archive_document_sha256: input.saved.document_sha256,
      source_file_sha256: input.file_sha256,
      source_file_bytes: input.file_bytes,
      source_archive_path: resolve(args.file!),
    };
    if (args.output !== undefined && selected.kind === 'archive-page') {
      if (!selected.page || selected.sequence === null)
        throw failure(
          'INBOX_ARCHIVE_PAGE_NOT_FOUND',
          'The selected page is absent from this archive; no file was produced',
          trace,
          { ...source, selected_document_sha256: selected.document_sha256 },
        );
      try {
        const destination = await prepareSyncPageOutput(args.output, trace);
        const saved = await saveSyncPageArchive(selected.page, destination, trace);
        return {
          ...saved,
          data: {
            ...saved.data,
            ...source,
            selected_sequence: selected.sequence,
            provenance: 'local-archive-not-authenticated' as const,
          },
        };
      } catch (error) {
        if (!(error instanceof ContractError)) throw error;
        throw failure(error.envelope.code, error.envelope.message, trace, {
          ...error.envelope.details,
          ...source,
          selected_sequence: selected.sequence,
          selected_document_sha256: selected.document_sha256,
        });
      }
    }
    const result = envelope(input.saved, trace);
    return {
      ...result,
      data: {
        ...selected,
        ...source,
        archive_summary: syncPageChainSummary(input.saved.document),
        acknowledgement_dispatch_state: 'not-sent' as const,
        event_application: 'not-verified' as const,
        provenance: 'local-archive-not-authenticated' as const,
      },
    };
  }
  let identity: SyncCommandIdentity | undefined;
  const appendInput =
    args.command === 'inbox append-pages' ? await readQuery(args, trace) : undefined;
  let appendQuery: SyncInboxPageChainAppendQuery | undefined;
  let output: ArtifactOutput | undefined;
  if (args.command === 'inbox export-pages') identity = await readIdentity(args, trace);
  if (args.output !== undefined) {
    try {
      output = await prepareArtifactOutput(args.output!, trace);
    } catch {
      throw failure(
        args.command === 'inbox compare-pages'
          ? 'INBOX_PAGE_CHAIN_APPEND_QUERY_OUTPUT_UNAVAILABLE'
          : 'INBOX_PAGE_CHAIN_OUTPUT_UNAVAILABLE',
        'Choose a new output path in an existing directory; existing files and links are never replaced',
        trace,
      );
    }
  }
  let inbox: SqliteSyncInbox;
  try {
    const bridge = await import('@planemem/context-bridge');
    if (args.command === 'inbox append-pages') {
      appendQuery = bridge.parseInboxPageChainAppendQuery(appendInput, trace);
      try {
        if (!input || input.saved.document_sha256 !== appendQuery.archive_document_sha256)
          throw new TypeError();
        assertSyncCommandIdentity(
          input.saved.document.expected_identity,
          appendQuery.expected_identity,
        );
      } catch {
        throw failure(
          'INBOX_PAGE_CHAIN_APPEND_INPUT_MISMATCH',
          'The archive differs from the original identity or digest selected for append',
          trace,
        );
      }
    }
    inbox = new bridge.SqliteSyncInbox(args.inbox!, {
      readonly: args.command === 'inbox export-pages' || args.command === 'inbox compare-pages',
      trace_id: trace,
    });
  } catch (error) {
    if (error instanceof ContractError) throw error;
    throw failure(
      'INBOX_STORAGE_UNAVAILABLE',
      'The existing local inbox could not be opened',
      trace,
    );
  }
  let archive: SyncPageChainFile | undefined;
  let restored:
    | ReturnType<SqliteSyncInbox['restorePageChainArchive']>
    | ReturnType<SqliteSyncInbox['appendPageChainArchive']>
    | undefined;
  let comparison: ReturnType<SqliteSyncInbox['comparePageChainArchive']> | undefined;
  try {
    if (identity) archive = inbox.readPageChainArchive(identity, trace);
    else if (input && appendQuery)
      restored = inbox.appendPageChainArchive(input.saved, appendQuery, trace);
    else if (input && args.command === 'inbox compare-pages')
      comparison = inbox.comparePageChainArchive(input.saved, trace);
    else if (input) restored = inbox.restorePageChainArchive(input.saved, trace);
  } catch (error) {
    let close_pending = false;
    try {
      inbox.close();
    } catch {
      close_pending = true;
    }
    if (error instanceof ContractError)
      throw failure(error.envelope.code, error.envelope.message, trace, {
        ...error.envelope.details,
        inbox: args.inbox,
        close_pending,
      });
    throw error;
  }
  let close_pending = false;
  try {
    inbox.close();
  } catch {
    close_pending = true;
  }
  if (archive && output) {
    try {
      const saved = await saveArchive(archive, output, trace);
      return { ...saved, close_pending, data: { ...saved.data, inbox: args.inbox } };
    } catch (error) {
      if (!(error instanceof ContractError)) throw error;
      throw failure(error.envelope.code, error.envelope.message, trace, {
        ...error.envelope.details,
        inbox: args.inbox,
        close_pending,
      });
    }
  }
  if (comparison && input) {
    const result = envelope(input.saved, trace);
    let appendQueryFile;
    if (output) {
      if (!comparison.append_allowed || !comparison.append_query)
        throw failure(
          'INBOX_PAGE_CHAIN_NOT_APPENDABLE',
          'The compared chains are incompatible with append; no query file was created',
          trace,
          {
            comparison,
            inbox: args.inbox,
            source_file_sha256: input.file_sha256,
            output_path: output.path,
            local_state: 'not-saved',
            close_pending,
          },
        );
      try {
        appendQueryFile = await saveInboxAppendQuery(comparison.append_query, output, trace);
      } catch (error) {
        throw failure(
          error instanceof ContractError
            ? error.envelope.code
            : 'INBOX_PAGE_CHAIN_APPEND_QUERY_SAVE_FAILED',
          error instanceof ContractError
            ? error.envelope.message
            : 'The selected append query could not be saved completely',
          trace,
          {
            ...(error instanceof ContractError
              ? error.envelope.details
              : { output_path: output.path }),
            comparison,
            inbox: args.inbox,
            source_file_sha256: input.file_sha256,
            close_pending,
          },
        );
      }
    }
    return {
      ...result,
      close_pending,
      data: {
        ...result.data,
        ...comparison,
        ...(appendQueryFile === undefined ? {} : { append_query_file: appendQueryFile }),
        inbox: args.inbox,
        source_file_sha256: input.file_sha256,
      },
    };
  }
  if (!restored || !input)
    throw failure(
      'INBOX_PAGE_CHAIN_INVALID',
      'The archive operation did not produce a complete result',
      trace,
    );
  const result = envelope(input.saved, trace);
  return {
    ...result,
    close_pending,
    data: {
      ...result.data,
      ...restored,
      inbox: args.inbox,
      local_commit_state: 'committed',
      acknowledgement_journal_update: 'not-performed',
      source_file_sha256: input.file_sha256,
    },
  };
}
