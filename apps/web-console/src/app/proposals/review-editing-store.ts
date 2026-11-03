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
  decodeReviewEditingDraft,
  encodeReviewEditingDraft,
  REVIEW_EDITING_BYTES,
  type ReviewEditingDraft,
} from './review-editing-model';
import {
  REVIEW_EDITING_BACKUP_DOCUMENT_BYTES,
  REVIEW_EDITING_BACKUP_FILE_BYTES,
  REVIEW_EDITING_BACKUP_MAX_ENTRIES,
  reviewEditingBackupDocumentJson,
  reviewEditingBackupFileJson,
  parseReviewEditingBackupFile,
  parseReviewEditingBackupDocument,
  type ReviewEditingBackupDocument,
} from './review-editing-backup-model';
import { createManualDraftCleanup } from './manual-draft-cleanup';

const layout = { databaseName: 'planemem-proposal-review-editing-drafts', contentStore: 'drafts' };
const summary = (draft: ReviewEditingDraft) => ({
  request_key: draft.request_key,
  saved_at: draft.saved_at,
  proposal_id: draft.proposal_id,
  expected_revision: draft.expected_revision,
  decision: draft.decision,
});
export type ReviewEditingSummary = ReturnType<typeof summary>;
export interface ReviewEditingPage {
  entries: ReviewEditingSummary[];
  next: string | null;
}
function key(binding: ProposalSubmissionBinding, requestKey: string) {
  const slot = proposalOriginalStorageKey(binding, requestKey);
  if (new TextEncoder().encode(slot).byteLength > 16384) throw new TypeError();
  return slot;
}
function pair(raw: unknown, index: unknown, binding: ProposalSubmissionBinding, slot: string) {
  if (
    typeof index !== 'string' ||
    index.length > 4096 ||
    new TextEncoder().encode(index).byteLength > 4096
  )
    throw new TypeError();
  const draft = decodeReviewEditingDraft(raw);
  assertProposalSubmissionBinding(draft.binding, binding);
  if (
    encodeReviewEditingDraft(draft) !== raw ||
    key(binding, draft.request_key) !== slot ||
    JSON.stringify(summary(draft)) !== index
  )
    throw new TypeError();
  return draft;
}
export function saveReviewEditingDraft(input: ReviewEditingDraft, signal: AbortSignal) {
  const raw = encodeReviewEditingDraft(input);
  const draft = decodeReviewEditingDraft(raw);
  const slot = key(draft.binding, draft.request_key);
  return inBrowserStores<ReviewEditingDraft>(
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
          if (encodeReviewEditingDraft({ ...draft, saved_at: saved.saved_at }) !== old)
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
export function loadReviewEditingDraft(
  input: ProposalSubmissionBinding,
  requestKey: string,
  signal: AbortSignal,
  selection?: ReviewEditingSummary,
) {
  const binding = parseProposalSubmissionBinding(input);
  const slot = key(binding, requestKey);
  const expected = selection ? JSON.stringify(selection) : undefined;
  return inBrowserStores<ReviewEditingDraft | null>(
    layout,
    'readonly',
    signal,
    () => null,
    (context) => {
      readBrowserPair(context, slot, (raw, index, exists) => {
        if (!exists) {
          context.accept(null);
          return;
        }
        if (expected !== undefined && expected !== index) throw new TypeError();
        context.accept(pair(raw, index, binding, slot));
      });
    },
  );
}
/** Remove only the complete inspected pair, including its original save time. */
export function removeReviewEditingDraft(
  input: ProposalSubmissionBinding,
  reviewed: ReviewEditingDraft,
  signal: AbortSignal,
) {
  const binding = parseProposalSubmissionBinding(input);
  const expectedRaw = encodeReviewEditingDraft(reviewed);
  const draft = decodeReviewEditingDraft(expectedRaw);
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

export function listReviewEditingDrafts(
  input: ProposalSubmissionBinding,
  after: string | null,
  signal: AbortSignal,
) {
  const binding = parseProposalSubmissionBinding(input);
  key(binding, 'a');
  const prefix = proposalOriginalStoragePrefix(binding);
  return inBrowserStores<ReviewEditingPage>(
    layout,
    'readonly',
    signal,
    () => ({ entries: [], next: null }),
    (context) => {
      const entries: ReviewEditingSummary[] = [];
      const request = context.directory.openCursor(
        IDBKeyRange.bound(
          after === null ? prefix : key(binding, after),
          prefix + '\uffff',
          after !== null,
          true,
        ),
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
          context.accept({ entries, next: entries[19]!.request_key });
          return;
        }
        const slot = cursor.primaryKey;
        readBrowserPair(context, slot, (raw, index, exists) => {
          if (!exists) throw new TypeError();
          entries.push(summary(pair(raw, index, binding, slot)));
          cursor.continue();
        });
      });
    },
  );
}

/** Count both stores and verify every pair in a single scoped snapshot; never truncate. */
export function readReviewEditingBackup(
  bindingInput: ProposalSubmissionBinding,
  signal: AbortSignal,
  check: () => void,
) {
  check();
  const binding = parseProposalSubmissionBinding(bindingInput);
  key(binding, 'a');
  const prefix = proposalOriginalStoragePrefix(binding);
  const empty = (): ReviewEditingBackupDocument => ({
    schema_version: 1,
    kind: 'proposal-review-editing-drafts-backup',
    binding,
    entries: [],
  });
  return inBrowserStores<ReviewEditingBackupDocument>(
    layout,
    'readonly',
    signal,
    empty,
    (context) => {
      const range = IDBKeyRange.bound(prefix, prefix + '\uffff', false, true);
      const drafts = context.content.count(range);
      const directory = context.directory.count(range);
      directory.onsuccess = context.guard(() => {
        check();
        const count = drafts.result;
        if (
          !Number.isSafeInteger(count) ||
          count < 0 ||
          count > REVIEW_EDITING_BACKUP_MAX_ENTRIES ||
          directory.result !== count
        )
          throw new TypeError();
        const entries: ReviewEditingDraft[] = [];
        const account = backupReadBudget();
        const request = context.content.openKeyCursor(range);
        request.onsuccess = context.guard(() => {
          check();
          const cursor = request.result;
          if (!cursor) {
            if (entries.length !== count) throw new TypeError();
            context.accept(parseReviewEditingBackupDocument({ ...empty(), entries }));
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
    },
  );
}

/** Bounds parsed target content per complete pass, even when it differs from the source. */
function backupReadBudget() {
  let bytes = 0;
  return (raw: unknown, index: unknown) => {
    if (
      typeof raw !== 'string' ||
      raw.length > REVIEW_EDITING_BYTES ||
      typeof index !== 'string' ||
      index.length > 4096
    )
      throw new TypeError();
    const size = new TextEncoder().encode(raw).byteLength;
    if (size > REVIEW_EDITING_BYTES || new TextEncoder().encode(index).byteLength > 4096)
      throw new TypeError();
    bytes += size;
    if (bytes > REVIEW_EDITING_BACKUP_DOCUMENT_BYTES) throw new TypeError();
  };
}
export const reviewEditingDraftCleanup = createManualDraftCleanup<
  ReviewEditingDraft,
  ReviewEditingSummary,
  ReviewEditingBackupDocument
>({
  layout,
  kind: 'proposal-review-editing-drafts-backup',
  documentBytes: REVIEW_EDITING_BACKUP_DOCUMENT_BYTES,
  fileBytes: REVIEW_EDITING_BACKUP_FILE_BYTES,
  key,
  pair,
  encode: encodeReviewEditingDraft,
  summary,
  readBudget: backupReadBudget,
  parseDocument: parseReviewEditingBackupDocument,
  documentJson: reviewEditingBackupDocumentJson,
  parseFile: parseReviewEditingBackupFile,
  fileJson: reviewEditingBackupFileJson,
});
type ReviewEditingBackupState = 'missing' | 'same' | 'different';
export interface ReviewEditingBackupComparison {
  entries: Array<{
    request_key: string;
    saved_at: string;
    proposal_id: string;
    decision: ReviewEditingDraft['decision'];
    expected_revision: number;
    state: ReviewEditingBackupState;
  }>;
  missing: number;
  same: number;
  different: number;
  can_restore: boolean;
}
export interface ReviewEditingBackupRestoreResult {
  total: number;
  added: number;
  already_present: number;
}
function backupEntries(input: ReviewEditingBackupDocument) {
  const document = parseReviewEditingBackupDocument(input);
  return document.entries.map((draft) => ({
    draft,
    slot: key(document.binding, draft.request_key),
    raw: encodeReviewEditingDraft(draft),
    index: JSON.stringify(summary(draft)),
  }));
}
function backupEntryState(
  item: ReturnType<typeof backupEntries>[number],
  raw: unknown,
  index: unknown,
  exists: boolean,
): ReviewEditingBackupState {
  if (!exists) return 'missing';
  pair(raw, index, item.draft.binding, item.slot);
  return raw === item.raw && index === item.index ? 'same' : 'different';
}
function backupComparison(
  entries: ReviewEditingBackupComparison['entries'],
): ReviewEditingBackupComparison {
  const missing = entries.filter((entry) => entry.state === 'missing').length;
  const same = entries.filter((entry) => entry.state === 'same').length;
  const different = entries.filter((entry) => entry.state === 'different').length;
  return { entries, missing, same, different, can_restore: different === 0 };
}
/** Advisory only. Damaged/partial targets reject the entire comparison. */
export function compareReviewEditingBackup(
  input: ReviewEditingBackupDocument,
  signal: AbortSignal,
  check: () => void,
) {
  check();
  const prepared = backupEntries(input);
  check();
  if (!prepared.length) return Promise.resolve(backupComparison([]));
  return inBrowserStores<ReviewEditingBackupComparison>(
    layout,
    'readonly',
    signal,
    () =>
      backupComparison(
        prepared.map(({ draft }) => ({
          request_key: draft.request_key,
          saved_at: draft.saved_at,
          proposal_id: draft.proposal_id,
          decision: draft.decision,
          expected_revision: draft.expected_revision,
          state: 'missing' as const,
        })),
      ),
    (context) => {
      const entries: ReviewEditingBackupComparison['entries'] = [];
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
            saved_at: item.draft.saved_at,
            proposal_id: item.draft.proposal_id,
            decision: item.draft.decision,
            expected_revision: item.draft.expected_revision,
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
export function restoreReviewEditingBackup(
  input: ReviewEditingBackupDocument,
  signal: AbortSignal,
  check: () => void,
) {
  check();
  const prepared = backupEntries(input);
  check();
  if (!prepared.length) return Promise.resolve({ total: 0, added: 0, already_present: 0 });
  return inBrowserStores<ReviewEditingBackupRestoreResult>(
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
