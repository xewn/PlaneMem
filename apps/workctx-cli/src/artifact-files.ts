import { constants } from 'node:fs';
import { open, stat } from 'node:fs/promises';
import { ContractError } from '@planemem/contracts';

function usage(message: string, trace: string): ContractError {
  return new ContractError('USAGE_ERROR', message, { trace_id: trace, dispatch_state: 'not-sent' });
}
export async function readBoundedArtifactFile(
  path: string,
  maximum: number,
  trace: string,
  expected?: number,
): Promise<Uint8Array> {
  let handle;
  try {
    if (!(await stat(path)).isFile()) throw usage('Artifact inputs must be regular files', trace);
    // Nonblocking open lets us reject a FIFO/device by its actual handle instead of waiting for data.
    handle = await open(path, constants.O_RDONLY | (constants.O_NONBLOCK ?? 0));
    const before = await handle.stat();
    if (
      !before.isFile() ||
      !Number.isSafeInteger(before.size) ||
      before.size < 0 ||
      before.size > maximum ||
      (expected !== undefined && before.size !== expected)
    )
      throw usage(
        'Artifact inputs must be regular files within the size limit and match the expected length when supplied',
        trace,
      );
    const bytes = new Uint8Array(before.size);
    let offset = 0;
    while (offset < bytes.byteLength) {
      const { bytesRead } = await handle.read(
        bytes,
        offset,
        Math.min(64 * 1024, bytes.byteLength - offset),
        offset,
      );
      if (bytesRead === 0)
        throw usage('Artifact input changed while being read; no request was sent', trace);
      offset += bytesRead;
    }
    const extra = await handle.read(new Uint8Array(1), 0, 1, offset);
    const after = await handle.stat();
    if (
      extra.bytesRead !== 0 ||
      after.size !== before.size ||
      after.mtimeMs !== before.mtimeMs ||
      after.ctimeMs !== before.ctimeMs
    )
      throw usage('Artifact input changed while being read; no request was sent', trace);
    return bytes;
  } catch (error) {
    if (error instanceof ContractError) throw error;
    throw new ContractError(
      'ARTIFACT_FILE_UNAVAILABLE',
      'Could not read an artifact input file; no request was sent',
      {
        trace_id: trace,
        dispatch_state: 'not-sent',
      },
    );
  } finally {
    try {
      await handle?.close();
    } catch {
      throw new ContractError(
        'ARTIFACT_FILE_UNAVAILABLE',
        'Could not finish reading an artifact input file; no request was sent',
        {
          trace_id: trace,
          dispatch_state: 'not-sent',
        },
      );
    }
  }
}
