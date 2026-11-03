import { ContractError, proposalReceiptJson, syncJsonSnapshot } from '@planemem/contracts';
import { readOptional } from './generation-journal-read.js';
import {
  inspectProposalQueueReceiptRecord,
  PROPOSAL_RECEIPT_RECORD_BYTES,
  type ProposalQueueReceiptRecord,
} from './proposal-receipt-record.js';

// Export failures repeat result beside record; file-save metadata has a separate bounded budget.
export const PROPOSAL_RECEIPT_RECOVERY_BYTES = 2 * PROPOSAL_RECEIPT_RECORD_BYTES + 128 * 1024;
export interface ProposalReceiptRecordRecovery {
  source: 'record' | 'export-error';
  record: ProposalQueueReceiptRecord;
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
  // Failed destinations may themselves be invalid paths. Keep them as inert metadata.
  if (typeof value !== 'string' || !value.trim()) throw new TypeError();
}

/** Recover retained file content only; no supplied path or outcome claim authorizes other actions. */
export function inspectProposalReceiptRecordRecovery(
  value: unknown,
): ProposalReceiptRecordRecovery {
  try {
    const row = object(JSON.parse(syncJsonSnapshot(value, PROPOSAL_RECEIPT_RECOVERY_BYTES)));
    if (row.kind === 'proposal-queue-receipt')
      return { source: 'record', record: inspectProposalQueueReceiptRecord(row) };
    fields(row, ['code', 'trace_id', 'result', 'record', 'output']);
    if (row.code !== 'PROPOSAL_RECEIPT_RECORD_EXPORT_FAILED') throw new TypeError();
    const record = inspectProposalQueueReceiptRecord(row.record);
    if (
      row.trace_id !== record.result.trace_id ||
      proposalReceiptJson(row.result, PROPOSAL_RECEIPT_RECORD_BYTES) !==
        proposalReceiptJson(record.result, PROPOSAL_RECEIPT_RECORD_BYTES)
    )
      throw new TypeError();
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
    return { source: 'export-error', record };
  } catch {
    throw new ContractError(
      'PROPOSAL_RECEIPT_RECOVERY_INVALID',
      'Keep the complete original record or matching export failure; incomplete results cannot be rebuilt',
    );
  }
}

export async function readProposalReceiptRecordRecovery(path: string) {
  let value: unknown;
  try {
    if (typeof path !== 'string' || !path.trim() || path === '-' || /[\u0000-\u001f]/.test(path))
      throw new TypeError();
    value = await readOptional(path, PROPOSAL_RECEIPT_RECOVERY_BYTES);
    if (value === undefined) throw new TypeError();
  } catch {
    throw new ContractError(
      'PROPOSAL_RECEIPT_RECOVERY_UNAVAILABLE',
      'Use an existing bounded regular file containing the retained receipt record',
    );
  }
  return inspectProposalReceiptRecordRecovery(value);
}
