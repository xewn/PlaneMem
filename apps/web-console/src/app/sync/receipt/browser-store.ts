'use client';

export interface BrowserStoreLayout {
  databaseName: string;
  contentStore: string;
}
const waitMs = 10_000;
function unavailable() {
  return new Error('Browser data could not be read or committed. Keep a separate copy.');
}
/** A missing database is aborted on read. Only an explicit save may initialize version 1. */
function openDatabase(
  layout: BrowserStoreLayout,
  create: boolean,
  signal: AbortSignal,
): Promise<IDBDatabase | null> {
  const storeNames = [layout.contentStore, 'directory'];
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(unavailable());
      return;
    }
    let settled = false;
    let missing = false;
    let request: IDBOpenDBRequest | undefined;
    const deadline = performance.now() + waitMs;
    const cleanup = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', fail);
    };
    const fail = () => {
      if (settled) return;
      settled = true;
      cleanup();
      try {
        request?.transaction?.abort();
      } catch {
        /* Completion may already be queued. */
      }
      reject(unavailable());
    };
    const timer = setTimeout(fail, waitMs);
    signal.addEventListener('abort', fail, { once: true });
    try {
      request = indexedDB.open(layout.databaseName, 1);
    } catch {
      fail();
      return;
    }
    const opening = request;
    opening.onblocked = fail;
    opening.onerror = () => {
      if (settled) return;
      if (!missing || signal.aborted || performance.now() >= deadline) {
        fail();
        return;
      }
      settled = true;
      cleanup();
      resolve(null);
    };
    opening.onupgradeneeded = (event) => {
      if (settled || signal.aborted || performance.now() >= deadline) {
        fail();
        try {
          opening.transaction?.abort();
        } catch {
          /* No active upgrade remains. */
        }
        return;
      }
      try {
        if (event.oldVersion !== 0) throw unavailable();
        if (!create) {
          missing = true;
          opening.transaction!.abort();
          return;
        }
        for (const name of storeNames) opening.result.createObjectStore(name);
      } catch {
        fail();
      }
    };
    opening.onsuccess = () => {
      const database = opening.result;
      if (
        settled ||
        signal.aborted ||
        performance.now() >= deadline ||
        database.objectStoreNames.length !== storeNames.length ||
        storeNames.some((name) => !database.objectStoreNames.contains(name))
      ) {
        database.close();
        fail();
        return;
      }
      database.onversionchange = () => database.close();
      settled = true;
      cleanup();
      resolve(database);
    };
  });
}

export interface BrowserStoreVisit<T> {
  content: IDBObjectStore;
  directory: IDBObjectStore;
  guard: (work: () => void) => () => void;
  accept: (result: T) => void;
}

/** Synchronous request callbacks only; success is returned after the transaction completes. */
export async function inBrowserStores<T>(
  layout: BrowserStoreLayout,
  mode: 'readonly' | 'readwrite',
  signal: AbortSignal,
  missing: () => T,
  visit: (context: BrowserStoreVisit<T>) => void,
  options: { create?: boolean } = {},
): Promise<T> {
  const database = await openDatabase(
    layout,
    mode === 'readwrite' && options.create !== false,
    signal,
  );
  if (signal.aborted) {
    database?.close();
    throw unavailable();
  }
  if (!database) return missing();
  return new Promise<T>((resolve, reject) => {
    let transaction: IDBTransaction | undefined;
    let accepted: { value: T } | undefined;
    let settled = false;
    const deadline = performance.now() + waitMs;
    const finish = (success: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener('abort', fail);
      database.close();
      if (success && accepted && !signal.aborted && performance.now() < deadline)
        resolve(accepted.value);
      else reject(unavailable());
    };
    const fail = () => {
      if (settled) return;
      try {
        transaction?.abort();
      } catch {
        /* Commit outcome can be unknown. */
      }
      finish(false);
    };
    const timer = setTimeout(fail, waitMs);
    signal.addEventListener('abort', fail, { once: true });
    const guard = (work: () => void) => () => {
      if (settled) return;
      if (signal.aborted || performance.now() >= deadline) {
        fail();
        return;
      }
      try {
        work();
      } catch {
        fail();
      }
    };
    guard(() => {
      transaction = database.transaction([layout.contentStore, 'directory'], mode);
      transaction.oncomplete = () => finish(true);
      transaction.onabort = fail;
      transaction.onerror = fail;
      const content = transaction.objectStore(layout.contentStore);
      const directory = transaction.objectStore('directory');
      for (const store of [content, directory])
        if (store.keyPath !== null || store.autoIncrement || store.indexNames.length)
          throw unavailable();
      visit({
        content,
        directory,
        guard,
        accept: (value) => {
          accepted = { value };
        },
      });
    })();
  });
}

export function readBrowserPair<T>(
  context: BrowserStoreVisit<T>,
  key: string,
  receive: (original: unknown, summary: unknown, present: boolean) => void,
) {
  const originalKey = context.content.getKey(key);
  const summaryKey = context.directory.getKey(key);
  const original = context.content.get(key);
  const summary = context.directory.get(key);
  summary.onsuccess = context.guard(() => {
    const present = originalKey.result !== undefined;
    if (present !== (summaryKey.result !== undefined)) throw unavailable();
    if (present && (typeof original.result !== 'string' || typeof summary.result !== 'string'))
      throw unavailable();
    receive(original.result as unknown, summary.result as unknown, present);
  });
}

export type BrowserRemovalResult = 'removed' | 'not-present';

/** The caller must first validate both stored values against the complete reviewed copy. */
export function removeBrowserPair(context: BrowserStoreVisit<BrowserRemovalResult>, key: string) {
  context.content.delete(key);
  context.directory.delete(key);
  readBrowserPair(context, key, (_original, _summary, present) => {
    if (present) throw unavailable();
    context.accept('removed');
  });
}
