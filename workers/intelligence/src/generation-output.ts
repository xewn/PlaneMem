import { randomUUID } from 'node:crypto';
import { link, lstat, open, realpath, stat, unlink, type FileHandle } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import {
  ContractError,
  parseCreateProposal,
  type CreateProposalRequest,
} from '@planemem/contracts';
import { parseProposalGenerationRequest, type ProposalGenerationRequest } from './generation.js';
import {
  inspectProposalGenerationRecord,
  PROPOSAL_GENERATION_RECORD_BYTES,
} from './generation-record.js';

interface Output {
  path: string;
  directory: string;
}
export async function prepareGenerationOutput(value: string): Promise<Output> {
  try {
    if (!value.trim() || value === '-' || /[\u0000-\u001f]/.test(value) || /[\\/]$/.test(value))
      throw new TypeError();
    const absolute = resolve(value);
    const name = basename(absolute);
    if (
      !name ||
      (process.platform === 'win32' &&
        (/[<>:"|?*]/.test(name) ||
          /[. ]$/.test(name) ||
          /^(con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i.test(name)))
    )
      throw new TypeError();
    const directory = await realpath(dirname(absolute));
    if (!(await stat(directory)).isDirectory()) throw new TypeError();
    const path = join(directory, name);
    try {
      await lstat(path);
      throw new TypeError();
    } catch (error) {
      if (!error || typeof error !== 'object' || !('code' in error) || error.code !== 'ENOENT')
        throw error;
    }
    return Object.freeze({ path, directory });
  } catch {
    throw new ContractError(
      'PROPOSAL_GENERATION_OUTPUT_UNAVAILABLE',
      'Choose a new file in an existing directory',
    );
  }
}

/** Publish a complete new draft without replacing an existing path. No queue is opened. */
export async function saveGeneratedDraft(
  output: Output,
  draft: CreateProposalRequest,
  trace: string,
) {
  const bytes = Buffer.from(JSON.stringify(parseCreateProposal(draft), null, 2) + '\n', 'utf8');
  return saveGenerationFile(output, bytes, 1024 * 1024, trace, 'PROPOSAL_GENERATION_SAVE_FAILED');
}

/** Save the complete prepared input for the separate generate command. */
export async function savePreparedGeneration(
  output: Output,
  input: ProposalGenerationRequest,
  trace: string,
) {
  const bytes = Buffer.from(
    JSON.stringify(parseProposalGenerationRequest(input), null, 2) + '\n',
    'utf8',
  );
  return saveGenerationFile(
    output,
    bytes,
    512 * 1024,
    trace,
    'PROPOSAL_SOURCE_PREPARATION_SAVE_FAILED',
  );
}

/** Save a fully inspected record as a new file; never replace an existing destination. */
export async function saveProposalGenerationRecord(output: Output, value: unknown) {
  const record = inspectProposalGenerationRecord(value);
  const trace =
    record.kind === 'proposal-preparation'
      ? record.preparation.trace_id
      : record.generation.trace_id;
  return saveGenerationFile(
    output,
    Buffer.from(JSON.stringify(record, null, 2) + '\n', 'utf8'),
    PROPOSAL_GENERATION_RECORD_BYTES,
    trace,
    'PROPOSAL_GENERATION_RECORD_SAVE_FAILED',
  );
}

async function saveGenerationFile(
  output: Output,
  bytes: Buffer,
  maximum: number,
  trace: string,
  code: string,
) {
  const temporary = join(output.directory, '.proposal-' + randomUUID() + '.part');
  let writer: FileHandle | undefined;
  let reader: FileHandle | undefined;
  let created = false;
  let published = false;
  let phase = 'create';
  try {
    if (bytes.byteLength > maximum) throw new TypeError();
    writer = await open(temporary, 'wx+', 0o600);
    created = true;
    const identity = await writer.stat({ bigint: true });
    if (!identity.isFile()) throw new TypeError();
    phase = 'write';
    await writer.writeFile(bytes);
    await writer.sync();
    phase = 'readback';
    const verify = async (handle: FileHandle) => {
      const metadata = await handle.stat({ bigint: true });
      if (
        !metadata.isFile() ||
        metadata.dev !== identity.dev ||
        metadata.ino !== identity.ino ||
        metadata.size !== BigInt(bytes.byteLength)
      )
        throw new TypeError();
      const actual = Buffer.alloc(bytes.byteLength + 1);
      let offset = 0;
      while (offset < actual.byteLength) {
        const { bytesRead } = await handle.read(actual, offset, actual.byteLength - offset, offset);
        if (!bytesRead) break;
        offset += bytesRead;
      }
      if (offset !== bytes.byteLength || !actual.subarray(0, offset).equals(bytes))
        throw new TypeError();
    };
    await verify(writer);
    await writer.close();
    writer = undefined;
    const current = await lstat(temporary, { bigint: true });
    if (!current.isFile() || current.dev !== identity.dev || current.ino !== identity.ino)
      throw new TypeError();
    phase = 'publish';
    await link(temporary, output.path);
    published = true;
    phase = 'verify-published';
    reader = await open(output.path, 'r');
    await verify(reader);
    await reader.close();
    reader = undefined;
    let cleanupPending = true;
    try {
      const remaining = await lstat(temporary, { bigint: true });
      if (remaining.isFile() && remaining.dev === identity.dev && remaining.ino === identity.ino) {
        await unlink(temporary);
        cleanupPending = false;
      }
    } catch {
      /* The complete published file is retained; report the temporary path. */
    }
    return {
      state: 'saved' as const,
      path: output.path,
      cleanup_pending: cleanupPending,
      ...(cleanupPending ? { temporary_path: temporary } : {}),
    };
  } catch {
    throw new ContractError(
      code,
      'File saving was not confirmed; retain the returned content before retrying',
      {
        trace_id: trace,
        output_path: output.path,
        save_phase: phase,
        publication: published ? 'linked-but-not-verified' : 'not-confirmed',
        ...(created ? { temporary_path: temporary } : {}),
      },
    );
  } finally {
    try {
      await reader?.close();
    } catch {
      /* Preserve recovery details. */
    }
    try {
      await writer?.close();
    } catch {
      /* Preserve recovery details. */
    }
  }
}
