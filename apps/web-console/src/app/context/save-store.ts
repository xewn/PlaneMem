'use client';

import { inBrowserStores, readBrowserPair } from '../sync/receipt/browser-store';
import { backupHash } from '../sync/receipt/backup-operation';
import {
  assertPackSaveBinding,
  decodePackSaveOriginal,
  encodePackSaveOriginal,
  packOriginalKey,
  packOriginalPrefix,
  packOriginalSlot,
  parsePackSaveBinding,
  type PackSaveBinding,
  type PackSaveOriginal,
} from './save-model';

const layout = { databaseName: 'planemem-context-pack-originals', contentStore: 'originals' };
function invalid(): never {
  throw new Error('The complete browser original could not be confirmed. Keep a separate copy.');
}
function checkedKey(value: unknown, binding: PackSaveBinding): string {
  const prefix = packOriginalPrefix(binding);
  if (
    typeof value !== 'string' ||
    value.length > 16384 ||
    new TextEncoder().encode(value).byteLength > 16384 ||
    !value.startsWith(prefix) ||
    !value.endsWith(']')
  )
    return invalid();
  const key: unknown = JSON.parse(value.slice(prefix.length, -1));
  if (typeof key !== 'string' || packOriginalSlot(binding, key) !== value) return invalid();
  return value;
}
function pair(raw: unknown, hash: unknown, key: string, binding: PackSaveBinding) {
  const original = decodePackSaveOriginal(raw);
  assertPackSaveBinding(original.binding, binding);
  if (
    typeof raw !== 'string' ||
    encodePackSaveOriginal(original) !== raw ||
    packOriginalKey(original) !== checkedKey(key, binding) ||
    typeof hash !== 'string' ||
    !/^[a-f0-9]{64}$/.test(hash)
  )
    return invalid();
  return { raw, hash };
}

/** Missing only: the original and its digest commit together, and existing bytes are never replaced. */
export async function preservePackOriginal(
  input: PackSaveOriginal,
  signal: AbortSignal,
  check: () => void,
) {
  const raw = encodePackSaveOriginal(input);
  const original = decodePackSaveOriginal(raw);
  const key = checkedKey(packOriginalKey(original), original.binding);
  const hash = await backupHash(raw);
  check();
  if (!/^[a-f0-9]{64}$/.test(hash)) return invalid();
  await inBrowserStores<void>(layout, 'readwrite', signal, invalid, (context) => {
    readBrowserPair(context, key, (saved, digest, present) => {
      check();
      if (present) {
        const existing = pair(saved, digest, key, original.binding);
        if (existing.raw !== raw || existing.hash !== hash) return invalid();
        context.accept(undefined);
        return;
      }
      context.content.add(raw, key);
      context.directory.add(hash, key);
      readBrowserPair(context, key, (saved, digest, present) => {
        check();
        if (!present) return invalid();
        const existing = pair(saved, digest, key, original.binding);
        if (existing.raw !== raw || existing.hash !== hash) return invalid();
        context.accept(undefined);
      });
    });
  });
  check();
}

/** Each returned row includes the complete original, verified against the paired digest. */
export async function listPackOriginals(
  input: PackSaveBinding,
  after: string | null,
  signal: AbortSignal,
  check: () => void,
) {
  const binding = parsePackSaveBinding(input);
  const prefix = packOriginalPrefix(binding);
  checkedKey(packOriginalSlot(binding, 'a'), binding);
  if (after !== null) checkedKey(after, binding);
  const result = await inBrowserStores<{
    pairs: Array<{ raw: string; hash: string }>;
    next: string | null;
  }>(
    layout,
    'readonly',
    signal,
    () => ({ pairs: [], next: null }),
    (context) => {
      const pairs: Array<{ raw: string; hash: string }> = [];
      let last: string | null = null;
      const request = context.directory.openKeyCursor(
        IDBKeyRange.bound(after ?? prefix, prefix + '\uffff', after !== null, true),
      );
      request.onsuccess = context.guard(() => {
        check();
        const cursor = request.result;
        if (!cursor) {
          context.accept({ pairs, next: null });
          return;
        }
        const key = checkedKey(cursor.primaryKey, binding);
        if (pairs.length === 20) {
          context.accept({ pairs, next: last });
          return;
        }
        readBrowserPair(context, key, (raw, hash, present) => {
          check();
          if (!present) return invalid();
          pairs.push(pair(raw, hash, key, binding));
          last = key;
          cursor.continue();
        });
      });
    },
  );
  check();
  const originals: PackSaveOriginal[] = [];
  for (const item of result.pairs) {
    if ((await backupHash(item.raw)) !== item.hash) return invalid();
    check();
    originals.push(decodePackSaveOriginal(item.raw));
  }
  return { originals, next: result.next };
}
