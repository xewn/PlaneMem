'use client';

import {
  parseConflictCommandIdentity,
  type ConflictCommandIdentity,
  type ConflictReceiptQuery,
} from '@planemem/contracts';
import { conflictOriginalStorageKey, decodeScopedConflictOriginal } from './original-model';
import { encodeConflictRequest } from './receipt/model';

const databaseName = 'planemem-conflict-originals';
const storeName = 'originals';
const waitMs = 10_000;

function unavailable() {
  return new Error(
    'The saved original request could not be read or committed. Keep the original unchanged.',
  );
}

/** Each operation owns its connection. Late opens are closed and never start a request transaction. */
function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const deadline = performance.now() + waitMs;
    const fail = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(unavailable());
    };
    const timer = setTimeout(fail, waitMs);
    let request: IDBOpenDBRequest;
    try {
      request = indexedDB.open(databaseName, 1);
    } catch {
      fail();
      return;
    }
    request.onblocked = fail;
    request.onerror = fail;
    request.onupgradeneeded = () => {
      if (settled || performance.now() >= deadline) {
        request.transaction?.abort();
        fail();
        return;
      }
      try {
        // Only initialize the new schema. Never drop an unknown store or repair saved data in place.
        if (!request.result.objectStoreNames.contains(storeName))
          request.result.createObjectStore(storeName);
      } catch {
        request.transaction?.abort();
        fail();
      }
    };
    request.onsuccess = () => {
      const database = request.result;
      if (
        settled ||
        performance.now() >= deadline ||
        !database.objectStoreNames.contains(storeName)
      ) {
        database.close();
        fail();
        return;
      }
      database.onversionchange = () => database.close();
      settled = true;
      clearTimeout(timer);
      resolve(database);
    };
  });
}

/** Resolve only after transaction completion, including the queued read-back. No async work in visit. */
async function atSlot<T>(
  key: string,
  mode: IDBTransactionMode,
  visit: (
    current: unknown,
    store: IDBObjectStore,
    accept: (value: T) => void,
    fail: (error: unknown) => void,
  ) => void,
): Promise<T> {
  const database = await openDatabase();
  return new Promise<T>((resolve, reject) => {
    let transaction: IDBTransaction;
    let store: IDBObjectStore;
    try {
      transaction = database.transaction(storeName, mode);
      store = transaction.objectStore(storeName);
      if (store.keyPath !== null || store.autoIncrement) throw unavailable();
    } catch {
      database.close();
      reject(unavailable());
      return;
    }
    let settled = false;
    let accepted: { value: T } | undefined;
    let failure: unknown;
    const deadline = performance.now() + waitMs;
    const finish = (success: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      database.close();
      if (success && failure === undefined && accepted && performance.now() < deadline)
        resolve(accepted.value);
      else reject(failure ?? unavailable());
    };
    const fail = (error: unknown) => {
      if (settled) return;
      failure = error;
      try {
        transaction.abort();
      } catch {
        finish(false);
      }
    };
    const timer = setTimeout(() => {
      fail(unavailable());
      // Do not keep the UI waiting for an abort event from a blocked browser storage service.
      finish(false);
    }, waitMs);
    transaction.oncomplete = () => finish(true);
    transaction.onabort = () => finish(false);
    transaction.onerror = () => {
      failure ??= unavailable();
    };
    try {
      const presence = store.getKey(key);
      const request = store.get(key);
      request.onsuccess = () => {
        if (settled || performance.now() >= deadline) {
          fail(unavailable());
          return;
        }
        try {
          if (presence.result !== undefined && typeof request.result !== 'string')
            throw unavailable();
          visit(
            request.result as unknown,
            store,
            (result) => {
              accepted = { value: result };
            },
            fail,
          );
        } catch (error) {
          fail(error);
        }
      };
    } catch (error) {
      fail(error);
    }
  });
}

export function loadLegacyConflictOriginal(identity: ConflictCommandIdentity, conflictId: string) {
  const raw = sessionStorage.getItem(conflictOriginalStorageKey(identity, conflictId));
  return raw === null ? undefined : decodeScopedConflictOriginal(raw, identity, conflictId);
}

function reconcile(
  current: ConflictReceiptQuery | undefined,
  legacy: ConflictReceiptQuery | undefined,
) {
  if (current && legacy && encodeConflictRequest(current) !== encodeConflictRequest(legacy))
    throw new Error(
      'The browser and this tab contain different originals. Keep both copies and check their receipts separately.',
    );
  return current ?? legacy;
}

