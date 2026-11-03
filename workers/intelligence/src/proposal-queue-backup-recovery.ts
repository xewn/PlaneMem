import { ContractError, syncJsonSnapshot } from '@planemem/contracts';
import { readOptional } from './generation-journal-read.js';
import {
  inspectProposalQueueBackup,
  PROPOSAL_QUEUE_BACKUP_BYTES,
  type ProposalQueueBackup,
} from './proposal-queue-backup.js';

// One complete backup plus bounded failure metadata and wrapper indentation.
export const PROPOSAL_QUEUE_BACKUP_RECOVERY_BYTES = PROPOSAL_QUEUE_BACKUP_BYTES + 128 * 1024;
export interface ProposalQueueBackupRecovery {
  source: 'backup' | 'export-error' | 'recovery-error';
  backup: ProposalQueueBackup;
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError();
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
  // An invalid failed destination is still metadata; never resolve or open these paths.
  if (typeof value !== 'string' || !value.trim()) throw new TypeError();
}

/** Extract complete retained content only. A past close/save claim is never current queue evidence. */
export function inspectProposalQueueBackupRecovery(value: unknown): ProposalQueueBackupRecovery {
  try {
    const row = object(JSON.parse(syncJsonSnapshot(value, PROPOSAL_QUEUE_BACKUP_RECOVERY_BYTES)));
    if (row.kind === 'proposal-queue-backup')
      return { source: 'backup', backup: inspectProposalQueueBackup(row) };
    fields(row, ['code', 'backup', 'output']);
    if (
      row.code !== 'PROPOSAL_QUEUE_BACKUP_EXPORT_FAILED' &&
      row.code !== 'PROPOSAL_QUEUE_BACKUP_RECOVERY_FAILED'
    )
      throw new TypeError();
    const backup = inspectProposalQueueBackup(row.backup);
    const output = object(JSON.parse(syncJsonSnapshot(row.output, 64 * 1024)));
    fields(
      output,
      ['output_path', 'export_phase', 'close_state'],
      ['save_phase', 'publication', 'temporary_path'],
    );
    pathMetadata(output.output_path);
    if (row.code === 'PROPOSAL_QUEUE_BACKUP_EXPORT_FAILED') {
      if (
        !['close', 'save'].includes(output.export_phase as string) ||
        output.close_state !== (output.export_phase === 'close' ? 'not-confirmed' : 'closed')
      )
        throw new TypeError();
    } else if (
      !['prepare', 'save'].includes(output.export_phase as string) ||
      output.close_state !== 'not-opened'
    )
      throw new TypeError();
    const hasSave = Object.hasOwn(output, 'save_phase');
    if (hasSave !== Object.hasOwn(output, 'publication')) throw new TypeError();
    if (hasSave) {
      if (
        output.export_phase !== 'save' ||
        !['create', 'write', 'readback', 'publish', 'verify-published'].includes(
          output.save_phase as string,
        ) ||
        !['not-confirmed', 'linked-but-not-verified'].includes(output.publication as string) ||
        (output.publication === 'linked-but-not-verified') !==
          (output.save_phase === 'verify-published') ||
        (output.save_phase !== 'create' && !Object.hasOwn(output, 'temporary_path'))
      )
        throw new TypeError();
    }
    if (Object.hasOwn(output, 'temporary_path')) {
      if (!hasSave) throw new TypeError();
      pathMetadata(output.temporary_path);
    }
    return {
      source:
        row.code === 'PROPOSAL_QUEUE_BACKUP_EXPORT_FAILED' ? 'export-error' : 'recovery-error',
      backup,
    };
  } catch {
    throw new ContractError(
      'PROPOSAL_QUEUE_BACKUP_RECOVERY_INVALID',
      'Keep the complete original backup or its consistent export failure; partial snapshots cannot be rebuilt',
    );
  }
}

export async function readProposalQueueBackupRecovery(path: string) {
  let value: unknown;
  try {
    if (typeof path !== 'string' || !path.trim() || path === '-' || /[\u0000-\u001f]/.test(path))
      throw new TypeError();
    value = await readOptional(path, PROPOSAL_QUEUE_BACKUP_RECOVERY_BYTES);
    if (value === undefined) throw new TypeError();
  } catch {
    throw new ContractError(
      'PROPOSAL_QUEUE_BACKUP_RECOVERY_UNAVAILABLE',
      'Use an existing bounded regular file containing the retained queue backup',
    );
  }
  return inspectProposalQueueBackupRecovery(value);
}
