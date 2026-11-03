'use client';

import { backupHash, backupOperation } from '../sync/receipt/backup-operation';
import {
  parseProposalBackupFile,
  proposalBackupDocumentJson,
  proposalBackupFileJson,
  PROPOSAL_BACKUP_FILE_BYTES,
  type ProposalBackupFile,
} from './backup-model';
import { assertProposalSubmissionBinding, type ProposalSubmissionBinding } from './original-model';
import {
  previewBrowserProposalBackup,
  readBrowserProposalBackup,
  restoreBrowserProposalBackup,
} from './original-store';

export interface ReviewedProposalBackup {
  file: ProposalBackupFile;
  raw: string;
}
function unavailable() {
  return new Error('The complete proposal backup could not be verified. Keep the original file.');
}
async function inspect(
  raw: string,
  binding: ProposalSubmissionBinding,
  check: () => void,
): Promise<ReviewedProposalBackup> {
  check();
  if (
    !raw ||
    raw.length > PROPOSAL_BACKUP_FILE_BYTES ||
    new TextEncoder().encode(raw).byteLength > PROPOSAL_BACKUP_FILE_BYTES
  )
    throw unavailable();
  const file = parseProposalBackupFile(JSON.parse(raw.replace(/^\uFEFF/, '')) as unknown);
  assertProposalSubmissionBinding(file.document.binding, binding);
  const digest = await backupHash(proposalBackupDocumentJson(file.document));
  check();
  if (digest !== file.document_sha256) throw unavailable();
  return { file, raw: proposalBackupFileJson(file) };
}
export function prepareProposalBackup(binding: ProposalSubmissionBinding, signal: AbortSignal) {
  return backupOperation(signal, async (operationSignal, check) => {
    const document = await readBrowserProposalBackup(binding, operationSignal);
    check();
    const document_sha256 = await backupHash(proposalBackupDocumentJson(document));
    check();
    const file = parseProposalBackupFile({ document, document_sha256 });
    return { file, raw: proposalBackupFileJson(file) };
  });
}
export function loadProposalBackup(
  source: File,
  binding: ProposalSubmissionBinding,
  signal: AbortSignal,
) {
  return backupOperation(signal, async (_operationSignal, check) => {
    if (source.size < 1 || source.size > PROPOSAL_BACKUP_FILE_BYTES) throw unavailable();
    const bytes = await source.arrayBuffer();
    check();
    if (bytes.byteLength !== source.size || bytes.byteLength > PROPOSAL_BACKUP_FILE_BYTES)
      throw unavailable();
    return inspect(new TextDecoder('utf-8', { fatal: true }).decode(bytes), binding, check);
  });
}
export function previewProposalBackup(
  raw: string,
  binding: ProposalSubmissionBinding,
  signal: AbortSignal,
) {
  return backupOperation(signal, async (operationSignal, check) => {
    const reviewed = await inspect(raw, binding, check);
    check();
    const comparison = await previewBrowserProposalBackup(
      reviewed.file.document,
      operationSignal,
      check,
    );
    check();
    return { ...reviewed, comparison };
  });
}
export function restoreProposalBackup(
  raw: string,
  binding: ProposalSubmissionBinding,
  reviewedDigest: string,
  signal: AbortSignal,
) {
  return backupOperation(signal, async (operationSignal, check) => {
    const reviewed = await inspect(raw, binding, check);
    if (reviewed.file.document_sha256 !== reviewedDigest) throw unavailable();
    check();
    const result = await restoreBrowserProposalBackup(
      reviewed.file.document,
      operationSignal,
      check,
    );
    check();
    return result;
  });
}
