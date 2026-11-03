'use client';

import { backupOperation } from '../sync/receipt/backup-operation';
import type { ProposalSubmissionBinding } from './original-model';
import {
  AUTOSAVE_SELECTION_MAX_ENTRIES,
  type AutosaveDraft,
  type AutosaveBackupModel,
  type AutosaveBackupDocument,
  type AutosaveSelectionRemovalResult,
} from './draft-autosave-backup-model';
import { inspectAutosaveBackup, retainAutosaveBackup } from './draft-autosave-backup';

export function createDraftAutosaveCleanup<
  Draft extends AutosaveDraft,
  Summary extends { session_id: string },
>(store: {
  backupModel: AutosaveBackupModel<Draft>;
  readSelected: (
    binding: ProposalSubmissionBinding,
    selections: Summary[],
    signal: AbortSignal,
    check: () => void,
  ) => Promise<AutosaveBackupDocument<Draft>>;
  removeSelected: (
    document: AutosaveBackupDocument<Draft>,
    signal: AbortSignal,
    check: () => void,
  ) => Promise<AutosaveSelectionRemovalResult>;
}) {
  function prepare(binding: ProposalSubmissionBinding, selections: Summary[], signal: AbortSignal) {
    return backupOperation(signal, async (operationSignal, check) => {
      const document = await store.readSelected(binding, selections, operationSignal, check);
      check();
      return retainAutosaveBackup(store.backupModel, document, check);
    });
  }
  function remove(
    raw: string,
    binding: ProposalSubmissionBinding,
    confirmedDigest: string,
    signal: AbortSignal,
  ) {
    return backupOperation(signal, async (operationSignal, check) => {
      const reviewed = await inspectAutosaveBackup(store.backupModel, raw, binding, check);
      if (
        reviewed.file.document_sha256 !== confirmedDigest ||
        reviewed.file.document.entries.length < 1 ||
        reviewed.file.document.entries.length > AUTOSAVE_SELECTION_MAX_ENTRIES
      )
        throw new TypeError();
      check();
      const result = await store.removeSelected(reviewed.file.document, operationSignal, check);
      check();
      return result;
    });
  }
  return {
    prepare,
    remove,
    filename: store.backupModel.kind + '-selected.json',
    documentBytes: store.backupModel.documentBytes,
  };
}
export type DraftAutosaveCleanup<
  Draft extends AutosaveDraft,
  Summary extends { session_id: string },
> = ReturnType<typeof createDraftAutosaveCleanup<Draft, Summary>>;
