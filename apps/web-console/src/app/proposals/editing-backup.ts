'use client';

import { backupHash, backupOperation } from '../sync/receipt/backup-operation';
import { assertProposalSubmissionBinding, type ProposalSubmissionBinding } from './original-model';
import {
  EDITING_BACKUP_FILE_BYTES,
  editingBackupDocumentJson,
  editingBackupFileJson,
  parseEditingBackupFile,
  type EditingBackupFile,
} from './editing-backup-model';
import { compareEditingBackup, readEditingBackup, restoreEditingBackup } from './editing-store';

export interface ReviewedEditingBackup {
  file: EditingBackupFile;
  raw: string;
}
async function inspect(
  raw: string,
  binding: ProposalSubmissionBinding,
  check: () => void,
): Promise<ReviewedEditingBackup> {
  check();
  if (
    !raw ||
    raw.length > EDITING_BACKUP_FILE_BYTES ||
    new TextEncoder().encode(raw).byteLength > EDITING_BACKUP_FILE_BYTES
  )
    throw new TypeError();
  const file = parseEditingBackupFile(JSON.parse(raw.replace(/^\uFEFF/, '')));
  assertProposalSubmissionBinding(file.document.binding, binding);
  const digest = await backupHash(editingBackupDocumentJson(file.document));
  check();
  if (digest !== file.document_sha256) throw new TypeError('Editing backup checksum differs');
  return { file, raw: editingBackupFileJson(file) };
}
export function prepareEditingDraftBackup(binding: ProposalSubmissionBinding, signal: AbortSignal) {
  return backupOperation(signal, async (operationSignal, check) => {
    const document = await readEditingBackup(binding, operationSignal, check);
    check();
    const document_sha256 = await backupHash(editingBackupDocumentJson(document));
    check();
    const file = parseEditingBackupFile({ document, document_sha256 });
    return { file, raw: editingBackupFileJson(file) };
  });
}
export function loadEditingDraftBackup(
  source: File,
  binding: ProposalSubmissionBinding,
  signal: AbortSignal,
) {
  return backupOperation(signal, async (_operationSignal, check) => {
    if (source.size < 1 || source.size > EDITING_BACKUP_FILE_BYTES) throw new TypeError();
    const bytes = await source.arrayBuffer();
    check();
    if (bytes.byteLength !== source.size || bytes.byteLength > EDITING_BACKUP_FILE_BYTES)
      throw new TypeError();
    return inspect(new TextDecoder('utf-8', { fatal: true }).decode(bytes), binding, check);
  });
}
export function compareEditingDraftBackup(
  raw: string,
  binding: ProposalSubmissionBinding,
  signal: AbortSignal,
) {
  return backupOperation(signal, async (operationSignal, check) => {
    const reviewed = await inspect(raw, binding, check);
    check();
    const comparison = await compareEditingBackup(reviewed.file.document, operationSignal, check);
    check();
    return { ...reviewed, comparison };
  });
}
export function restoreEditingDraftBackup(
  raw: string,
  binding: ProposalSubmissionBinding,
  reviewedDigest: string,
  signal: AbortSignal,
) {
  return backupOperation(signal, async (operationSignal, check) => {
    const reviewed = await inspect(raw, binding, check);
    if (reviewed.file.document_sha256 !== reviewedDigest) throw new TypeError();
    check();
    const result = await restoreEditingBackup(reviewed.file.document, operationSignal, check);
    check();
    return result;
  });
}
