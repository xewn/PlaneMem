import { ContractError, syncJsonSnapshot } from '@planemem/contracts';
import { readOptional } from './generation-journal-read.js';
import {
  GENERATION_JOURNAL_BACKUP_BYTES,
  inspectGenerationJournalBackup,
  type ProposalGenerationJournalBackup,
} from './generation-journal-backup.js';

// CLI failure envelopes use compact JSON so wrapper indentation cannot exceed this allowance.
export const GENERATION_JOURNAL_BACKUP_RECOVERY_BYTES =
  GENERATION_JOURNAL_BACKUP_BYTES + 128 * 1024;
export interface ProposalGenerationJournalBackupRecovery {
  source: 'backup' | 'export-error' | 'recovery-error';
  backup: ProposalGenerationJournalBackup;
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError();
  const prototype: unknown = Object.getPrototypeOf(value);
  if (prototype !== null && prototype !== Object.prototype) throw new TypeError();
  const keys = Object.keys(value);
  if (
    Reflect.ownKeys(value).length !== keys.length ||
    keys.some((key) => !Object.hasOwn(Object.getOwnPropertyDescriptor(value, key)!, 'value'))
  )
    throw new TypeError();
  return value as Record<string, unknown>;
}
function fields(row: Record<string, unknown>, required: string[], optional: string[] = []) {
  if (
    required.some((key) => !Object.hasOwn(row, key)) ||
    Object.keys(row).some((key) => !required.includes(key) && !optional.includes(key))
  )
    throw new TypeError();
}
function pathMetadata(value: unknown) {
  // Historical failed destinations are inert metadata, never paths to follow during recovery.
  if (typeof value !== 'string' || !value.trim()) throw new TypeError();
}
export function inspectGenerationJournalBackupRecovery(
  value: unknown,
): ProposalGenerationJournalBackupRecovery {
  try {
    // Validate the envelope shallowly, then detach each bounded document independently.
    // A valid backup at the shared JSON node limit must remain recoverable when wrapped.
    const row = object(value);
    if (row.kind === 'proposal-generation-journal-backup')
      return { source: 'backup', backup: inspectGenerationJournalBackup(row) };
    fields(row, ['code', 'backup', 'output']);
    if (
      ![
        'PROPOSAL_GENERATION_JOURNAL_BACKUP_EXPORT_FAILED',
        'PROPOSAL_GENERATION_JOURNAL_BACKUP_RECOVERY_FAILED',
      ].includes(row.code as string)
    )
      throw new TypeError();
    const backup = inspectGenerationJournalBackup(row.backup);
    const output = object(JSON.parse(syncJsonSnapshot(row.output, 64 * 1024)));
    fields(
      output,
      ['output_path', 'export_phase'],
      ['save_phase', 'publication', 'temporary_path'],
    );
    pathMetadata(output.output_path);
    if (!['prepare', 'save'].includes(output.export_phase as string)) throw new TypeError();
    const hasSave = Object.hasOwn(output, 'save_phase');
    if (hasSave !== Object.hasOwn(output, 'publication')) throw new TypeError();
    if (
      hasSave &&
      (output.export_phase !== 'save' ||
        !['create', 'write', 'readback', 'publish', 'verify-published'].includes(
          output.save_phase as string,
        ) ||
        !['not-confirmed', 'linked-but-not-verified'].includes(output.publication as string) ||
        (output.publication === 'linked-but-not-verified') !==
          (output.save_phase === 'verify-published') ||
        (output.save_phase !== 'create' && !Object.hasOwn(output, 'temporary_path')))
    )
      throw new TypeError();
    if (Object.hasOwn(output, 'temporary_path')) {
      if (!hasSave) throw new TypeError();
      pathMetadata(output.temporary_path);
    }
    return {
      source:
        row.code === 'PROPOSAL_GENERATION_JOURNAL_BACKUP_EXPORT_FAILED'
          ? 'export-error'
          : 'recovery-error',
      backup,
    };
  } catch {
    throw new ContractError(
      'PROPOSAL_GENERATION_JOURNAL_BACKUP_RECOVERY_INVALID',
      'Keep the complete original journal backup or its consistent export failure; partial requests cannot be reconstructed',
    );
  }
}
export async function readGenerationJournalBackupRecovery(path: string) {
  let value: unknown;
  try {
    if (typeof path !== 'string' || !path.trim() || path === '-' || /[\u0000-\u001f]/.test(path))
      throw new TypeError();
    value = await readOptional(path, GENERATION_JOURNAL_BACKUP_RECOVERY_BYTES);
    if (value === undefined) throw new TypeError();
  } catch {
    throw new ContractError(
      'PROPOSAL_GENERATION_JOURNAL_BACKUP_RECOVERY_UNAVAILABLE',
      'Use an existing bounded regular file containing the retained journal backup',
    );
  }
  return inspectGenerationJournalBackupRecovery(value);
}
