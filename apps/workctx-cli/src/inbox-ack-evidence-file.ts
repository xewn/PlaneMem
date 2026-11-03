import { createHash } from 'node:crypto';
import { parseArgs } from 'node:util';
import {
  ContractError,
  parseSyncAckEvidenceDocument,
  parseSyncAckEvidenceFile,
  syncAckEvidenceDocumentJson,
  syncSavedPageDocumentJson,
  syncJsonSnapshot,
  SYNC_ACK_EVIDENCE_FILE_BYTES,
  type SyncAckEvidenceFile,
} from '@planemem/contracts';
import { readBoundedArtifactFile } from './artifact-files.js';
import {
  prepareArtifactOutput,
  saveArtifactOutput,
  type ArtifactOutput,
} from './artifact-output.js';
import { prepareSyncPageOutput, saveSyncPageArchive } from './sync-page-file.js';

export function isInboxAckEvidenceCommand(command: string) {
  return command === 'inbox ack-evidence-inspect' || command === 'inbox ack-evidence-page';
}

const hash = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');
function verify(value: unknown): SyncAckEvidenceFile {
  const saved = parseSyncAckEvidenceFile(value);
  if (
    hash(syncSavedPageDocumentJson(saved.document.page.document)) !==
      saved.document.page.document_sha256 ||
    hash(syncAckEvidenceDocumentJson(saved.document)) !== saved.document_sha256
  )
    throw new TypeError('Evidence archive digest mismatch');
  return saved;
}
export async function readSyncAckEvidenceFile(path: string, trace: string) {
  let bytes: Uint8Array;
  try {
    if (!path.trim() || path === '-') throw new TypeError();
    bytes = await readBoundedArtifactFile(path, SYNC_ACK_EVIDENCE_FILE_BYTES, trace);
  } catch {
    throw new ContractError(
      'INBOX_ACK_EVIDENCE_FILE_UNAVAILABLE',
      'Read a stable regular acknowledgement evidence file within its size limit',
      { trace_id: trace, retryable: false, acknowledgement_dispatch_state: 'not-sent' },
    );
  }
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^\uFEFF/, '');
    const saved = verify(JSON.parse(text));
    return { ...saved, file_bytes: bytes.byteLength, file_sha256: hash(bytes) };
  } catch {
    throw new ContractError(
      'INBOX_ACK_EVIDENCE_FILE_INVALID',
      'The complete original page, record, dispatch or digest is inconsistent; preserve the file for inspection',
      { trace_id: trace, retryable: false, acknowledgement_dispatch_state: 'not-sent' },
    );
  }
}
export async function prepareSyncAckEvidenceOutput(path: string, trace: string) {
  try {
    return await prepareArtifactOutput(path, trace);
  } catch {
    throw new ContractError(
      'INBOX_ACK_EVIDENCE_OUTPUT_UNAVAILABLE',
      'Choose a new evidence file in an existing directory; existing files and links are never replaced',
      { trace_id: trace, retryable: false, acknowledgement_dispatch_state: 'not-sent' },
    );
  }
}
function summary(saved: SyncAckEvidenceFile, trace: string) {
  const document = saved.document;
  const page = document.page.document;
  const identity = page.expected_identity;
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
      archive_version: document.schema_version,
      document_sha256: saved.document_sha256,
      expected_identity: identity,
      record: document.record,
      dispatch: document.dispatch,
      recovery: document.schema_version === 2 ? document.recovery : null,
      recovery_provenance:
        document.schema_version === 2 ? ('included' as const) : ('not-included' as const),
      page: {
        document_sha256: document.page.document_sha256,
        page_trace_id: page.page.trace_id,
        from_cursor: page.query.cursor,
        next_cursor: page.page.data.next_cursor,
        event_count: page.page.data.changes.length,
        previous_page_sha256: page.previous_page_sha256,
      },
      provenance: 'local-archive-not-authenticated' as const,
      current_server_state: 'not-queried' as const,
      event_application: 'not-verified' as const,
      acknowledgement_dispatch_state: 'not-sent' as const,
    },
  };
}
/** Save one complete local read snapshot; this never imports or settles a journal record. */
export async function saveSyncAckEvidence(value: unknown, output: ArtifactOutput, trace: string) {
  const destination = { ...output };
  let saved: SyncAckEvidenceFile;
  let bytes: Uint8Array;
  try {
    const document = parseSyncAckEvidenceDocument(value);
    saved = verify({ document, document_sha256: hash(syncAckEvidenceDocumentJson(document)) });
    bytes = new TextEncoder().encode(syncJsonSnapshot(saved, SYNC_ACK_EVIDENCE_FILE_BYTES));
  } catch {
    throw new ContractError(
      'INBOX_ACK_EVIDENCE_INVALID',
      'The complete original evidence could not be represented consistently',
      { trace_id: trace, retryable: false, acknowledgement_dispatch_state: 'not-sent' },
    );
  }
  let local;
  try {
    local = await saveArtifactOutput(destination, bytes, hash(bytes), trace);
  } catch (error) {
    throw new ContractError(
      'INBOX_ACK_EVIDENCE_FILE_SAVE_FAILED',
      'The evidence file could not be saved completely; inspect reported paths before repeating the export',
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
    const stored = await readSyncAckEvidenceFile(local.path, trace);
    if (
      stored.file_bytes !== bytes.byteLength ||
      stored.file_sha256 !== hash(bytes) ||
      stored.document_sha256 !== saved.document_sha256 ||
      syncAckEvidenceDocumentJson(stored.document) !== syncAckEvidenceDocumentJson(saved.document)
    )
      throw new TypeError();
  } catch {
    throw new ContractError(
      'INBOX_ACK_EVIDENCE_READBACK_FAILED',
      'The evidence file was created but its final contents could not be confirmed; retain it for inspection',
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
/** Offline inspection: no inbox open, account lookup or gateway call. */
export async function runSyncAckEvidenceArguments(argv: string[], trace: string) {
  let file: string;
  let output: string | undefined;
  try {
    const args = parseArgs({
      args: [...argv],
      allowPositionals: true,
      tokens: true,
      options: { 'evidence-file': { type: 'string' }, output: { type: 'string' } },
    });
    const path = args.values['evidence-file'];
    const command = args.positionals.join(' ');
    output = args.values.output;
    if (
      args.positionals.length !== 2 ||
      !isInboxAckEvidenceCommand(command) ||
      args.tokens.filter((token) => token.kind === 'option').length !==
        (command === 'inbox ack-evidence-page' ? 2 : 1) ||
      (command === 'inbox ack-evidence-page'
        ? !output?.trim() || output === '-'
        : output !== undefined) ||
      !path?.trim() ||
      path === '-'
    )
      throw new TypeError();
    file = path;
  } catch {
    throw new ContractError(
      'USAGE_ERROR',
      'Use inbox ack-evidence-inspect --evidence-file SAVED.json or inbox ack-evidence-page --evidence-file SAVED.json --output NEW_PAGE.json; no other options, repeated options or stdin',
      { trace_id: trace, retryable: false, acknowledgement_dispatch_state: 'not-sent' },
    );
  }
  const saved = await readSyncAckEvidenceFile(file, trace);
  if (output !== undefined) {
    const destination = await prepareSyncPageOutput(output, trace);
    const result = await saveSyncPageArchive(saved.document.page, destination, trace);
    return {
      ...result,
      data: {
        ...result.data,
        source_evidence_document_sha256: saved.document_sha256,
        source_evidence_version: saved.document.schema_version,
        provenance: 'local-archive-not-authenticated' as const,
      },
    };
  }
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
