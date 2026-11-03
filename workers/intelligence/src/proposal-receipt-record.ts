import { createHash } from 'node:crypto';
import {
  ContractError,
  isUlid,
  assertProposalReceiptIdentity,
  parseProposalCreateReceiptQuery,
  parseProposalCreateReceiptEnvelope,
  proposalReceiptJson,
  syncJsonSnapshot,
} from '@planemem/contracts';
import { normalizeQueueBinding, type ProposalQueueBinding } from './queue-binding.js';
import type { ProposalQueueReceiptResult } from './proposal-reconciliation.js';
import { prepareGenerationOutput, saveGenerationFile } from './generation-output.js';
import { readOptional } from './generation-journal-read.js';

export const PROPOSAL_RECEIPT_RECORD_BYTES = 4 * 1024 * 1024;
export interface ProposalQueueReceiptRecord {
  schema_version: 1;
  kind: 'proposal-queue-receipt';
  operation: 'receipt' | 'reconcile';
  /** Local record assembly time, not the original creation or remote observation time. */
  recorded_at: string;
  result: ProposalQueueReceiptResult & { close_state: 'closed' };
  sha256: string;
}
export interface ProposalReceiptRecordOutput {
  readonly path: string;
  readonly directory: string;
}
function object(value: unknown, fields: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError();
  const row = value as Record<string, unknown>;
  if (Object.keys(row).length !== fields.length || fields.some((key) => !Object.hasOwn(row, key)))
    throw new TypeError();
  return row;
}
function canonical(value: unknown) {
  return proposalReceiptJson(value, PROPOSAL_RECEIPT_RECORD_BYTES);
}
function same(value: unknown, expected: unknown) {
  if (canonical(value) !== canonical(expected)) throw new TypeError();
}
function sha256(value: unknown) {
  return createHash('sha256').update(canonical(value), 'utf8').digest('hex');
}
function digest(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
}
function timestamp(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString() === value
  );
}

/** Validate file consistency only. A checksum cannot authenticate a remote or local outcome. */
export function inspectProposalQueueReceiptRecord(value: unknown): ProposalQueueReceiptRecord {
  try {
    const row = object(JSON.parse(syncJsonSnapshot(value, PROPOSAL_RECEIPT_RECORD_BYTES)), [
      'schema_version',
      'kind',
      'operation',
      'recorded_at',
      'result',
      'sha256',
    ]);
    if (
      row.schema_version !== 1 ||
      row.kind !== 'proposal-queue-receipt' ||
      !['receipt', 'reconcile'].includes(row.operation as string) ||
      !timestamp(row.recorded_at) ||
      !digest(row.sha256)
    )
      throw new TypeError();
    const result = object(row.result, [
      'schema_version',
      'trace_id',
      'binding',
      'job_id',
      'snapshot_sha256',
      'receipt',
      'local',
      'close_state',
    ]);
    const prefix = 'trace_worker_receipt_';
    if (
      result.schema_version !== 1 ||
      result.close_state !== 'closed' ||
      typeof result.trace_id !== 'string' ||
      !result.trace_id.startsWith(prefix) ||
      !isUlid(result.trace_id.slice(prefix.length)) ||
      !isUlid(result.job_id) ||
      !digest(result.snapshot_sha256)
    )
      throw new TypeError();
    const binding = normalizeQueueBinding(result.binding as ProposalQueueBinding);
    same(result.binding, binding);
    const envelope = object(result.receipt, ['schema_version', 'trace_id', 'source_refs', 'data']);
    if (!envelope.data || typeof envelope.data !== 'object' || Array.isArray(envelope.data))
      throw new TypeError();
    const data = envelope.data as Record<string, unknown>;
    const query = parseProposalCreateReceiptQuery({
      identity: data.identity,
      request_key: data.request_key,
      draft: data.draft,
    });
    assertProposalReceiptIdentity(query.identity, binding);
    const receipt = parseProposalCreateReceiptEnvelope(envelope, query, result.trace_id);
    same(envelope, receipt);
    const local = object(result.local, ['state', 'mutation']);
    let expectedMutation: 'none' | 'committed' = 'none';
    if (row.operation === 'receipt') {
      if (local.state !== 'not-requested') throw new TypeError();
    } else if (receipt.data.status === 'not-observed') {
      if (local.state !== 'not-observed') throw new TypeError();
    } else {
      if (
        !['submitted', 'already-submitted', 'sending', 'local-changed'].includes(
          local.state as string,
        )
      )
        throw new TypeError();
      if (local.state === 'submitted') expectedMutation = 'committed';
    }
    if (local.mutation !== expectedMutation) throw new TypeError();
    const { sha256: checksum, ...body } = row;
    if (checksum !== sha256(body)) throw new TypeError();
    if (
      Buffer.byteLength(JSON.stringify(row, null, 2) + '\n', 'utf8') > PROPOSAL_RECEIPT_RECORD_BYTES
    )
      throw new TypeError();
    // Return the detached, fully validated content without repairing original fields.
    return row as unknown as ProposalQueueReceiptRecord;
  } catch {
    throw new ContractError(
      'PROPOSAL_RECEIPT_RECORD_INVALID',
      'Use a complete, consistent original receipt record; retain the source file',
    );
  }
}

