import { ARTIFACT_UPLOAD_MAX_BYTES, ARTIFACT_UPLOAD_REQUEST_BYTES } from '@planemem/contracts';

export class ArtifactTransferLimitError extends TypeError {}

/** Read a complete bounded body; cancellation or a size mismatch never returns partial bytes. */
export async function readArtifactTransferBytes(
  body: ReadableStream<Uint8Array> | null,
  maximum: number,
  signal: AbortSignal,
  expected?: number,
): Promise<Uint8Array> {
  if (
    !Number.isSafeInteger(maximum) ||
    maximum < 0 ||
    maximum > ARTIFACT_UPLOAD_MAX_BYTES + ARTIFACT_UPLOAD_REQUEST_BYTES + 64 * 1024 ||
    (expected !== undefined &&
      (!Number.isSafeInteger(expected) || expected < 0 || expected > maximum))
  )
    throw new TypeError('Invalid file transfer limit');
  if (signal.aborted) throw new Error('File transfer stopped');
  if (!body) {
    if (expected === undefined || expected === 0) return new Uint8Array(0);
    throw new TypeError('Missing file transfer body');
  }
  const reader = body.getReader();
  const cancel = () => {
    void reader.cancel().catch(() => {});
  };
  signal.addEventListener('abort', cancel, { once: true });
  let ended = false;
  try {
    let buffer = new Uint8Array(expected ?? Math.min(maximum, 64 * 1024));
    let offset = 0;
    while (true) {
      if (signal.aborted) throw new Error('File transfer stopped');
      const next = await reader.read();
      if (signal.aborted) throw new Error('File transfer stopped');
      if (next.done) {
        ended = true;
        break;
      }
      if (!(next.value instanceof Uint8Array)) throw new TypeError('Invalid file transfer bytes');
      if (
        next.value.byteLength > maximum - offset ||
        (expected !== undefined && next.value.byteLength > expected - offset)
      )
        throw new ArtifactTransferLimitError('File transfer exceeds its byte limit');
      const required = offset + next.value.byteLength;
      if (required > buffer.byteLength) {
        const larger = new Uint8Array(Math.min(maximum, Math.max(required, buffer.byteLength * 2)));
        larger.set(buffer.subarray(0, offset));
        buffer = larger;
      }
      buffer.set(next.value, offset);
      offset = required;
    }
    if (expected !== undefined && offset !== expected) throw new TypeError('File length differs');
    return offset === buffer.byteLength ? buffer : buffer.slice(0, offset);
  } finally {
    signal.removeEventListener('abort', cancel);
    if (!ended) cancel();
    reader.releaseLock();
  }
}
