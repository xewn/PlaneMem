import type { IncomingMessage } from 'node:http';
import {
  ARTIFACT_UPLOAD_DEFAULT_BYTES,
  ARTIFACT_UPLOAD_MAX_BYTES,
  ARTIFACT_UPLOAD_REQUEST_BYTES,
  ContractError,
  parseArtifactReceiptQuery,
} from '@planemem/contracts';

/** Shared by every request in one server; reservations include parsing and persistence. */
export class ArtifactUploadGate {
  readonly maxBytes: number;
  private active = 0;
  constructor(maxBytes = ARTIFACT_UPLOAD_DEFAULT_BYTES) {
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 0 || maxBytes > ARTIFACT_UPLOAD_MAX_BYTES)
      throw new RangeError('Invalid artifact upload byte limit');
    this.maxBytes = maxBytes;
  }
  acquire(trace: string): () => void {
    if (this.active >= 2)
      throw new ContractError('ARTIFACT_UPLOAD_BUSY', 'Artifact upload capacity is occupied', {
        trace_id: trace,
        retryable: true,
      });
    this.active++;
    let released = false;
    return () => {
      if (!released) {
        released = true;
        this.active--;
      }
    };
  }
}

/** This is a bounded in-memory upload, not streaming or an S3 multipart upload. */
export async function readArtifactUpload(
  request: IncomingMessage,
  maxBytes: number,
  trace: string,
) {
  const fail = (code = 'INVALID_INPUT') =>
    new ContractError(
      code,
      code === 'ARTIFACT_TOO_LARGE'
        ? 'Artifact upload exceeds the configured byte limit'
        : 'Invalid artifact multipart upload',
      { trace_id: trace },
    );
  const type = request.headers['content-type'];
  const encoding = request.headers['content-encoding'];
  if (
    typeof type !== 'string' ||
    !/^multipart\/form-data\s*;/i.test(type) ||
    (encoding !== undefined && encoding !== 'identity')
  )
    throw fail();
  // Allow bounded framing in addition to the binary and JSON parts.
  const maxBody = maxBytes + ARTIFACT_UPLOAD_REQUEST_BYTES + 64 * 1024;
  const length = request.headers['content-length'];
  if (length !== undefined && (!/^\d+$/.test(length) || !Number.isSafeInteger(Number(length))))
    throw fail();
  if (length !== undefined && Number(length) > maxBody) throw fail('ARTIFACT_TOO_LARGE');
  const bytes = await readBoundedArtifactUploadBody(request, maxBody, trace);
  let form: FormData;
  try {
    // Use the native multipart parser; filenames never determine identity or storage paths.
    form = await new Response(new Blob([bytes.buffer as ArrayBuffer]), {
      headers: { 'content-type': type },
    }).formData();
  } catch {
    throw fail();
  }
  if (
    Array.from(form.keys()).length !== 2 ||
    form.getAll('request').length !== 1 ||
    form.getAll('content').length !== 1
  )
    throw fail();
  const metadata = form.get('request');
  const content = form.get('content');
  if (
    !metadata ||
    typeof metadata === 'string' ||
    !content ||
    typeof content === 'string' ||
    metadata.type !== 'application/json'
  )
    throw fail();
  if (metadata.size > ARTIFACT_UPLOAD_REQUEST_BYTES || content.size > maxBytes)
    throw fail('ARTIFACT_TOO_LARGE');
  let query;
  try {
    const json = new TextDecoder('utf-8', { fatal: true }).decode(await metadata.arrayBuffer());
    query = parseArtifactReceiptQuery(JSON.parse(json));
    if (query.command.size !== content.size) throw new TypeError();
  } catch {
    throw fail();
  }
  return { request: query, content: new Uint8Array(await content.arrayBuffer()) };
}

export function readBoundedArtifactUploadBody(
  request: IncomingMessage,
  maximum: number,
  trace: string,
  extension?: { maximum: number; acquire: () => void },
): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    if (
      !Number.isSafeInteger(maximum) ||
      maximum < 0 ||
      (extension && (!Number.isSafeInteger(extension.maximum) || extension.maximum <= maximum))
    ) {
      reject(new ContractError('INVALID_INPUT', 'Invalid body byte limit', { trace_id: trace }));
      return;
    }
    let limit = maximum;
    let buffer = new Uint8Array(Math.min(maximum, 64 * 1024));
    let used = 0;
    let settled = false;
    const fail = (code: string) =>
      new ContractError(code, 'Artifact upload body could not be read', { trace_id: trace });
    const finish = (error?: ContractError) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      request.off('data', onData);
      request.off('end', onEnd);
      request.off('aborted', onAborted);
      if (error) {
        request.pause();
        buffer = new Uint8Array();
        reject(error);
      } else {
        resolve(buffer.slice(0, used));
        buffer = new Uint8Array();
      }
      // Retain error/close listeners until close so a late socket failure is handled.
    };
    const onData = (chunk: Buffer) => {
      if (!(chunk instanceof Uint8Array)) {
        finish(fail('INVALID_INPUT'));
        return;
      }
      if (used + chunk.byteLength > limit) {
        if (!extension || used + chunk.byteLength > extension.maximum) {
          finish(fail('ARTIFACT_TOO_LARGE'));
          return;
        }
        try {
          // Reserve extended capacity before retaining any bytes above the ordinary limit.
          extension.acquire();
          limit = extension.maximum;
        } catch (error) {
          finish(error instanceof ContractError ? error : fail('INVALID_INPUT'));
          return;
        }
      }
      if (used + chunk.byteLength > buffer.byteLength) {
        const next = new Uint8Array(
          Math.min(limit, Math.max(used + chunk.byteLength, buffer.byteLength * 2)),
        );
        next.set(buffer.subarray(0, used));
        buffer = next;
      }
      buffer.set(chunk, used);
      used += chunk.byteLength;
    };
    const onEnd = () => finish();
    const onAborted = () => finish(fail('ARTIFACT_UPLOAD_INTERRUPTED'));
    const onError = () => finish(fail('ARTIFACT_UPLOAD_INTERRUPTED'));
    const onClose = () => {
      if (!settled) onAborted();
      request.off('error', onError);
      request.off('close', onClose);
    };
    const timer = setTimeout(() => finish(fail('ARTIFACT_UPLOAD_TIMEOUT')), 120_000);
    timer.unref();
    request.on('error', onError);
    request.once('close', onClose);
    request.once('aborted', onAborted);
    request.once('end', onEnd);
    request.on('data', onData);
    if (request.destroyed || request.readableEnded) onAborted();
  });
}
