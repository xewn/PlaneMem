import { proposalReceiptJson, syncJsonSnapshot } from '@planemem/contracts';
import { parseProposalEditingDraft, type ProposalEditingDraft } from './editing-model';
import {
  assertProposalSubmissionBinding,
  parseProposalSubmissionBinding,
  proposalOriginalStorageKey,
  type ProposalSubmissionBinding,
} from './original-model';

export const EDITING_BACKUP_MAX_ENTRIES = 100;
export const EDITING_BACKUP_DOCUMENT_BYTES = 16 * 1024 * 1024;
export const EDITING_BACKUP_FILE_BYTES = EDITING_BACKUP_DOCUMENT_BYTES + 1024;
export interface EditingBackupDocument {
  schema_version: 1;
  kind: 'proposal-editing-drafts-backup';
  binding: ProposalSubmissionBinding;
  entries: ProposalEditingDraft[];
}
export interface EditingBackupFile {
  document: EditingBackupDocument;
  document_sha256: string;
}
function object(value: unknown, fields: string[]) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError();
  const row = value as Record<string, unknown>;
  if (Object.keys(row).length !== fields.length || fields.some((key) => !Object.hasOwn(row, key)))
    throw new TypeError('Use a complete editing draft backup');
  return row;
}
export function parseEditingBackupDocument(value: unknown): EditingBackupDocument {
  const row = object(JSON.parse(syncJsonSnapshot(value, EDITING_BACKUP_DOCUMENT_BYTES)), [
    'schema_version',
    'kind',
    'binding',
    'entries',
  ]);
  if (
    row.schema_version !== 1 ||
    row.kind !== 'proposal-editing-drafts-backup' ||
    !Array.isArray(row.entries) ||
    row.entries.length > EDITING_BACKUP_MAX_ENTRIES
  )
    throw new TypeError('Use a complete editing backup with at most 100 drafts');
  const binding = parseProposalSubmissionBinding(row.binding);
  if (proposalReceiptJson(binding) !== proposalReceiptJson(row.binding)) throw new TypeError();
  if (new TextEncoder().encode(proposalOriginalStorageKey(binding, 'a')).byteLength > 16384)
    throw new TypeError();
  let previous: string | undefined;
  const entries = row.entries.map((entry: unknown) => {
    const draft = parseProposalEditingDraft(entry);
    assertProposalSubmissionBinding(draft.binding, binding);
    const slot = proposalOriginalStorageKey(binding, draft.request_key);
    if (
      (previous !== undefined && slot <= previous) ||
      new TextEncoder().encode(slot).byteLength > 16384
    )
      throw new TypeError('Duplicate, unsorted or oversized editing draft key');
    previous = slot;
    return draft;
  });
  const result: EditingBackupDocument = {
    schema_version: 1,
    kind: 'proposal-editing-drafts-backup',
    binding,
    entries,
  };
  proposalReceiptJson(result, EDITING_BACKUP_DOCUMENT_BYTES);
  return result;
}
/** Fixed v1 canonical encoding includes the complete scope, fields and original save times. */
export function editingBackupDocumentJson(value: unknown) {
  return proposalReceiptJson(parseEditingBackupDocument(value), EDITING_BACKUP_DOCUMENT_BYTES);
}
export function parseEditingBackupFile(value: unknown): EditingBackupFile {
  const row = object(JSON.parse(syncJsonSnapshot(value, EDITING_BACKUP_FILE_BYTES)), [
    'document',
    'document_sha256',
  ]);
  if (typeof row.document_sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(row.document_sha256))
    throw new TypeError('Invalid editing backup checksum');
  return {
    document: parseEditingBackupDocument(row.document),
    document_sha256: row.document_sha256,
  };
}
export function editingBackupFileJson(value: unknown) {
  return proposalReceiptJson(parseEditingBackupFile(value), EDITING_BACKUP_FILE_BYTES);
}
