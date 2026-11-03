'use client';

import { backupHash, backupOperation } from '../sync/receipt/backup-operation';
import { assertProposalSubmissionBinding, type ProposalSubmissionBinding } from './original-model';
import type {
  AutosaveDraft,
  AutosaveBackupModel,
  AutosaveBackupDocument,
  AutosaveBackupFile,
  AutosaveBackupComparison,
  AutosaveBackupRestoreResult,
} from './draft-autosave-backup-model';

export interface ReviewedAutosaveBackup<Draft> {
  file: AutosaveBackupFile<Draft>;
  raw: string;
}
export function createDraftAutosaveBackup<Draft extends AutosaveDraft>(store: {
  backupModel: AutosaveBackupModel<Draft>;
  readBackup: (
    binding: ProposalSubmissionBinding,
    signal: AbortSignal,
    check: () => void,
  ) => Promise<AutosaveBackupDocument<Draft>>;
  compareBackup: (
    document: AutosaveBackupDocument<Draft>,
    signal: AbortSignal,
    check: () => void,
  ) => Promise<AutosaveBackupComparison>;
  restoreBackup: (
    document: AutosaveBackupDocument<Draft>,
    signal: AbortSignal,
    check: () => void,
  ) => Promise<AutosaveBackupRestoreResult>;
}) {
  const model = store.backupModel;
  async function inspect(
    raw: string,
    binding: ProposalSubmissionBinding,
    check: () => void,
  ): Promise<ReviewedAutosaveBackup<Draft>> {
    check();
    if (
      !raw ||
      raw.length > model.fileBytes ||
      new TextEncoder().encode(raw).byteLength > model.fileBytes
    )
      throw new TypeError();
    const file = model.parseFile(JSON.parse(raw.replace(/^\uFEFF/, '')));
    assertProposalSubmissionBinding(file.document.binding, binding);
    const digest = await backupHash(model.documentJson(file.document));
    check();
    if (digest !== file.document_sha256)
      throw new TypeError('Automatic draft backup checksum differs');
    return { file, raw: model.fileJson(file) };
  }
  function prepare(binding: ProposalSubmissionBinding, signal: AbortSignal) {
    return backupOperation(signal, async (operationSignal, check) => {
      const document = await store.readBackup(binding, operationSignal, check);
      check();
      const document_sha256 = await backupHash(model.documentJson(document));
      check();
      const file = model.parseFile({ document, document_sha256 });
      return { file, raw: model.fileJson(file) };
    });
  }
  function load(source: File, binding: ProposalSubmissionBinding, signal: AbortSignal) {
    return backupOperation(signal, async (_operationSignal, check) => {
      if (source.size < 1 || source.size > model.fileBytes) throw new TypeError();
      const bytes = await source.arrayBuffer();
      check();
      if (bytes.byteLength !== source.size || bytes.byteLength > model.fileBytes)
        throw new TypeError();
      return inspect(new TextDecoder('utf-8', { fatal: true }).decode(bytes), binding, check);
    });
  }
  function compare(raw: string, binding: ProposalSubmissionBinding, signal: AbortSignal) {
    return backupOperation(signal, async (operationSignal, check) => {
      const reviewed = await inspect(raw, binding, check);
      check();
      const comparison = await store.compareBackup(reviewed.file.document, operationSignal, check);
      check();
      return { ...reviewed, comparison };
    });
  }
  function restore(
    raw: string,
    binding: ProposalSubmissionBinding,
    reviewedDigest: string,
    signal: AbortSignal,
  ) {
    return backupOperation(signal, async (operationSignal, check) => {
      const reviewed = await inspect(raw, binding, check);
      if (reviewed.file.document_sha256 !== reviewedDigest) throw new TypeError();
      check();
      const result = await store.restoreBackup(reviewed.file.document, operationSignal, check);
      check();
      return result;
    });
  }
  return {
    prepare,
    load,
    compare,
    restore,
    documentBytes: model.documentBytes,
    filename: model.kind + '.json',
  };
}
export type DraftAutosaveBackup<Draft extends AutosaveDraft> = ReturnType<
  typeof createDraftAutosaveBackup<Draft>
>;