/** The caller must have completed the operation and confirmed queue close before recording. */
export function createProposalQueueReceiptRecord(
  operation: ProposalQueueReceiptRecord['operation'],
  result: ProposalQueueReceiptRecord['result'],
): ProposalQueueReceiptRecord {
  const body = {
    schema_version: 1 as const,
    kind: 'proposal-queue-receipt' as const,
    operation,
    recorded_at: new Date().toISOString(),
    result,
  };
  return inspectProposalQueueReceiptRecord({ ...body, sha256: sha256(body) });
}

export function proposalQueueReceiptRecordSummary(value: unknown) {
  const record = inspectProposalQueueReceiptRecord(value);
  const { result } = record;
  return {
    schema_version: record.schema_version,
    kind: record.kind,
    operation: record.operation,
    recorded_at: record.recorded_at,
    record_sha256: record.sha256,
    binding: result.binding,
    job_id: result.job_id,
    snapshot_sha256: result.snapshot_sha256,
    request_key: result.receipt.data.request_key,
    trace_id: result.trace_id,
    receipt_status: result.receipt.data.status,
    ...(result.receipt.data.status === 'recorded' ? { creation: result.receipt.data.receipt } : {}),
    local: result.local,
    close_state: result.close_state,
    verification: 'file-consistency-only' as const,
    current_queue: 'not-checked' as const,
    current_remote: 'not-checked' as const,
  };
}

/** Read a bounded regular file without opening a queue or contacting the gateway. */
export async function readProposalQueueReceiptRecord(path: string) {
  let value: unknown;
  try {
    if (typeof path !== 'string' || !path.trim() || path === '-' || /[\u0000-\u001f]/.test(path))
      throw new TypeError();
    value = await readOptional(path, PROPOSAL_RECEIPT_RECORD_BYTES);
    if (value === undefined) throw new TypeError();
  } catch {
    throw new ContractError(
      'PROPOSAL_RECEIPT_RECORD_UNAVAILABLE',
      'Use an existing bounded regular receipt record file',
    );
  }
  return inspectProposalQueueReceiptRecord(value);
}

export async function prepareProposalReceiptRecordOutput(
  path: string,
): Promise<ProposalReceiptRecordOutput> {
  try {
    return await prepareGenerationOutput(path);
  } catch {
    throw new ContractError(
      'PROPOSAL_RECEIPT_RECORD_OUTPUT_UNAVAILABLE',
      'Choose a new receipt record file in an existing directory',
    );
  }
}

export async function saveProposalQueueReceiptRecord(
  output: ProposalReceiptRecordOutput,
  value: unknown,
) {
  const record = inspectProposalQueueReceiptRecord(value);
  return saveGenerationFile(
    output,
    Buffer.from(JSON.stringify(record, null, 2) + '\n', 'utf8'),
    PROPOSAL_RECEIPT_RECORD_BYTES,
    record.result.trace_id,
    'PROPOSAL_RECEIPT_RECORD_SAVE_FAILED',
  );
}
