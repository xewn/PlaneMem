import { syncJsonSnapshot } from '@planemem/contracts';
import {
  assertProposalSubmissionBinding,
  encodeProposalOriginal,
  parseProposalOriginal,
  parseProposalSubmissionBinding,
  proposalOriginalStorageKey,
  type ProposalOriginal,
  type ProposalSubmissionBinding,
} from './original-model';

export const PROPOSAL_BACKUP_MAX_ENTRIES = 100;
export const PROPOSAL_BACKUP_DOCUMENT_BYTES = 16 * 1024 * 1024;
export const PROPOSAL_BACKUP_FILE_BYTES = PROPOSAL_BACKUP_DOCUMENT_BYTES + 1024;
export interface ProposalBackupDocument {
  schema_version: 1;
  kind: 'proposal-originals-backup';
  binding: ProposalSubmissionBinding;
  entries: ProposalOriginal[];
}
export interface ProposalBackupFile {
  document: ProposalBackupDocument;
  document_sha256: string;
}
function object(value: unknown, fields: string[]) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError();
  const row = value as Record<string, unknown>;
  if (Object.keys(row).length !== fields.length || fields.some((key) => !Object.hasOwn(row, key)))
    throw new TypeError('Use the complete proposal backup');
  return row;
}
function documentJson(document: ProposalBackupDocument) {
  return (
    '{"schema_version":1,"kind":"proposal-originals-backup","binding":' +
    JSON.stringify(document.binding) +
    ',"entries":[' +
    document.entries.map(encodeProposalOriginal).join(',') +
    ']}'
  );
}
export function parseProposalBackupDocument(value: unknown): ProposalBackupDocument {
  const row = object(JSON.parse(syncJsonSnapshot(value, PROPOSAL_BACKUP_DOCUMENT_BYTES)), [
    'schema_version',
    'kind',
    'binding',
    'entries',
  ]);
  if (
    row.schema_version !== 1 ||
    row.kind !== 'proposal-originals-backup' ||
    !Array.isArray(row.entries) ||
    row.entries.length > PROPOSAL_BACKUP_MAX_ENTRIES
  )
    throw new TypeError('Use a complete proposal backup with at most 100 entries');
  const binding = parseProposalSubmissionBinding(row.binding);
  if ((row.binding as Record<string, unknown>).gateway_url !== binding.gateway_url)
    throw new TypeError('Use the original normalized gateway binding');
  let previous: string | undefined;
  const entries = row.entries.map((entry: unknown) => {
    const original = parseProposalOriginal(entry);
    assertProposalSubmissionBinding(original.binding, binding);
    const key = proposalOriginalStorageKey(binding, original.request_key);
    if (previous !== undefined && key <= previous)
      throw new TypeError('Duplicate or unsorted original requests');
    previous = key;
    return original;
  });
  const result: ProposalBackupDocument = {
    schema_version: 1,
    kind: 'proposal-originals-backup',
    binding,
    entries,
  };
  if (new TextEncoder().encode(documentJson(result)).byteLength > PROPOSAL_BACKUP_DOCUMENT_BYTES)
    throw new TypeError('Proposal backup exceeds 16 MiB');
  return result;
}
/** Fixed v1 encoding; object input order is irrelevant, entry ordering is part of the digest. */
export function proposalBackupDocumentJson(value: unknown) {
  return documentJson(parseProposalBackupDocument(value));
}
export function parseProposalBackupFile(value: unknown): ProposalBackupFile {
  const row = object(JSON.parse(syncJsonSnapshot(value, PROPOSAL_BACKUP_FILE_BYTES)), [
    'document',
    'document_sha256',
  ]);
  if (typeof row.document_sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(row.document_sha256))
    throw new TypeError('Invalid backup digest');
  return {
    document: parseProposalBackupDocument(row.document),
    document_sha256: row.document_sha256,
  };
}
export function proposalBackupFileJson(value: unknown) {
  const file = parseProposalBackupFile(value);
  return (
    '{"document":' +
    documentJson(file.document) +
    ',"document_sha256":' +
    JSON.stringify(file.document_sha256) +
    '}'
  );
}
