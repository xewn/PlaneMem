'use client';

import { backupHash, backupOperation } from '../sync/receipt/backup-operation';
import { assertProposalSubmissionBinding, type ProposalSubmissionBinding } from './original-model';
import {
  REVIEW_HISTORY_BACKUP_FILE_BYTES,
  reviewHistoryBackupDocumentJson,
  reviewHistoryBackupFileJson,
  parseReviewHistoryBackupFile,
  type ReviewHistoryBackupFile,
} from './review-history-backup-model';
import {
  compareReviewHistoryBackup,
  readReviewHistoryBackup,
  restoreReviewHistoryBackup,
  verifyReviewHistoryBackup,
} from './review-history-store';

export interface ReviewHistoryBackupCandidate {
  file: ReviewHistoryBackupFile;
  raw: string;
}
async function inspect(
  raw: string,
  binding: ProposalSubmissionBinding,
  check: () => void,
): Promise<ReviewHistoryBackupCandidate> {
  check();
  if (
    !raw ||
    raw.length > REVIEW_HISTORY_BACKUP_FILE_BYTES ||
    new TextEncoder().encode(raw).byteLength > REVIEW_HISTORY_BACKUP_FILE_BYTES
  )
    throw new TypeError();
  const file = parseReviewHistoryBackupFile(JSON.parse(raw.replace(/^\uFEFF/, '')));
  assertProposalSubmissionBinding(file.document.binding, binding);
  const digest = await backupHash(reviewHistoryBackupDocumentJson(file.document));
  check();
  if (digest !== file.document_sha256) throw new TypeError('History backup checksum differs');
  await verifyReviewHistoryBackup(file.document, check);
  check();
  return { file, raw: reviewHistoryBackupFileJson(file) };
}
export function prepareReviewHistoryArchive(
  binding: ProposalSubmissionBinding,
  signal: AbortSignal,
) {
  return backupOperation(signal, async (operationSignal, check) => {
    const document = await readReviewHistoryBackup(binding, operationSignal, check);
    check();
    const document_sha256 = await backupHash(reviewHistoryBackupDocumentJson(document));
    check();
    const file = parseReviewHistoryBackupFile({ document, document_sha256 });
    return { file, raw: reviewHistoryBackupFileJson(file) };
  });
}
export function loadReviewHistoryArchive(
  source: File,
  binding: ProposalSubmissionBinding,
  signal: AbortSignal,
) {
  return backupOperation(signal, async (_operationSignal, check) => {
    if (source.size < 1 || source.size > REVIEW_HISTORY_BACKUP_FILE_BYTES) throw new TypeError();
    const bytes = await source.arrayBuffer();
    check();
    if (bytes.byteLength !== source.size || bytes.byteLength > REVIEW_HISTORY_BACKUP_FILE_BYTES)
      throw new TypeError();
    return inspect(new TextDecoder('utf-8', { fatal: true }).decode(bytes), binding, check);
  });
}
export function inspectReviewHistoryArchive(
  raw: string,
  binding: ProposalSubmissionBinding,
  signal: AbortSignal,
) {
  return backupOperation(signal, (_operationSignal, check) => inspect(raw, binding, check));
}
export function compareReviewHistoryArchive(
  raw: string,
  binding: ProposalSubmissionBinding,
  signal: AbortSignal,
) {
  return backupOperation(signal, async (operationSignal, check) => {
    const reviewed = await inspect(raw, binding, check);
    check();
    const comparison = await compareReviewHistoryBackup(
      reviewed.file.document,
      operationSignal,
      check,
    );
    check();
    return { ...reviewed, comparison };
  });
}
export function restoreReviewHistoryArchive(
  raw: string,
  binding: ProposalSubmissionBinding,
  reviewedDigest: string,
  signal: AbortSignal,
) {
  return backupOperation(signal, async (operationSignal, check) => {
    const reviewed = await inspect(raw, binding, check);
    if (reviewed.file.document_sha256 !== reviewedDigest) throw new TypeError();
    check();
    const result = await restoreReviewHistoryBackup(reviewed.file.document, operationSignal, check);
    check();
    return result;
  });
}
