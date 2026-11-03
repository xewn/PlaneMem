'use client';

import { backupHash, backupOperation } from '../sync/receipt/backup-operation';
import { assertProposalSubmissionBinding, type ProposalSubmissionBinding } from './original-model';
import {
  REVIEW_BACKUP_FILE_BYTES,
  reviewBackupDocumentJson,
  reviewBackupFileJson,
  parseReviewBackupFile,
  type ReviewBackupFile,
} from './review-backup-model';
import { compareReviewBackup, readReviewBackup, restoreReviewBackup } from './review-store';

export interface ReviewBackupCandidate {
  file: ReviewBackupFile;
  raw: string;
}
async function inspect(
  raw: string,
  binding: ProposalSubmissionBinding,
  check: () => void,
): Promise<ReviewBackupCandidate> {
  check();
  if (
    !raw ||
    raw.length > REVIEW_BACKUP_FILE_BYTES ||
    new TextEncoder().encode(raw).byteLength > REVIEW_BACKUP_FILE_BYTES
  )
    throw new TypeError();
  const file = parseReviewBackupFile(JSON.parse(raw.replace(/^\uFEFF/, '')));
  assertProposalSubmissionBinding(file.document.binding, binding);
  const digest = await backupHash(reviewBackupDocumentJson(file.document));
  check();
  if (digest !== file.document_sha256) throw new TypeError('Review backup checksum differs');
  return { file, raw: reviewBackupFileJson(file) };
}
export function prepareReviewOriginalsBackup(
  binding: ProposalSubmissionBinding,
  signal: AbortSignal,
) {
  return backupOperation(signal, async (operationSignal, check) => {
    const document = await readReviewBackup(binding, operationSignal, check);
    check();
    const document_sha256 = await backupHash(reviewBackupDocumentJson(document));
    check();
    const file = parseReviewBackupFile({ document, document_sha256 });
    return { file, raw: reviewBackupFileJson(file) };
  });
}
export function loadReviewOriginalsBackup(
  source: File,
  binding: ProposalSubmissionBinding,
  signal: AbortSignal,
) {
  return backupOperation(signal, async (_operationSignal, check) => {
    if (source.size < 1 || source.size > REVIEW_BACKUP_FILE_BYTES) throw new TypeError();
    const bytes = await source.arrayBuffer();
    check();
    if (bytes.byteLength !== source.size || bytes.byteLength > REVIEW_BACKUP_FILE_BYTES)
      throw new TypeError();
    return inspect(new TextDecoder('utf-8', { fatal: true }).decode(bytes), binding, check);
  });
}
export function compareReviewOriginalsBackup(
  raw: string,
  binding: ProposalSubmissionBinding,
  signal: AbortSignal,
) {
  return backupOperation(signal, async (operationSignal, check) => {
    const reviewed = await inspect(raw, binding, check);
    check();
    const comparison = await compareReviewBackup(reviewed.file.document, operationSignal, check);
    check();
    return { ...reviewed, comparison };
  });
}
export function restoreReviewOriginalsBackup(
  raw: string,
  binding: ProposalSubmissionBinding,
  reviewedDigest: string,
  signal: AbortSignal,
) {
  return backupOperation(signal, async (operationSignal, check) => {
    const reviewed = await inspect(raw, binding, check);
    if (reviewed.file.document_sha256 !== reviewedDigest) throw new TypeError();
    check();
    const result = await restoreReviewBackup(reviewed.file.document, operationSignal, check);
    check();
    return result;
  });
}
