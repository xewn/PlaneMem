'use client';

import {
  inBrowserStores,
  readBrowserPair,
  removeBrowserPair,
  type BrowserRemovalResult,
} from '../sync/receipt/browser-store';
import {
  assertProposalSubmissionBinding,
  parseProposalSubmissionBinding,
  proposalOriginalStorageKey,
  proposalOriginalStoragePrefix,
  type ProposalSubmissionBinding,
} from './original-model';
import {
  decodeProposalEditingDraft,
  encodeProposalEditingDraft,
  PROPOSAL_EDITING_BYTES,
  type ProposalEditingDraft,
} from './editing-model';
import {
  EDITING_BACKUP_DOCUMENT_BYTES,
  EDITING_BACKUP_FILE_BYTES,
  EDITING_BACKUP_MAX_ENTRIES,
  editingBackupDocumentJson,
  editingBackupFileJson,
  parseEditingBackupFile,
  parseEditingBackupDocument,
  type EditingBackupDocument,
} from './editing-backup-model';
import { createManualDraftCleanup } from './manual-draft-cleanup';

const layout = { databaseName: 'planemem-proposal-editing-drafts', contentStore: 'drafts' };
export interface ProposalEditingSummary {
  request_key: string;
  saved_at: string;
  title: string;
  kind: string;
  classification: string;
}
export interface ProposalEditingPage {
  entries: ProposalEditingSummary[];
  next: string | null;
}
const summary = (draft: ProposalEditingDraft): ProposalEditingSummary => ({
  request_key: draft.request_key,
  saved_at: draft.saved_at,
  title: draft.fields.values.title,
  kind: draft.fields.values.kind,
  classification: draft.fields.values.classification,
});
function key(binding: ProposalSubmissionBinding, requestKey: string) {
  const value = proposalOriginalStorageKey(binding, requestKey);
  if (new TextEncoder().encode(value).byteLength > 16384) throw new TypeError();
  return value;
}
function pair(raw: unknown, index: unknown, binding: ProposalSubmissionBinding, slot: string) {
  if (typeof raw !== 'string' || typeof index !== 'string') throw new TypeError();
  const draft = decodeProposalEditingDraft(raw);
  assertProposalSubmissionBinding(draft.binding, binding);
  if (
    key(binding, draft.request_key) !== slot ||
    encodeProposalEditingDraft(draft) !== raw ||
    JSON.stringify(summary(draft)) !== index
  )
    throw new TypeError();
  return draft;
}
export async function saveProposalEditingDraft(input: ProposalEditingDraft, signal: AbortSignal) {
  const raw = encodeProposalEditingDraft(input);
  const draft = decodeProposalEditingDraft(raw);
  const slot = key(draft.binding, draft.request_key);
  return inBrowserStores<ProposalEditingDraft>(
    layout,
    'readwrite',
    signal,
    () => {
      throw new TypeError();
    },
    (context) => {
      readBrowserPair(context, slot, (old, index, exists) => {
        if (exists) {
          const saved = pair(old, index, draft.binding, slot);
          // Saving the same editing state again retains its first save time.
          if (encodeProposalEditingDraft({ ...draft, saved_at: saved.saved_at }) !== old)
            throw new TypeError();
          context.accept(saved);
          return;
        }
        context.content.add(raw, slot);
        context.directory.add(JSON.stringify(summary(draft)), slot);
        readBrowserPair(context, slot, (saved, metadata, present) => {
          if (!present || saved !== raw) throw new TypeError();
          context.accept(pair(saved, metadata, draft.binding, slot));
        });
      });
    },
  );
}
export function loadProposalEditingDraft(
  bindingInput: ProposalSubmissionBinding,
  selection: ProposalEditingSummary,
  signal: AbortSignal,
) {
  const binding = parseProposalSubmissionBinding(bindingInput);
  const slot = key(binding, selection.request_key);
  const expected = JSON.stringify(selection);
  return inBrowserStores<ProposalEditingDraft>(
    layout,
    'readonly',
    signal,
    () => {
      throw new TypeError();
    },
    (context) => {
      readBrowserPair(context, slot, (raw, index, exists) => {
        if (!exists || index !== expected) throw new TypeError();
        context.accept(pair(raw, index, binding, slot));
      });
    },
  );
}
/** Remove only the complete immutable browser copy reviewed under the current binding. */
export function removeProposalEditingDraft(
  bindingInput: ProposalSubmissionBinding,
  reviewed: ProposalEditingDraft,
  signal: AbortSignal,
) {
  const binding = parseProposalSubmissionBinding(bindingInput);
  const expectedRaw = encodeProposalEditingDraft(reviewed);
  const draft = decodeProposalEditingDraft(expectedRaw);
  assertProposalSubmissionBinding(draft.binding, binding);
  const slot = key(binding, draft.request_key);
  const expectedIndex = JSON.stringify(summary(draft));
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
        if (raw !== expectedRaw || index !== expectedIndex) throw new TypeError();
        removeBrowserPair(context, slot);
      });
    },
    { create: false },
  );
}

