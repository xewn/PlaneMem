'use client';

import {
  inBrowserStores,
  readBrowserPair,
  removeBrowserPair,
  type BrowserRemovalResult,
  type BrowserStoreLayout,
} from '../sync/receipt/browser-store';
import {
  assertProposalSubmissionBinding,
  parseProposalSubmissionBinding,
  proposalOriginalStorageKey,
  proposalOriginalStoragePrefix,
  type ProposalSubmissionBinding,
} from './original-model';
export interface DraftAutosavePage<Summary> {
  entries: Summary[];
  next: string | null;
}
function key(binding: ProposalSubmissionBinding, session: string) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(session))
    throw new TypeError();
  const slot = proposalOriginalStorageKey(binding, session);
  if (new TextEncoder().encode(slot).byteLength > 16384) throw new TypeError();
  return slot;
}
/** Fixed codecs and separate layouts keep each draft kind in its own validated store. */
export function createDraftAutosaveStore<
  Draft extends { binding: ProposalSubmissionBinding },
  Summary extends { session_id: string },
>({
  layout,
  encode,
  decode,
  summary,
}: {
  layout: BrowserStoreLayout;
  encode: (value: unknown) => string;
  decode: (raw: string) => Draft;
  summary: (session: string, draft: Draft) => Summary;
}) {
  function pair(raw: unknown, index: unknown, binding: ProposalSubmissionBinding, slot: string) {
    if (
      typeof raw !== 'string' ||
      typeof index !== 'string' ||
      new TextEncoder().encode(index).byteLength > 4096
    )
      throw new TypeError();
    const metadata: unknown = JSON.parse(index);
    if (
      !metadata ||
      typeof metadata !== 'object' ||
      !('session_id' in metadata) ||
      typeof metadata.session_id !== 'string'
    )
      throw new TypeError();
    const draft = decode(raw);
    assertProposalSubmissionBinding(draft.binding, binding);
    if (
      key(binding, metadata.session_id) !== slot ||
      encode(draft) !== raw ||
      JSON.stringify(summary(metadata.session_id, draft)) !== index
    )
      throw new TypeError();
    return { draft, entry: summary(metadata.session_id, draft) };
  }

  /** Replace only the exact last acknowledged copy in this automatic-saving session. */
  function save(session: string, previous: Draft | null, input: Draft, signal: AbortSignal) {
    const raw = encode(input);
    const draft = decode(raw);
    const slot = key(draft.binding, session);
    const expected = previous === null ? null : encode(previous);
    if (previous) assertProposalSubmissionBinding(previous.binding, draft.binding);
    return inBrowserStores<Draft>(
      layout,
      'readwrite',
      signal,
      () => {
        throw new TypeError();
      },
      (context) => {
        readBrowserPair(context, slot, (old, index, exists) => {
          if (exists) pair(old, index, draft.binding, slot);
          if (expected === null ? exists : !exists || old !== expected) throw new TypeError();
          context.content.put(raw, slot);
          context.directory.put(JSON.stringify(summary(session, draft)), slot);
          readBrowserPair(context, slot, (saved, metadata, present) => {
            if (!present || saved !== raw) throw new TypeError();
            context.accept(pair(saved, metadata, draft.binding, slot).draft);
          });
        });
      },
    );
  }

  function list(input: ProposalSubmissionBinding, after: string | null, signal: AbortSignal) {
    const binding = parseProposalSubmissionBinding(input);
    const prefix = proposalOriginalStoragePrefix(binding);
    // Apply the same binding/key byte bound even for an empty directory.
    key(binding, '00000000-0000-4000-8000-000000000000');
    const start = after === null ? prefix : key(binding, after);
    return inBrowserStores<DraftAutosavePage<Summary>>(
      layout,
      'readonly',
      signal,
      () => ({ entries: [], next: null }),
      (context) => {
        const entries: Summary[] = [];
        const request = context.directory.openCursor(
          IDBKeyRange.bound(start, prefix + '\uffff', after !== null, true),
        );
        request.onsuccess = context.guard(() => {
          const cursor = request.result;
          if (!cursor) {
            context.accept({ entries, next: null });
            return;
          }
          if (
            typeof cursor.primaryKey !== 'string' ||
            new TextEncoder().encode(cursor.primaryKey).byteLength > 16384 ||
            typeof cursor.value !== 'string' ||
            new TextEncoder().encode(cursor.value).byteLength > 4096
          )
            throw new TypeError();
          if (entries.length === 20) {
            context.accept({ entries, next: entries[19]!.session_id });
            return;
          }
          const slot = cursor.primaryKey;
          readBrowserPair(context, slot, (raw, index, exists) => {
            if (!exists) throw new TypeError();
            entries.push(pair(raw, index, binding, slot).entry);
            cursor.continue();
          });
        });
      },
    );
  }

  function load(input: ProposalSubmissionBinding, selection: Summary, signal: AbortSignal) {
    const binding = parseProposalSubmissionBinding(input);
    const slot = key(binding, selection.session_id);
    const expected = JSON.stringify(selection);
    return inBrowserStores<Draft>(
      layout,
      'readonly',
      signal,
      () => {
        throw new TypeError();
      },
      (context) => {
        readBrowserPair(context, slot, (raw, index, exists) => {
          if (!exists || index !== expected) throw new TypeError();
          context.accept(pair(raw, index, binding, slot).draft);
        });
      },
    );
  }

  function remove(
    input: ProposalSubmissionBinding,
    session: string,
    reviewed: Draft,
    signal: AbortSignal,
  ) {
    const binding = parseProposalSubmissionBinding(input);
    const expected = encode(reviewed);
    const draft = decode(expected);
    assertProposalSubmissionBinding(draft.binding, binding);
    const slot = key(binding, session);
    return inBrowserStores<BrowserRemovalResult>(
      layout,
      'readwrite',
      signal,
      () => 'not-present',
      (context) => {
        readBrowserPair(context, slot, (raw, index, exists) => {
          if (!exists) {
            context.accept('not-present');
            return;
          }
          pair(raw, index, binding, slot);
          if (raw !== expected) throw new TypeError();
          removeBrowserPair(context, slot);
        });
      },
      { create: false },
    );
  }
  return { save, list, load, remove };
}