function decodeStored(raw: unknown, identity: ConflictCommandIdentity, conflictId: string) {
  return raw === undefined ? undefined : decodeScopedConflictOriginal(raw, identity, conflictId);
}

/** Recovery can inspect the durable copy even when the old tab copy is unreadable or disagrees. */
export function loadBrowserConflictOriginal(identity: ConflictCommandIdentity, conflictId: string) {
  identity = parseConflictCommandIdentity(identity);
  const key = conflictOriginalStorageKey(identity, conflictId);
  return atSlot<ConflictReceiptQuery | undefined>(key, 'readonly', (raw, _store, accept) => {
    accept(decodeStored(raw, identity, conflictId));
  });
}

/** Normal preparation must account for both exact slots. Reading never migrates or deletes originals. */
export function loadConflictOriginal(identity: ConflictCommandIdentity, conflictId: string) {
  identity = parseConflictCommandIdentity(identity);
  const key = conflictOriginalStorageKey(identity, conflictId);
  return atSlot<ConflictReceiptQuery | undefined>(key, 'readonly', (raw, _store, accept) => {
    accept(
      reconcile(
        decodeStored(raw, identity, conflictId),
        loadLegacyConflictOriginal(identity, conflictId),
      ),
    );
  });
}

function addAndReadBack<T>(
  store: IDBObjectStore,
  key: string,
  original: ConflictReceiptQuery,
  result: T,
  accept: (value: T) => void,
  fail: (error: unknown) => void,
) {
  const serialized = encodeConflictRequest(original);
  store.add(serialized, key); // No replacement operation, even for a racing tab.
  const read = store.get(key);
  read.onsuccess = () => {
    try {
      const saved = decodeScopedConflictOriginal(
        read.result as unknown,
        original.identity,
        original.command.conflict_id,
      );
      if (encodeConflictRequest(saved) !== serialized) throw unavailable();
      accept(result);
    } catch (error) {
      fail(error);
    }
  };
}

export interface ConflictOriginalSelection {
  original: ConflictReceiptQuery;
  created: boolean;
}

/** Allocate only inside the serialized write transaction after finding no existing original. */
export async function prepareBrowserConflictOriginal(
  identity: ConflictCommandIdentity,
  conflictId: string,
  create: () => ConflictReceiptQuery,
  remember: (selection: ConflictOriginalSelection) => void,
) {
  identity = parseConflictCommandIdentity(identity);
  const key = conflictOriginalStorageKey(identity, conflictId);
  const selected = await atSlot<ConflictOriginalSelection>(
    key,
    'readwrite',
    (raw, store, accept, fail) => {
      const current = decodeStored(raw, identity, conflictId);
      const existing = reconcile(current, loadLegacyConflictOriginal(identity, conflictId));
      const original =
        existing ??
        decodeScopedConflictOriginal(encodeConflictRequest(create()), identity, conflictId);
      const selection = { original, created: existing === undefined };
      // The caller retains the allocated key even if a later read-back, commit or local deadline fails.
      remember(selection);
      if (current) accept(selection);
      else addAndReadBack(store, key, original, selection, accept, fail);
    },
  );
  reconcile(selected.original, loadLegacyConflictOriginal(identity, conflictId));
  return selected;
}

/** Sending requires an exact committed original. A different or malformed original is never replaced. */
export async function preserveBrowserConflictOriginal(input: ConflictReceiptQuery) {
  const serialized = encodeConflictRequest(input);
  const original = decodeScopedConflictOriginal(
    serialized,
    input.identity,
    input.command.conflict_id,
  );
  const { identity } = original;
  const conflictId = original.command.conflict_id;
  const key = conflictOriginalStorageKey(identity, conflictId);
  await atSlot<void>(key, 'readwrite', (raw, store, accept, fail) => {
    const current = decodeStored(raw, identity, conflictId);
    const existing = reconcile(current, loadLegacyConflictOriginal(identity, conflictId));
    if (existing && encodeConflictRequest(existing) !== serialized)
      throw new Error('A different original request is already saved. Nothing was replaced.');
    if (current) accept(undefined);
    else addAndReadBack(store, key, original, undefined, accept, fail);
  });
  reconcile(original, loadLegacyConflictOriginal(identity, conflictId));
}
