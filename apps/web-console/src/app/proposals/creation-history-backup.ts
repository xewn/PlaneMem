'use client';

import { backupHash, backupOperation } from '../sync/receipt/backup-operation';
import { assertProposalSubmissionBinding, type ProposalSubmissionBinding } from './original-model';
import {
  CREATION_HISTORY_BACKUP_FILE_BYTES,
  creationHistoryBackupDocumentJson,
  creationHistoryBackupFileJson,
  parseCreationHistoryBackupFile,
  type CreationHistoryBackupFile,
} from './creation-history-backup-model';
import {
  compareCreationHistoryBackup,
  readCreationHistoryBackup,
  restoreCreationHistoryBackup,
  verifyCreationHistoryBackup,
} from './creation-history-store';

export interface CreationHistoryBackupCandidate {
  file: CreationHistoryBackupFile;
  raw: string;
}
async function inspect(
  raw: string,
  binding: ProposalSubmissionBinding,
  check: () => void,
): Promise<CreationHistoryBackupCandidate> {
  check();
  if (
    !raw ||
    raw.length > CREATION_HISTORY_BACKUP_FILE_BYTES ||
    new TextEncoder().encode(raw).byteLength > CREATION_HISTORY_BACKUP_FILE_BYTES
  )
    throw new TypeError();
  const file = parseCreationHistoryBackupFile(JSON.parse(raw.replace(/^\uFEFF/, '')));
  assertProposalSubmissionBinding(file.document.binding, binding);
  const digest = await backupHash(creationHistoryBackupDocumentJson(file.document));
  check();
  if (digest !== file.document_sha256) throw new TypeError('History backup checksum differs');
  await verifyCreationHistoryBackup(file.document, check);
  check();
  return { file, raw: creationHistoryBackupFileJson(file) };
}
export function prepareCreationHistoryArchive(
  binding: ProposalSubmissionBinding,
  signal: AbortSignal,
) {
  return backupOperation(signal, async (operationSignal, check) => {
    const document = await readCreationHistoryBackup(binding, operationSignal, check);
    check();
    const document_sha256 = await backupHash(creationHistoryBackupDocumentJson(document));
    check();
    const file = parseCreationHistoryBackupFile({ document, document_sha256 });
    return { file, raw: creationHistoryBackupFileJson(file) };
  });
}
export function loadCreationHistoryArchive(
  source: File,
  binding: ProposalSubmissionBinding,
  signal: AbortSignal,
) {
  return backupOperation(signal, async (_operationSignal, check) => {
    if (source.size < 1 || source.size > CREATION_HISTORY_BACKUP_FILE_BYTES) throw new TypeError();
    const bytes = await source.arrayBuffer();
    check();
    if (bytes.byteLength !== source.size || bytes.byteLength > CREATION_HISTORY_BACKUP_FILE_BYTES)
      throw new TypeError();
    return inspect(new TextDecoder('utf-8', { fatal: true }).decode(bytes), binding, check);
  });
}
export function inspectCreationHistoryArchive(
  raw: string,
  binding: ProposalSubmissionBinding,
  signal: AbortSignal,
) {
  return backupOperation(signal, (_operationSignal, check) => inspect(raw, binding, check));
}
export function compareCreationHistoryArchive(
  raw: string,
  binding: ProposalSubmissionBinding,
  signal: AbortSignal,
) {
  return backupOperation(signal, async (operationSignal, check) => {
    const reviewed = await inspect(raw, binding, check);
    check();
    const comparison = await compareCreationHistoryBackup(
      reviewed.file.document,
      operationSignal,
      check,
    );
    check();
    return { ...reviewed, comparison };
  });
}
export function restoreCreationHistoryArchive(
  raw: string,
  binding: ProposalSubmissionBinding,
  reviewedDigest: string,
  signal: AbortSignal,
) {
  return backupOperation(signal, async (operationSignal, check) => {
    const reviewed = await inspect(raw, binding, check);
    if (reviewed.file.document_sha256 !== reviewedDigest) throw new TypeError();
    check();
    const result = await restoreCreationHistoryBackup(
      reviewed.file.document,
      operationSignal,
      check,
    );
    check();
    return result;
  });
}
