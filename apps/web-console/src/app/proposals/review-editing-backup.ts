'use client';

import { backupHash, backupOperation } from '../sync/receipt/backup-operation';
import { assertProposalSubmissionBinding, type ProposalSubmissionBinding } from './original-model';
import {
  REVIEW_EDITING_BACKUP_FILE_BYTES,
  reviewEditingBackupDocumentJson,
  reviewEditingBackupFileJson,
  parseReviewEditingBackupFile,
  type ReviewEditingBackupFile,
} from './review-editing-backup-model';
import {
  compareReviewEditingBackup,
  readReviewEditingBackup,
  restoreReviewEditingBackup,
} from './review-editing-store';

export interface ReviewEditingBackupCandidate {
  file: ReviewEditingBackupFile;
  raw: string;
}
async function inspect(
  raw: string,
  binding: ProposalSubmissionBinding,
  check: () => void,
): Promise<ReviewEditingBackupCandidate> {
  check();
  if (
    !raw ||
    raw.length > REVIEW_EDITING_BACKUP_FILE_BYTES ||
    new TextEncoder().encode(raw).byteLength > REVIEW_EDITING_BACKUP_FILE_BYTES
  )
    throw new TypeError();
  const file = parseReviewEditingBackupFile(JSON.parse(raw.replace(/^\uFEFF/, '')));
  assertProposalSubmissionBinding(file.document.binding, binding);
  const digest = await backupHash(reviewEditingBackupDocumentJson(file.document));
  check();
  if (digest !== file.document_sha256) throw new TypeError('Review backup checksum differs');
  return { file, raw: reviewEditingBackupFileJson(file) };
}
export function prepareReviewEditingDraftsBackup(
  binding: ProposalSubmissionBinding,
  signal: AbortSignal,
) {
  return backupOperation(signal, async (operationSignal, check) => {
    const document = await readReviewEditingBackup(binding, operationSignal, check);
    check();
    const document_sha256 = await backupHash(reviewEditingBackupDocumentJson(document));
    check();
    const file = parseReviewEditingBackupFile({ document, document_sha256 });
    return { file, raw: reviewEditingBackupFileJson(file) };
  });
}
export function loadReviewEditingDraftsBackup(
  source: File,
  binding: ProposalSubmissionBinding,
  signal: AbortSignal,
) {
  return backupOperation(signal, async (_operationSignal, check) => {
    if (source.size < 1 || source.size > REVIEW_EDITING_BACKUP_FILE_BYTES) throw new TypeError();
    const bytes = await source.arrayBuffer();
    check();
    if (bytes.byteLength !== source.size || bytes.byteLength > REVIEW_EDITING_BACKUP_FILE_BYTES)
      throw new TypeError();
    return inspect(new TextDecoder('utf-8', { fatal: true }).decode(bytes), binding, check);
  });
}
export function compareReviewEditingDraftsBackup(
  raw: string,
  binding: ProposalSubmissionBinding,
  signal: AbortSignal,
) {
  return backupOperation(signal, async (operationSignal, check) => {
    const reviewed = await inspect(raw, binding, check);
    check();
    const comparison = await compareReviewEditingBackup(
      reviewed.file.document,
      operationSignal,
      check,
    );
    check();
    return { ...reviewed, comparison };
  });
}
export function restoreReviewEditingDraftsBackup(
  raw: string,
  binding: ProposalSubmissionBinding,
  reviewedDigest: string,
  signal: AbortSignal,
) {
  return backupOperation(signal, async (operationSignal, check) => {
    const reviewed = await inspect(raw, binding, check);
    if (reviewed.file.document_sha256 !== reviewedDigest) throw new TypeError();
    check();
    const result = await restoreReviewEditingBackup(reviewed.file.document, operationSignal, check);
    check();
    return result;
  });
}
