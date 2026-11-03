import { proposalReceiptJson, syncJsonSnapshot } from '@planemem/contracts';
import { parseReviewEditingDraft, type ReviewEditingDraft } from './review-editing-model';
import {
  assertProposalSubmissionBinding,
  parseProposalSubmissionBinding,
  proposalOriginalStorageKey,
  type ProposalSubmissionBinding,
} from './original-model';

export const REVIEW_EDITING_BACKUP_MAX_ENTRIES = 100;
export const REVIEW_EDITING_BACKUP_DOCUMENT_BYTES = 4 * 1024 * 1024;
export const REVIEW_EDITING_BACKUP_FILE_BYTES = REVIEW_EDITING_BACKUP_DOCUMENT_BYTES + 1024;
export interface ReviewEditingBackupDocument {
  schema_version: 1;
  kind: 'proposal-review-editing-drafts-backup';
  binding: ProposalSubmissionBinding;
  entries: ReviewEditingDraft[];
}
export interface ReviewEditingBackupFile {
  document: ReviewEditingBackupDocument;
  document_sha256: string;
}
function object(value: unknown, fields: string[]) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError();
  const row = value as Record<string, unknown>;
  if (Object.keys(row).length !== fields.length || fields.some((key) => !Object.hasOwn(row, key)))
    throw new TypeError('Use a complete review editing draft backup');
  return row;
}
export function parseReviewEditingBackupDocument(value: unknown): ReviewEditingBackupDocument {
  const row = object(JSON.parse(syncJsonSnapshot(value, REVIEW_EDITING_BACKUP_DOCUMENT_BYTES)), [
    'schema_version',
    'kind',
    'binding',
    'entries',
  ]);
  if (
    row.schema_version !== 1 ||
    row.kind !== 'proposal-review-editing-drafts-backup' ||
    !Array.isArray(row.entries) ||
    row.entries.length > REVIEW_EDITING_BACKUP_MAX_ENTRIES
  )
    throw new TypeError('Use a complete review backup with at most 100 review editing drafts');
  const binding = parseProposalSubmissionBinding(row.binding);
  if (proposalReceiptJson(binding) !== proposalReceiptJson(row.binding)) throw new TypeError();
  if (new TextEncoder().encode(proposalOriginalStorageKey(binding, 'a')).byteLength > 16384)
    throw new TypeError();
  let previous: string | undefined;
  const entries = row.entries.map((entry: unknown) => {
    const draft = parseReviewEditingDraft(entry);
    assertProposalSubmissionBinding(draft.binding, binding);
    const slot = proposalOriginalStorageKey(binding, draft.request_key);
    if (
      (previous !== undefined && slot <= previous) ||
      new TextEncoder().encode(slot).byteLength > 16384
    )
      throw new TypeError('Duplicate, unsorted or oversized review editing draft key');
    previous = slot;
    return draft;
  });
  const result: ReviewEditingBackupDocument = {
    schema_version: 1,
    kind: 'proposal-review-editing-drafts-backup',
    binding,
    entries,
  };
  proposalReceiptJson(result, REVIEW_EDITING_BACKUP_DOCUMENT_BYTES);
  return result;
}
/** Fixed v1 canonical encoding includes the complete scope, raw input and save times. */
export function reviewEditingBackupDocumentJson(value: unknown) {
  return proposalReceiptJson(
    parseReviewEditingBackupDocument(value),
    REVIEW_EDITING_BACKUP_DOCUMENT_BYTES,
  );
}
export function parseReviewEditingBackupFile(value: unknown): ReviewEditingBackupFile {
  const row = object(JSON.parse(syncJsonSnapshot(value, REVIEW_EDITING_BACKUP_FILE_BYTES)), [
    'document',
    'document_sha256',
  ]);
  if (typeof row.document_sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(row.document_sha256))
    throw new TypeError('Invalid review backup checksum');
  return {
    document: parseReviewEditingBackupDocument(row.document),
    document_sha256: row.document_sha256,
  };
}
export function reviewEditingBackupFileJson(value: unknown) {
  return proposalReceiptJson(parseReviewEditingBackupFile(value), REVIEW_EDITING_BACKUP_FILE_BYTES);
}
