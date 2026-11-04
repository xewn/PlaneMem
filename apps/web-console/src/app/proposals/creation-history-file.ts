'use client';

import { backupHash } from '../sync/receipt/backup-operation';
import { assertProposalSubmissionBinding, type ProposalSubmissionBinding } from './original-model';
import {
  CREATION_HISTORY_FILE_BYTES,
  creationObservationJson,
  creationHistoryFileJson,
  parseCreationHistoryFile,
  type CreationObservation,
  type CreationHistoryFile,
} from './creation-history-model';

export interface CreationHistoryCandidate {
  file: CreationHistoryFile;
  raw: string;
}
export async function prepareCreationHistory(
  document: CreationObservation,
  check: () => void,
): Promise<CreationHistoryCandidate> {
  check();
  const raw = creationObservationJson(document);
  const document_sha256 = await backupHash(raw);
  check();
  const file = parseCreationHistoryFile({ document: JSON.parse(raw), document_sha256 });
  return { file, raw: creationHistoryFileJson(file) };
}
export async function inspectCreationHistory(
  raw: string,
  binding: ProposalSubmissionBinding,
  check: () => void,
): Promise<CreationHistoryCandidate> {
  check();
  if (
    !raw ||
    raw.length > CREATION_HISTORY_FILE_BYTES ||
    new TextEncoder().encode(raw).byteLength > CREATION_HISTORY_FILE_BYTES
  )
    throw new TypeError();
  const file = parseCreationHistoryFile(JSON.parse(raw.replace(/^\uFEFF/, '')));
  assertProposalSubmissionBinding(file.document.original.binding, binding);
  const digest = await backupHash(creationObservationJson(file.document));
  check();
  if (digest !== file.document_sha256) throw new TypeError();
  return { file, raw: creationHistoryFileJson(file) };
}
