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
  proposalOriginalStoragePrefix,
  type ProposalSubmissionBinding,
} from './original-model';
import {
  AUTOSAVE_BACKUP_MAX_ENTRIES,
  createAutosaveBackupModel,
  draftAutosaveKey as key,
  type AutosaveDraft,
  type AutosaveBackupDocument,
  type AutosaveBackupEntry,
  type AutosaveBackupComparison,
  type AutosaveBackupRestoreResult,
} from './draft-autosave-backup-model';
export interface DraftAutosavePage<Summary> {
  entries: Summary[];
  next: string | null;
}
/** Fixed codecs and separate layouts keep each draft kind in its own validated store. */
export function createDraftAutosaveStore<
  Draft extends AutosaveDraft,
  Summary extends { session_id: string },
>({
  layout,
  encode,
  decode,
  summary,
  backup,
}: {
  layout: BrowserStoreLayout;
  encode: (value: unknown) => string;
  decode: (raw: string) => Draft;
  summary: (session: string, draft: Draft) => Summary;
  backup: {
    kind: 'proposal-editing-autosaves-backup' | 'proposal-review-editing-autosaves-backup';
    documentBytes: number;
  };
}) {
  const backupModel = createAutosaveBackupModel({
    ...backup,
    parseDraft: (value) => decode(encode(value)),
  });
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
  function readBudget() {
    let bytes = 0;
    return (raw: unknown, index: unknown) => {
      if (
        typeof raw !== 'string' ||
        raw.length > backupModel.documentBytes ||
        typeof index !== 'string' ||
        index.length > 4096 ||
        new TextEncoder().encode(index).byteLength > 4096
      )
        throw new TypeError();
      bytes += new TextEncoder().encode(raw).byteLength;
      if (bytes > backupModel.documentBytes) throw new TypeError();
    };
  }
  /** Count and read the entire scoped collection in one snapshot; never truncate a backup. */
  function readBackup(input: ProposalSubmissionBinding, signal: AbortSignal, check: () => void) {
    check();
    const binding = parseProposalSubmissionBinding(input);
    key(binding, '00000000-0000-4000-8000-000000000000');
    const prefix = proposalOriginalStoragePrefix(binding);
    const document = (entries: AutosaveBackupEntry<Draft>[]) =>
      backupModel.parseDocument({
        schema_version: 1,
        kind: backupModel.kind,
        binding,
        entries,
      });
    return inBrowserStores<AutosaveBackupDocument<Draft>>(
      layout,
      'readonly',
      signal,
      () => document([]),
      (context) => {
        const range = IDBKeyRange.bound(prefix, prefix + '\uffff', false, true);
        const contents = context.content.count(range);
        const directory = context.directory.count(range);
        directory.onsuccess = context.guard(() => {
          check();
          const count = contents.result;
          if (
            !Number.isSafeInteger(count) ||
            count < 0 ||
            count > AUTOSAVE_BACKUP_MAX_ENTRIES ||
            directory.result !== count
          )
            throw new TypeError();
          const entries: AutosaveBackupEntry<Draft>[] = [];
          const account = readBudget();
          const request = context.content.openKeyCursor(range);
          request.onsuccess = context.guard(() => {
            check();
            const cursor = request.result;
            if (!cursor) {
              if (entries.length !== count) throw new TypeError();
              context.accept(document(entries));
              return;
            }
            const slot = cursor.primaryKey;
            if (
              entries.length >= count ||
              typeof slot !== 'string' ||
              new TextEncoder().encode(slot).byteLength > 16384
            )
              throw new TypeError();
            readBrowserPair(context, slot, (raw, index, exists) => {
              if (!exists) throw new TypeError();
              account(raw, index);
              const saved = pair(raw, index, binding, slot);
              entries.push({ session_id: saved.entry.session_id, draft: saved.draft });
              cursor.continue();
            });
          });
        });
      },
    );
  }
  function prepareBackup(input: AutosaveBackupDocument<Draft>) {
    const document = backupModel.parseDocument(input);
    return document.entries.map(({ session_id, draft }) => ({
      session_id,
      draft,
      slot: key(document.binding, session_id),
      raw: encode(draft),
      index: JSON.stringify(summary(session_id, draft)),
    }));
  }
  function entryState(
    item: ReturnType<typeof prepareBackup>[number],
    raw: unknown,
    index: unknown,
    exists: boolean,
  ) {
    if (!exists) return 'missing' as const;
    pair(raw, index, item.draft.binding, item.slot);
    return raw === item.raw && index === item.index ? ('same' as const) : ('different' as const);
  }
  function comparison(entries: AutosaveBackupComparison['entries']): AutosaveBackupComparison {
    const missing = entries.filter((entry) => entry.state === 'missing').length;
    const same = entries.filter((entry) => entry.state === 'same').length;
    const different = entries.filter((entry) => entry.state === 'different').length;
    return { entries, missing, same, different, can_restore: different === 0 };
  }
  function compareBackup(
    input: AutosaveBackupDocument<Draft>,
    signal: AbortSignal,
    check: () => void,
  ) {
    check();
    const prepared = prepareBackup(input);
    check();
    if (!prepared.length) return Promise.resolve(comparison([]));
    return inBrowserStores<AutosaveBackupComparison>(
      layout,
      'readonly',
      signal,
      () =>
        comparison(
          prepared.map((item) => ({
            session_id: item.session_id,
            request_key: item.draft.request_key,
            state: 'missing',
          })),
        ),
      (context) => {
        const entries: AutosaveBackupComparison['entries'] = [];
        const account = readBudget();
        const next = () => {
          check();
          const item = prepared[entries.length];
          if (!item) {
            context.accept(comparison(entries));
            return;
          }
          readBrowserPair(context, item.slot, (raw, index, exists) => {
            if (exists) account(raw, index);
            entries.push({
              session_id: item.session_id,
              request_key: item.draft.request_key,
              state: entryState(item, raw, index, exists),
            });
            next();
          });
        };
        next();
      },
    );
  }
  /** Preflight every selected session before inserting any missing pair, then reread every pair. */
  function restoreBackup(
    input: AutosaveBackupDocument<Draft>,
    signal: AbortSignal,
    check: () => void,
  ) {
    check();
    const prepared = prepareBackup(input);
    check();
    if (!prepared.length) return Promise.resolve({ total: 0, added: 0, already_present: 0 });
    return inBrowserStores<AutosaveBackupRestoreResult>(
      layout,
      'readwrite',
      signal,
      () => {
        throw new TypeError();
      },
      (context) => {
        const missing: typeof prepared = [];
        const preflightBudget = readBudget();
        const verificationBudget = readBudget();
        let inspected = 0;
        let verified = 0;
        const verify = () => {
          check();
          const item = prepared[verified];
          if (!item) {
            context.accept({
              total: prepared.length,
              added: missing.length,
              already_present: prepared.length - missing.length,
            });
            return;
          }
          readBrowserPair(context, item.slot, (raw, index, exists) => {
            if (!exists) throw new TypeError();
            verificationBudget(raw, index);
            if (entryState(item, raw, index, exists) !== 'same') throw new TypeError();
            verified += 1;
            verify();
          });
        };
        const inspect = () => {
          check();
          const item = prepared[inspected];
          if (!item) {
            for (const absent of missing) {
              check();
              context.content.add(absent.raw, absent.slot);
              context.directory.add(absent.index, absent.slot);
            }
            verify();
            return;
          }
          readBrowserPair(context, item.slot, (raw, index, exists) => {
            if (exists) preflightBudget(raw, index);
            const state = entryState(item, raw, index, exists);
            if (state === 'missing') missing.push(item);
            else if (state !== 'same') throw new TypeError();
            inspected += 1;
            inspect();
          });
        };
        inspect();
      },
    );
  }
  return { save, list, load, remove, backupModel, readBackup, compareBackup, restoreBackup };
}
