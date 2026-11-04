import type { RequestBudget } from './request-budget.js';

/** Copy local UTF-8 input within a caller-selected format limit; no shared buffer or iterator. */
export function captureContextBackupBytes(
  input: string | Uint8Array,
  maximum: number,
): Uint8Array<ArrayBuffer> {
  let bytes: Uint8Array<ArrayBuffer>;
  if (typeof input === 'string') {
    if (!input || input.length > maximum || /[\p{Cs}]/u.test(input)) throw new TypeError();
    bytes = new TextEncoder().encode(input);
  } else {
    if (!(input instanceof Uint8Array)) throw new TypeError();
    const prototype: object = Object.getPrototypeOf(Uint8Array.prototype);
    const buffer: unknown = Object.getOwnPropertyDescriptor(prototype, 'buffer')!.get!.call(input);
    const size: number = Object.getOwnPropertyDescriptor(prototype, 'byteLength')!.get!.call(input);
    const offset: number = Object.getOwnPropertyDescriptor(prototype, 'byteOffset')!.get!.call(
      input,
    );
    if (!(buffer instanceof ArrayBuffer) || !size || size > maximum) throw new TypeError();
    bytes = new Uint8Array(size);
    bytes.set(new Uint8Array(buffer, offset, size));
  }
  if (!bytes.byteLength || bytes.byteLength > maximum) throw new TypeError();
  return bytes;
}

/** Adapters map unavailable integrity into their fixed local error envelopes. */
export async function contextBackupSha256(raw: string, budget: RequestBudget): Promise<string> {
  budget.check();
  if (typeof globalThis.crypto?.subtle?.digest !== 'function') throw new TypeError();
  const bytes = new TextEncoder().encode(raw);
  const digest = await budget.wait(() => globalThis.crypto.subtle.digest('SHA-256', bytes));
  if (!(digest instanceof ArrayBuffer) || digest.byteLength !== 32) throw new TypeError();
  budget.check();
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}
