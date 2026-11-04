'use client';

import {
  CONTEXT_PACK_SAVE_RECEIPT_FILE_BYTES,
  contextPackSaveReceiptDocumentJson,
  contextPackSaveReceiptFileJson,
  parseContextPackSaveReceiptFile,
  parsePackSaveBinding,
  assertPackSaveBinding,
  type ContextPackSaveReceiptDocument,
  type ContextPackSaveReceiptFile,
  type PackSaveBinding,
} from '@planemem/contracts';
import { backupHash } from '../sync/receipt/backup-operation';
import { inBrowserStores, readBrowserPair } from '../sync/receipt/browser-store';
import {
  PACK_RECEIPT_HISTORY_PAGE_SIZE,
  PACK_RECEIPT_HISTORY_SCAN_LIMIT,
  matchesPackReceiptHistory,
  parsePackReceiptHistoryQuery,
  type PackReceiptHistoryQuery,
} from './save-receipt-query';

const layout = { databaseName: 'planemem-context-pack-save-history', contentStore: 'observations' };
export interface PackReceiptCandidate {
  file: ContextPackSaveReceiptFile;
  raw: string;
}
export interface PackReceiptHistoryPage {
  query: PackReceiptHistoryQuery;
  entries: PackReceiptCandidate[];
  scanned: number;
  next: PackReceiptHistoryQuery | null;
}
function invalid(): never {
  throw new Error(
    'The complete historical observation could not be confirmed. Keep a separate copy.',
  );
}
function prefix(binding: PackSaveBinding) {
  return (
    'planemem:pack-save-observation:v1:' +
    JSON.stringify([parsePackSaveBinding(binding)]).slice(0, -1) +
    ','
  );
}
function slot(binding: PackSaveBinding, digest: string) {
  if (!/^[a-f0-9]{64}$/.test(digest)) return invalid();
  const key = prefix(binding) + JSON.stringify(digest) + ']';
  if (new TextEncoder().encode(key).byteLength > 16384) return invalid();
  return key;
}
function checkedKey(value: unknown, binding: PackSaveBinding): string {
  const start = prefix(binding);
  if (
    typeof value !== 'string' ||
    value.length > 16384 ||
    !value.startsWith(start) ||
    !value.endsWith(']')
  )
    return invalid();
  const digest: unknown = JSON.parse(value.slice(start.length, -1));
  if (typeof digest !== 'string' || slot(binding, digest) !== value) return invalid();
  return value;
}
function decode(raw: unknown) {
  if (
    typeof raw !== 'string' ||
    !raw ||
    raw.length > CONTEXT_PACK_SAVE_RECEIPT_FILE_BYTES ||
    new TextEncoder().encode(raw).byteLength > CONTEXT_PACK_SAVE_RECEIPT_FILE_BYTES
  )
    return invalid();
  return parseContextPackSaveReceiptFile(JSON.parse(raw.replace(/^\uFEFF/, '')));
}
export async function preparePackReceiptHistory(
  document: ContextPackSaveReceiptDocument,
  check: () => void,
): Promise<PackReceiptCandidate> {
  check();
  const raw = contextPackSaveReceiptDocumentJson(document);
  const digest = await backupHash(raw);
  check();
  const file = parseContextPackSaveReceiptFile({
    document: JSON.parse(raw),
    document_sha256: digest,
  });
  return { file, raw: contextPackSaveReceiptFileJson(file) };
}
export async function inspectPackReceiptHistory(
  raw: string,
  input: PackSaveBinding,
  check: () => void,
): Promise<PackReceiptCandidate> {
  check();
  const binding = parsePackSaveBinding(input);
  const file = decode(raw);
  assertPackSaveBinding(file.document.original.binding, binding);
  const digest = await backupHash(contextPackSaveReceiptDocumentJson(file.document));
  check();
  if (digest !== file.document_sha256) return invalid();
  slot(binding, digest);
  return { file, raw: contextPackSaveReceiptFileJson(file) };
}
function pair(
  raw: unknown,
  digest: unknown,
  key: string,
  binding: PackSaveBinding,
): PackReceiptCandidate {
  const file = decode(raw);
  assertPackSaveBinding(file.document.original.binding, binding);
  if (
    contextPackSaveReceiptFileJson(file) !== raw ||
    file.document_sha256 !== digest ||
    slot(binding, file.document_sha256) !== checkedKey(key, binding)
  )
    return invalid();
  return { file, raw: raw as string };
}
/** Atomic missing-only insertion. Different observations use different immutable digest slots. */
export async function preservePackReceiptHistory(
  raw: string,
  input: PackSaveBinding,
  signal: AbortSignal,
  check: () => void,
) {
  const binding = parsePackSaveBinding(input);
  const candidate = await inspectPackReceiptHistory(raw, binding, check);
  const key = slot(binding, candidate.file.document_sha256);
  await inBrowserStores<void>(layout, 'readwrite', signal, invalid, (context) => {
    readBrowserPair(context, key, (saved, digest, exists) => {
      check();
      if (exists) {
        if (pair(saved, digest, key, binding).raw !== candidate.raw) return invalid();
        context.accept(undefined);
        return;
      }
      context.content.add(candidate.raw, key);
      context.directory.add(candidate.file.document_sha256, key);
      readBrowserPair(context, key, (saved, digest, exists) => {
        check();
        if (!exists || pair(saved, digest, key, binding).raw !== candidate.raw) return invalid();
        context.accept(undefined);
      });
    });
  });
  check();
  return candidate;
}
/** Verify every scanned pair, including nonmatches, before returning a bounded filtered page. */
export async function listPackReceiptHistory(
  input: PackSaveBinding,
  queryInput: PackReceiptHistoryQuery,
  signal: AbortSignal,
  check: () => void,
): Promise<PackReceiptHistoryPage> {
  check();
  const binding = parsePackSaveBinding(input);
  const query = parsePackReceiptHistoryQuery(queryInput);
  const { after } = query;
  const start = prefix(binding);
  slot(binding, '0'.repeat(64));
  if (after !== null) checkedKey(after, binding);
  const result = await inBrowserStores<{ entries: PackReceiptCandidate[]; next: string | null }>(
    layout,
    'readonly',
    signal,
    () => ({ entries: [], next: null }),
    (context) => {
      const entries: PackReceiptCandidate[] = [];
      let matches = 0;
      let last: string | null = null;
      const request = context.directory.openKeyCursor(
        IDBKeyRange.bound(after ?? start, start + '\uffff', after !== null, true),
      );
      request.onsuccess = context.guard(() => {
        check();
        const cursor = request.result;
        if (!cursor) {
          context.accept({ entries, next: null });
          return;
        }
        const key = checkedKey(cursor.primaryKey, binding);
        if (
          matches === PACK_RECEIPT_HISTORY_PAGE_SIZE ||
          entries.length === PACK_RECEIPT_HISTORY_SCAN_LIMIT
        ) {
          context.accept({ entries, next: last });
          return;
        }
        readBrowserPair(context, key, (raw, digest, exists) => {
          check();
          if (!exists) return invalid();
          const candidate = pair(raw, digest, key, binding);
          entries.push(candidate);
          if (matchesPackReceiptHistory(candidate.file.document, query)) matches += 1;
          last = key;
          cursor.continue();
        });
      });
    },
  );
  check();
  for (const entry of result.entries) {
    check();
    if (
      (await backupHash(contextPackSaveReceiptDocumentJson(entry.file.document))) !==
      entry.file.document_sha256
    )
      return invalid();
    check();
  }
  return {
    query,
    entries: result.entries.filter((entry) =>
      matchesPackReceiptHistory(entry.file.document, query),
    ),
    scanned: result.entries.length,
    next: result.next === null ? null : { ...query, after: result.next },
  };
}
