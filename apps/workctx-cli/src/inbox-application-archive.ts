import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import type { SqliteSyncInbox } from '@planemem/context-bridge';
import {
  ContractError,
  syncJsonSnapshot,
  syncApplicationArchiveSummary,
  type SyncApplicationArchiveFile,
} from '@planemem/contracts';
import { readBoundedArtifactFile } from './artifact-files.js';
import { prepareArtifactOutput, type ArtifactOutput } from './artifact-output.js';
import { runInboxApplicationRestore } from './inbox-application-restore.js';
import {
  applicationArchiveFailure as fail,
  readApplicationArchiveFile,
  saveApplicationArchiveFile,
} from './inbox-application-archive-file.js';
import {
  inspectApplicationArchive,
  selectApplicationArchiveSnapshot,
} from './inbox-application-archive-selection.js';

export function isInboxApplicationArchiveCommand(command: string) {
  return [
    'inbox application-export',
    'inbox application-restore',
    'inbox application-restore-preview',
    'inbox application-inspect',
    'inbox application-archive-get',
  ].includes(command);
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
        output: { type: 'string' },
        json: { type: 'string' },
        'json-file': { type: 'string' },
      },
    });
    const command = args.positionals.join(' ');
    const { inbox, output, json } = args.values;
    const file = args.values['archive-file'];
    const jsonFile = args.values['json-file'];
    const seen = new Set<string>();
    for (const token of args.tokens) {
      if (token.kind !== 'option') continue;
      if (seen.has(token.name)) throw new TypeError();
      seen.add(token.name);
    }
    if (
      !isInboxApplicationArchiveCommand(command) ||
      args.positionals.length !== 2 ||
      [inbox, output, file, jsonFile].some(
        (value) => value !== undefined && (!value.trim() || value === '-'),
      ) ||
      inbox === ':memory:' ||
      json === '-' ||
      (json !== undefined && jsonFile !== undefined)
    )
      throw new TypeError();
    if (command === 'inbox application-export') {
      if (!inbox || !output || file !== undefined || (json === undefined && jsonFile === undefined))
        throw new TypeError();
    } else if (
      command === 'inbox application-restore' ||
      command === 'inbox application-restore-preview'
    ) {
      if (!inbox || !file || output !== undefined || (json === undefined && jsonFile === undefined))
        throw new TypeError();
    } else {
      if (
        !file ||
        inbox !== undefined ||
        output !== undefined ||
        (command === 'inbox application-archive-get' &&
          json === undefined &&
          jsonFile === undefined)
      )
        throw new TypeError();
    }
    return {
      command,
      inbox: inbox === undefined ? undefined : resolve(inbox),
      output,
      file,
      json,
      jsonFile,
    };
  } catch {
    throw fail(
      'USAGE_ERROR',
      'Use inbox application-export with --inbox, original application JSON and --output NEW_FILE; application-restore or application-restore-preview with --inbox, --archive-file and original identity/application/archive digest JSON; application-inspect with --archive-file and optional pagination JSON; application-archive-get with --archive-file and exact archive/page digest JSON. Use --json or --json-file; no stdin, repeated or other options',
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
      throw fail(
        'INBOX_APPLICATION_ARCHIVE_QUERY_UNAVAILABLE',
        'Read a stable UTF-8 query file within 16 KiB',
        trace,
      );
    }
  }
  try {
    if (raw === undefined) return {};
    if (Buffer.byteLength(raw, 'utf8') > 16384) throw new TypeError();
    return JSON.parse(raw);
  } catch {
    throw fail(
      'INBOX_APPLICATION_ARCHIVE_QUERY_INVALID',
      'Supply a valid JSON query within 16 KiB',
      trace,
    );
  }
}
function envelope(
  saved: SyncApplicationArchiveFile,
  trace: string,
  extra: Record<string, unknown>,
) {
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
      ...syncApplicationArchiveSummary(saved.document),
      archive_document_sha256: saved.document_sha256,
      acknowledgement_dispatch_state: 'not-sent' as const,
      ...extra,
    },
  };
}
/** Offline branches never import Bridge; export opens only an existing readonly inbox. */
export async function runInboxApplicationArchiveArguments(argv: string[], trace: string) {
  const args = argumentsFor(argv, trace);
  const input = await readQuery(args, trace);
  if (args.command === 'inbox application-restore')
    return runInboxApplicationRestore(args.inbox!, args.file!, input, trace);
  if (args.command === 'inbox application-restore-preview')
    return runInboxApplicationRestore(args.inbox!, args.file!, input, trace, 'preview');
  if (args.file !== undefined) {
    const local = await readApplicationArchiveFile(args.file, trace);
    const selected =
      args.command === 'inbox application-inspect'
        ? inspectApplicationArchive(local.saved, input, trace)
        : selectApplicationArchiveSnapshot(local.saved, input, trace);
    const result = envelope(local.saved, trace, {
      ...selected,
      local: {
        state: 'read-and-verified',
        path: resolve(args.file),
        file_bytes: local.file_bytes,
        file_sha256: local.file_sha256,
      },
    });
    try {
      syncJsonSnapshot(
        result,
        args.command === 'inbox application-inspect' ? 512 * 1024 : 2 * 1024 * 1024,
      );
    } catch {
      throw fail(
        'INBOX_APPLICATION_ARCHIVE_RESPONSE_TOO_LARGE',
        'The complete archive selection response exceeds its limit; reduce the history page size',
        trace,
      );
    }
    return result;
  }
  // Parse the original query and preflight the new destination before opening the existing file.
  let bridge: typeof import('@planemem/context-bridge');
  try {
    bridge = await import('@planemem/context-bridge');
  } catch {
    throw fail('INBOX_STORAGE_UNAVAILABLE', 'The local inbox reader is unavailable', trace);
  }
  const query = bridge.parseInboxApplicationQuery(input, trace);
  let output: ArtifactOutput;
  try {
    output = await prepareArtifactOutput(args.output!, trace);
  } catch {
    throw fail(
      'INBOX_APPLICATION_ARCHIVE_OUTPUT_UNAVAILABLE',
      'Choose a new archive file in an existing directory; existing files and links are never replaced',
      trace,
    );
  }
  let inbox: SqliteSyncInbox;
  try {
    inbox = new bridge.SqliteSyncInbox(args.inbox!, {
      create: false,
      readonly: true,
      trace_id: trace,
    });
  } catch (error) {
    if (error instanceof ContractError) throw error;
    throw fail(
      'INBOX_STORAGE_UNAVAILABLE',
      'The existing inbox could not be opened for reading',
      trace,
    );
  }
  let archive: SyncApplicationArchiveFile;
  try {
    archive = inbox.readApplicationArchive(query, trace);
  } catch (error) {
    let close_pending = false;
    try {
      inbox.close();
    } catch {
      close_pending = true;
    }
    throw fail(
      error instanceof ContractError
        ? error.envelope.code
        : 'INBOX_APPLICATION_ARCHIVE_READ_FAILED',
      error instanceof ContractError
        ? error.envelope.message
        : 'The application archive could not be read',
      trace,
      {
        ...(error instanceof ContractError ? error.envelope.details : {}),
        inbox: args.inbox,
        expected_identity: query.expected_identity,
        application: query.application,
        close_pending,
      },
    );
  }
  let close_pending = false;
  try {
    inbox.close();
  } catch {
    close_pending = true;
  }
  // File publication and readback happen after the read transaction and attempted close.
  try {
    const saved = await saveApplicationArchiveFile(archive, output, trace);
    return {
      ...envelope(saved.saved, trace, {
        inbox: args.inbox,
        local: saved.local,
        inspect_query: { archive_document_sha256: saved.saved.document_sha256 },
      }),
      close_pending,
    };
  } catch (error) {
    throw fail(
      error instanceof ContractError
        ? error.envelope.code
        : 'INBOX_APPLICATION_ARCHIVE_SAVE_FAILED',
      error instanceof ContractError
        ? error.envelope.message
        : 'The application archive could not be saved',
      trace,
      {
        ...(error instanceof ContractError ? error.envelope.details : {}),
        inbox: args.inbox,
        close_pending,
        archive_document_sha256: archive.document_sha256,
        output_path: output.path,
        archive_summary: syncApplicationArchiveSummary(archive.document),
      },
    );
  }
}
