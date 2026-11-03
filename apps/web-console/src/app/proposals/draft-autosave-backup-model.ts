import { proposalReceiptJson, syncJsonSnapshot } from '@planemem/contracts';
import {
  assertProposalSubmissionBinding,
  parseProposalSubmissionBinding,
  proposalOriginalStorageKey,
  type ProposalSubmissionBinding,
} from './original-model';

export interface AutosaveDraft {
  binding: ProposalSubmissionBinding;
  request_key: string;
  saved_at: string;
}
export interface AutosaveBackupEntry<Draft> {
  session_id: string;
  draft: Draft;
}
export interface AutosaveBackupDocument<Draft> {
  schema_version: 1;
  kind: string;
  binding: ProposalSubmissionBinding;
  entries: AutosaveBackupEntry<Draft>[];
}
export interface AutosaveBackupFile<Draft> {
  document: AutosaveBackupDocument<Draft>;
  document_sha256: string;
}
export interface AutosaveBackupComparison {
  entries: Array<{
    session_id: string;
    request_key: string;
    state: 'missing' | 'same' | 'different';
  }>;
  missing: number;
  same: number;
  different: number;
  can_restore: boolean;
}
export interface AutosaveBackupRestoreResult {
  total: number;
  added: number;
  already_present: number;
}
export const AUTOSAVE_BACKUP_MAX_ENTRIES = 100;
export const AUTOSAVE_SELECTION_MAX_ENTRIES = 20;
export interface AutosaveSelectionRemovalResult {
  total: number;
  removed: number;
  not_present: number;
}
export function draftAutosaveKey(binding: ProposalSubmissionBinding, session: string) {
  if (
    typeof session !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(session)
  )
    throw new TypeError();
  const slot = proposalOriginalStorageKey(binding, session);
  if (new TextEncoder().encode(slot).byteLength > 16384) throw new TypeError();
  return slot;
}
function object(value: unknown, fields: string[]) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError();
  const row = value as Record<string, unknown>;
  if (
    Object.keys(row).length !== fields.length ||
    fields.some((field) => !Object.hasOwn(row, field))
  )
    throw new TypeError('Use a complete automatic draft backup');
  return row;
}
export function createAutosaveBackupModel<Draft extends AutosaveDraft>({
  kind,
  documentBytes,
  parseDraft,
}: {
  kind: 'proposal-editing-autosaves-backup' | 'proposal-review-editing-autosaves-backup';
  documentBytes: number;
  parseDraft: (value: unknown) => Draft;
}) {
  const fileBytes = documentBytes + 1024;
  function parseDocument(value: unknown): AutosaveBackupDocument<Draft> {
    const row = object(JSON.parse(syncJsonSnapshot(value, documentBytes)), [
      'schema_version',
      'kind',
      'binding',
      'entries',
    ]);
    if (
      row.schema_version !== 1 ||
      row.kind !== kind ||
      !Array.isArray(row.entries) ||
      row.entries.length > AUTOSAVE_BACKUP_MAX_ENTRIES
    )
      throw new TypeError();
    const binding = parseProposalSubmissionBinding(row.binding);
    if (proposalReceiptJson(binding) !== proposalReceiptJson(row.binding)) throw new TypeError();
    draftAutosaveKey(binding, '00000000-0000-4000-8000-000000000000');
    let previous: string | undefined;
    const entries = row.entries.map((value: unknown) => {
      const entry = object(value, ['session_id', 'draft']);
      if (typeof entry.session_id !== 'string') throw new TypeError();
      const slot = draftAutosaveKey(binding, entry.session_id);
      if (previous !== undefined && slot <= previous)
        throw new TypeError('Duplicate or unsorted automatic session');
      previous = slot;
      const draft = parseDraft(entry.draft);
      assertProposalSubmissionBinding(draft.binding, binding);
      return { session_id: entry.session_id, draft };
    });
    const document: AutosaveBackupDocument<Draft> = { schema_version: 1, kind, binding, entries };
    proposalReceiptJson(document, documentBytes);
    return document;
  }
  function documentJson(value: unknown) {
    return proposalReceiptJson(parseDocument(value), documentBytes);
  }
  function parseFile(value: unknown): AutosaveBackupFile<Draft> {
    const row = object(JSON.parse(syncJsonSnapshot(value, fileBytes)), [
      'document',
      'document_sha256',
    ]);
    if (typeof row.document_sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(row.document_sha256))
      throw new TypeError();
    return { document: parseDocument(row.document), document_sha256: row.document_sha256 };
  }
  function fileJson(value: unknown) {
    return proposalReceiptJson(parseFile(value), fileBytes);
  }
  return { kind, documentBytes, fileBytes, parseDocument, documentJson, parseFile, fileJson };
}
export type AutosaveBackupModel<Draft extends AutosaveDraft> = ReturnType<
  typeof createAutosaveBackupModel<Draft>
>;
