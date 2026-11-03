import { proposalReceiptJson, syncJsonSnapshot } from '@planemem/contracts';
import { parseReviewOriginal, type ProposalReviewOriginal } from './review-model';
import {
  assertProposalSubmissionBinding,
  parseProposalSubmissionBinding,
  proposalOriginalStorageKey,
  type ProposalSubmissionBinding,
} from './original-model';

export const REVIEW_BACKUP_MAX_ENTRIES = 100;
export const REVIEW_BACKUP_DOCUMENT_BYTES = 4 * 1024 * 1024;
export const REVIEW_BACKUP_FILE_BYTES = REVIEW_BACKUP_DOCUMENT_BYTES + 1024;
export interface ReviewBackupDocument {
  schema_version: 1;
  kind: 'proposal-review-originals-backup';
  binding: ProposalSubmissionBinding;
  entries: ProposalReviewOriginal[];
}
export interface ReviewBackupFile {
  document: ReviewBackupDocument;
  document_sha256: string;
}
function object(value: unknown, fields: string[]) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError();
  const row = value as Record<string, unknown>;
  if (Object.keys(row).length !== fields.length || fields.some((key) => !Object.hasOwn(row, key)))
    throw new TypeError('Use a complete original review backup');
  return row;
}
export function parseReviewBackupDocument(value: unknown): ReviewBackupDocument {
  const row = object(JSON.parse(syncJsonSnapshot(value, REVIEW_BACKUP_DOCUMENT_BYTES)), [
    'schema_version',
    'kind',
    'binding',
    'entries',
  ]);
  if (
    row.schema_version !== 1 ||
    row.kind !== 'proposal-review-originals-backup' ||
    !Array.isArray(row.entries) ||
    row.entries.length > REVIEW_BACKUP_MAX_ENTRIES
  )
    throw new TypeError('Use a complete review backup with at most 100 original reviews');
  const binding = parseProposalSubmissionBinding(row.binding);
  if (proposalReceiptJson(binding) !== proposalReceiptJson(row.binding)) throw new TypeError();
  if (new TextEncoder().encode(proposalOriginalStorageKey(binding, 'a')).byteLength > 16384)
    throw new TypeError();
  let previous: string | undefined;
  const entries = row.entries.map((entry: unknown) => {
    const original = parseReviewOriginal(entry);
    assertProposalSubmissionBinding(original.binding, binding);
    const slot = proposalOriginalStorageKey(binding, original.request_key);
    if (
      (previous !== undefined && slot <= previous) ||
      new TextEncoder().encode(slot).byteLength > 16384
    )
      throw new TypeError('Duplicate, unsorted or oversized original review key');
    previous = slot;
    return original;
  });
  const result: ReviewBackupDocument = {
    schema_version: 1,
    kind: 'proposal-review-originals-backup',
    binding,
    entries,
  };
  proposalReceiptJson(result, REVIEW_BACKUP_DOCUMENT_BYTES);
  return result;
}
/** Fixed v1 canonical encoding includes the complete scope, fields and review decisions. */
export function reviewBackupDocumentJson(value: unknown) {
  return proposalReceiptJson(parseReviewBackupDocument(value), REVIEW_BACKUP_DOCUMENT_BYTES);
}
export function parseReviewBackupFile(value: unknown): ReviewBackupFile {
  const row = object(JSON.parse(syncJsonSnapshot(value, REVIEW_BACKUP_FILE_BYTES)), [
    'document',
    'document_sha256',
  ]);
  if (typeof row.document_sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(row.document_sha256))
    throw new TypeError('Invalid review backup checksum');
  return {
    document: parseReviewBackupDocument(row.document),
    document_sha256: row.document_sha256,
  };
}
export function reviewBackupFileJson(value: unknown) {
  return proposalReceiptJson(parseReviewBackupFile(value), REVIEW_BACKUP_FILE_BYTES);
}
