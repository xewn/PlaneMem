import { proposalReceiptJson, syncJsonSnapshot } from '@planemem/contracts';
import {
  assertProposalSubmissionBinding,
  parseProposalSubmissionBinding,
  proposalOriginalStorageKey,
  type ProposalSubmissionBinding,
} from './original-model';
import { parseReviewHistoryFile, type ReviewHistoryFile } from './review-history-model';

export const REVIEW_HISTORY_BACKUP_MAX_ENTRIES = 100;
export const REVIEW_HISTORY_BACKUP_DOCUMENT_BYTES = 16 * 1024 * 1024;
export const REVIEW_HISTORY_BACKUP_FILE_BYTES = REVIEW_HISTORY_BACKUP_DOCUMENT_BYTES + 1024;
export interface ReviewHistoryBackupDocument {
  schema_version: 1;
  kind: 'proposal-review-history-backup';
  binding: ProposalSubmissionBinding;
  entries: ReviewHistoryFile[];
}
export interface ReviewHistoryBackupFile {
  document: ReviewHistoryBackupDocument;
  document_sha256: string;
}
function object(value: unknown, fields: string[]) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError();
  const row = value as Record<string, unknown>;
  if (
    Object.keys(row).length !== fields.length ||
    fields.some((field) => !Object.hasOwn(row, field))
  )
    throw new TypeError('Use a complete review history backup');
  return row;
}
/** Structural validation only; adapters also verify every individual and outer digest. */
export function parseReviewHistoryBackupDocument(value: unknown): ReviewHistoryBackupDocument {
  const row = object(JSON.parse(syncJsonSnapshot(value, REVIEW_HISTORY_BACKUP_DOCUMENT_BYTES)), [
    'schema_version',
    'kind',
    'binding',
    'entries',
  ]);
  if (
    row.schema_version !== 1 ||
    row.kind !== 'proposal-review-history-backup' ||
    !Array.isArray(row.entries) ||
    row.entries.length > REVIEW_HISTORY_BACKUP_MAX_ENTRIES
  )
    throw new TypeError('Use a complete backup with at most 100 saved observations');
  const binding = parseProposalSubmissionBinding(row.binding);
  if (proposalReceiptJson(binding) !== proposalReceiptJson(row.binding)) throw new TypeError();
  if (
    new TextEncoder().encode(proposalOriginalStorageKey(binding, '0'.repeat(64))).byteLength > 16384
  )
    throw new TypeError();
  let previous: string | undefined;
  const entries = row.entries.map((entry: unknown) => {
    const file = parseReviewHistoryFile(entry);
    assertProposalSubmissionBinding(file.document.original.binding, binding);
    if (previous !== undefined && file.document_sha256 <= previous)
      throw new TypeError('Duplicate or unsorted observation checksum');
    previous = file.document_sha256;
    return file;
  });
  const result: ReviewHistoryBackupDocument = {
    schema_version: 1,
    kind: 'proposal-review-history-backup',
    binding,
    entries,
  };
  proposalReceiptJson(result, REVIEW_HISTORY_BACKUP_DOCUMENT_BYTES);
  return result;
}
export function reviewHistoryBackupDocumentJson(value: unknown) {
  return proposalReceiptJson(
    parseReviewHistoryBackupDocument(value),
    REVIEW_HISTORY_BACKUP_DOCUMENT_BYTES,
  );
}
export function parseReviewHistoryBackupFile(value: unknown): ReviewHistoryBackupFile {
  const row = object(JSON.parse(syncJsonSnapshot(value, REVIEW_HISTORY_BACKUP_FILE_BYTES)), [
    'document',
    'document_sha256',
  ]);
  if (typeof row.document_sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(row.document_sha256))
    throw new TypeError('Invalid history backup checksum');
  return {
    document: parseReviewHistoryBackupDocument(row.document),
    document_sha256: row.document_sha256,
  };
}
export function reviewHistoryBackupFileJson(value: unknown) {
  return proposalReceiptJson(parseReviewHistoryBackupFile(value), REVIEW_HISTORY_BACKUP_FILE_BYTES);
}