export function listProposalEditingDrafts(
  bindingInput: ProposalSubmissionBinding,
  after: string | null,
  signal: AbortSignal,
) {
  const binding = parseProposalSubmissionBinding(bindingInput);
  const prefix = proposalOriginalStoragePrefix(binding);
  key(binding, 'a');
  const start = after === null ? prefix : key(binding, after);
  return inBrowserStores<ProposalEditingPage>(
    layout,
    'readonly',
    signal,
    () => ({ entries: [], next: null }),
    (context) => {
      const entries: ProposalEditingSummary[] = [];
      const cursor = context.directory.openCursor(
        IDBKeyRange.bound(start, prefix + '\uffff', after !== null, true),
      );
      cursor.onsuccess = context.guard(() => {
        const current = cursor.result;
        if (!current) {
          context.accept({ entries, next: null });
          return;
        }
        if (
          typeof current.primaryKey !== 'string' ||
          typeof current.value !== 'string' ||
          new TextEncoder().encode(current.value).byteLength > 4096
        )
          throw new TypeError();
        if (entries.length === 20) {
          context.accept({ entries, next: entries[19]!.request_key });
          return;
        }
        const slot = current.primaryKey;
        // Verify the full pair before exposing a directory entry; at most 20 drafts per page.
        readBrowserPair(context, slot, (raw, index, exists) => {
          if (!exists) throw new TypeError();
          entries.push(summary(pair(raw, index, binding, slot)));
          current.continue();
        });
      });
    },
  );
}

/** Count both stores and verify every pair in a single scoped snapshot; never truncate. */
export function readEditingBackup(
  bindingInput: ProposalSubmissionBinding,
  signal: AbortSignal,
  check: () => void,
) {
  check();
  const binding = parseProposalSubmissionBinding(bindingInput);
  key(binding, 'a');
  const prefix = proposalOriginalStoragePrefix(binding);
  const empty = (): EditingBackupDocument => ({
    schema_version: 1,
    kind: 'proposal-editing-drafts-backup',
    binding,
    entries: [],
  });
  return inBrowserStores<EditingBackupDocument>(layout, 'readonly', signal, empty, (context) => {
    const range = IDBKeyRange.bound(prefix, prefix + '\uffff', false, true);
    const drafts = context.content.count(range);
    const directory = context.directory.count(range);
    directory.onsuccess = context.guard(() => {
      const count = drafts.result;
      if (
        !Number.isSafeInteger(count) ||
        count < 0 ||
        count > EDITING_BACKUP_MAX_ENTRIES ||
        directory.result !== count
      )
        throw new TypeError();
      const entries: ProposalEditingDraft[] = [];
      const account = backupReadBudget();
      const request = context.content.openKeyCursor(range);
      request.onsuccess = context.guard(() => {
        const cursor = request.result;
        if (!cursor) {
          if (entries.length !== count) throw new TypeError();
          context.accept(parseEditingBackupDocument({ ...empty(), entries }));
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
          entries.push(pair(raw, index, binding, slot));
          cursor.continue();
        });
      });
    });
  });
}

/** Bounds parsed target content per complete pass, even when it differs from the source. */
function backupReadBudget() {
  let bytes = 0;
  return (raw: unknown, index: unknown) => {
    if (
      typeof raw !== 'string' ||
      raw.length > PROPOSAL_EDITING_BYTES ||
      typeof index !== 'string' ||
      index.length > 4096
    )
      throw new TypeError();
    const size = new TextEncoder().encode(raw).byteLength;
    if (size > PROPOSAL_EDITING_BYTES || new TextEncoder().encode(index).byteLength > 4096)
      throw new TypeError();
    bytes += size;
    if (bytes > EDITING_BACKUP_DOCUMENT_BYTES) throw new TypeError();
  };
}
export const editingDraftCleanup = createManualDraftCleanup<
  ProposalEditingDraft,
  ProposalEditingSummary,
  EditingBackupDocument
