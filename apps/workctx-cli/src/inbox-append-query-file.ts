import { createHash } from 'node:crypto';
import { ContractError, syncJsonSnapshot } from '@planemem/contracts';
import { readBoundedArtifactFile } from './artifact-files.js';
import { saveArtifactOutput, type ArtifactOutput } from './artifact-output.js';

const hash = (value: Uint8Array) => createHash('sha256').update(value).digest('hex');
/** Save the selected query unchanged; never refresh the inbox or append any pages. */
export async function saveInboxAppendQuery(value: unknown, output: ArtifactOutput, trace: string) {
  const destination = { ...output };
  // Keep Bridge loading out of the offline archive inspection path.
  const { parseInboxPageChainAppendQuery } = await import('@planemem/context-bridge');
  const query = parseInboxPageChainAppendQuery(value, trace);
  const raw = syncJsonSnapshot(query, 16384);
  const bytes = new TextEncoder().encode(raw);
  const file_sha256 = hash(bytes);
  let local;
  try {
    local = await saveArtifactOutput(destination, bytes, file_sha256, trace);
  } catch (error) {
    throw new ContractError(
      'INBOX_PAGE_CHAIN_APPEND_QUERY_SAVE_FAILED',
      'The selected append query could not be saved completely; inspect reported paths before saving another query',
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
    const storedBytes = await readBoundedArtifactFile(local.path, 16384, trace, bytes.byteLength);
    if (storedBytes.byteLength !== bytes.byteLength || hash(storedBytes) !== file_sha256)
      throw new TypeError();
    const storedRaw = new TextDecoder('utf-8', { fatal: true }).decode(storedBytes);
    const stored = parseInboxPageChainAppendQuery(JSON.parse(storedRaw), trace);
    if (syncJsonSnapshot(stored, 16384) !== raw) throw new TypeError();
  } catch {
    throw new ContractError(
      'INBOX_PAGE_CHAIN_APPEND_QUERY_READBACK_FAILED',
      'The append query file was created but its final contents could not be confirmed; retain it for inspection',
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
  return { ...local, file_bytes: bytes.byteLength, file_sha256 };
}
