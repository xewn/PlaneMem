import { SYNC_UPLOAD_RESPONSE_BYTES } from '@planemem/contracts';
import type { SyncPublishBudget } from './gateway-budget.js';

export const discardSyncResponse = (response: Response) => {
  try {
    void response.body?.cancel().catch(() => undefined);
  } catch {
    /* Best-effort disposal. */
  }
};

/** Fetch supplies decoded bytes. Never use an unbounded text()/json() fallback. */
export async function readSyncResponse(
  response: Response,
  budget: SyncPublishBudget,
): Promise<unknown> {
  const maximum = SYNC_UPLOAD_RESPONSE_BYTES;
  const declared = response.headers.get('content-length');
  let expected: number | undefined;
  if (declared !== null) {
    if (!/^(0|[1-9][0-9]{0,15})$/.test(declared) || !Number.isSafeInteger(Number(declared)))
      throw new TypeError();
    const encoding = response.headers.get('content-encoding');
    if (encoding === null || encoding.toLowerCase() === 'identity') expected = Number(declared);
    if (expected !== undefined && expected > maximum) throw new TypeError();
  }
  if (!response.body) throw new TypeError();
  const reader = response.body.getReader();
  let complete = false;
  try {
    let buffer = new Uint8Array(Math.min(maximum, expected ?? 16 * 1024));
    let used = 0;
    while (true) {
      const next = await budget.wait(() => reader.read());
      if (next.done) {
        complete = true;
        break;
      }
      if (
        !(next.value instanceof Uint8Array) ||
        next.value.byteLength > maximum - used ||
        (expected !== undefined && next.value.byteLength > expected - used)
      )
        throw new TypeError();
      const needed = used + next.value.byteLength;
      if (needed > buffer.byteLength) {
        const larger = new Uint8Array(Math.min(maximum, Math.max(needed, buffer.byteLength * 2)));
        larger.set(buffer.subarray(0, used));
        buffer = larger;
      }
      buffer.set(next.value, used);
      used = needed;
    }
    if (expected !== undefined && expected !== used) throw new TypeError();
    budget.check();
    const result: unknown = JSON.parse(
      new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, used)),
    );
    budget.check();
    return result;
  } finally {
    try {
      if (!complete) void reader.cancel().catch(() => undefined);
    } catch {
      /* Preserve the original read failure if cancellation itself fails. */
    }
    try {
      reader.releaseLock();
    } catch {
      /* Best-effort cleanup, including pending reads. */
    }
  }
}