>({
  layout,
  kind: 'proposal-editing-drafts-backup',
  documentBytes: EDITING_BACKUP_DOCUMENT_BYTES,
  fileBytes: EDITING_BACKUP_FILE_BYTES,
  key,
  pair,
  encode: encodeProposalEditingDraft,
  summary,
  readBudget: backupReadBudget,
  parseDocument: parseEditingBackupDocument,
  documentJson: editingBackupDocumentJson,
  parseFile: parseEditingBackupFile,
  fileJson: editingBackupFileJson,
});
type EditingBackupState = 'missing' | 'same' | 'different';
export interface EditingBackupComparison {
  entries: Array<{ request_key: string; title: string; state: EditingBackupState }>;
  missing: number;
  same: number;
  different: number;
  can_restore: boolean;
}
export interface EditingBackupRestoreResult {
  total: number;
  added: number;
  already_present: number;
}
function backupEntries(input: EditingBackupDocument) {
  const document = parseEditingBackupDocument(input);
  return document.entries.map((draft) => ({
    draft,
    slot: key(document.binding, draft.request_key),
    raw: encodeProposalEditingDraft(draft),
    index: JSON.stringify(summary(draft)),
  }));
}
function backupEntryState(
  item: ReturnType<typeof backupEntries>[number],
  raw: unknown,
  index: unknown,
  exists: boolean,
): EditingBackupState {
  if (!exists) return 'missing';
  pair(raw, index, item.draft.binding, item.slot);
  return raw === item.raw && index === item.index ? 'same' : 'different';
}
function backupComparison(entries: EditingBackupComparison['entries']): EditingBackupComparison {
  const missing = entries.filter((entry) => entry.state === 'missing').length;
  const same = entries.filter((entry) => entry.state === 'same').length;
  const different = entries.filter((entry) => entry.state === 'different').length;
  return { entries, missing, same, different, can_restore: different === 0 };
}
/** Advisory only. Damaged/partial targets reject the entire comparison. */
export function compareEditingBackup(
  input: EditingBackupDocument,
  signal: AbortSignal,
  check: () => void,
) {
  check();
  const prepared = backupEntries(input);
  check();
  if (!prepared.length) return Promise.resolve(backupComparison([]));
  return inBrowserStores<EditingBackupComparison>(
    layout,
    'readonly',
    signal,
    () =>
      backupComparison(
        prepared.map(({ draft }) => ({
          request_key: draft.request_key,
          title: draft.fields.values.title,
          state: 'missing' as const,
        })),
      ),
    (context) => {
      const entries: EditingBackupComparison['entries'] = [];
      const account = backupReadBudget();
      const next = () => {
        check();
        const item = prepared[entries.length];
        if (!item) {
          context.accept(backupComparison(entries));
          return;
        }
        readBrowserPair(context, item.slot, (raw, index, exists) => {
          if (exists) account(raw, index);
          entries.push({
            request_key: item.draft.request_key,
            title: item.draft.fields.values.title,
            state: backupEntryState(item, raw, index, exists),
          });
          next();
        });
      };
      next();
    },
  );
}
/** Complete preflight, missing-only writes and full readback share one transaction. */
export function restoreEditingBackup(
  input: EditingBackupDocument,
  signal: AbortSignal,
  check: () => void,
) {
  check();
  const prepared = backupEntries(input);
  check();
  if (!prepared.length) return Promise.resolve({ total: 0, added: 0, already_present: 0 });
  return inBrowserStores<EditingBackupRestoreResult>(
    layout,
    'readwrite',
    signal,
    () => {
      throw new TypeError();
    },
    (context) => {
      const missing: typeof prepared = [];
      const preflightBudget = backupReadBudget();
      const verificationBudget = backupReadBudget();
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
          if (backupEntryState(item, raw, index, exists) !== 'same') throw new TypeError();
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
          // All adds are queued before readback; any failure aborts every write.
          verify();
          return;
        }
        readBrowserPair(context, item.slot, (raw, index, exists) => {
          if (exists) preflightBudget(raw, index);
          const state = backupEntryState(item, raw, index, exists);
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
