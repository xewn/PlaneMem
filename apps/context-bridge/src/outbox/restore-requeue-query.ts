import { ContractError, isSyncIdentifier, syncJsonSnapshot } from '@planemem/contracts';
import type { OutboxScope } from './sqlite.js';
import { isOutboxSendControlGeneration } from './control.js';
import { parseOutboxRestorePreparation } from './restore.js';
import { parseOutboxReadScope } from './reading.js';

export interface OutboxRestoreRequeueQuery {
  scope: OutboxScope;
  restore_id: string;
  archive_sha256: string;
  expected_control_generation: string;
  event_ids: string[];
  reason: string;
  requeue_id?: string;
}
function fail(code: string, message: string, trace: string, details: Record<string, unknown> = {}) {
  return new ContractError(code, message, { trace_id: trace, retryable: false, details });
}
export function parseOutboxRestoreRequeueQuery(
  input: unknown,
  trace: string,
): OutboxRestoreRequeueQuery {
  try {
    const value: unknown = JSON.parse(syncJsonSnapshot(input, 16384));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError();
    const row = value as Record<string, unknown>;
    const fields = [
      'scope',
      'restore_id',
      'archive_sha256',
      'expected_control_generation',
      'event_ids',
      'reason',
    ];
    if (
      fields.some((key) => !Object.hasOwn(row, key)) ||
      Object.keys(row).some((key) => !fields.includes(key) && key !== 'requeue_id') ||
      (Object.hasOwn(row, 'requeue_id') && !isSyncIdentifier(row.requeue_id)) ||
      typeof row.archive_sha256 !== 'string' ||
      !/^[a-f0-9]{64}$/.test(row.archive_sha256) ||
      !isOutboxSendControlGeneration(row.expected_control_generation) ||
      !Array.isArray(row.event_ids) ||
      row.event_ids.length < 1 ||
      row.event_ids.length > 100 ||
      !row.event_ids.every(isSyncIdentifier) ||
      new Set(row.event_ids).size !== row.event_ids.length
    )
      throw new TypeError();
    const original = parseOutboxRestorePreparation(
      { scope: row.scope, restore_id: row.restore_id, reason: row.reason },
      trace,
    );
    return {
      scope: original.scope,
      restore_id: original.restore_id,
      archive_sha256: row.archive_sha256,
      expected_control_generation: row.expected_control_generation,
      event_ids: [...row.event_ids] as string[],
      reason: original.reason,
      ...(Object.hasOwn(row, 'requeue_id') ? { requeue_id: row.requeue_id as string } : {}),
    };
  } catch {
    throw fail(
      'OUTBOX_RESTORE_REQUEUE_QUERY_INVALID',
      'Supply exact scope, restore_id, archive_sha256, paused generation, 1 to 100 unique event_ids, reason and optional requeue_id within 16 KiB',
      trace,
    );
  }
}

export type OutboxRestoreRequeueReceiptQuery = OutboxRestoreRequeueQuery & { requeue_id: string };
export interface OutboxRestoreRequeueSelection {
  scope: OutboxScope;
  requeue_id: string;
}
export function parseOutboxRestoreRequeueSelection(
  input: unknown,
  trace: string,
): OutboxRestoreRequeueSelection {
  try {
    const value: unknown = JSON.parse(syncJsonSnapshot(input, 16384));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError();
    const row = value as Record<string, unknown>;
    if (
      Object.keys(row).length !== 2 ||
      Object.keys(row).some((key) => !['scope', 'requeue_id'].includes(key)) ||
      !isSyncIdentifier(row.requeue_id)
    )
      throw new TypeError();
    return { scope: parseOutboxReadScope(row.scope, trace), requeue_id: row.requeue_id };
  } catch (error) {
    throw fail(
      'OUTBOX_REQUEUE_SELECTION_INVALID',
      'Supply exactly the original project scope and requeue_id',
      trace,
      error instanceof ContractError
        ? { ...error.envelope.details, cause_code: error.envelope.code }
        : {},
    );
  }
}
export function parseOutboxRestoreRequeueReceiptQuery(
  input: unknown,
  trace: string,
): OutboxRestoreRequeueReceiptQuery {
  const query = parseOutboxRestoreRequeueQuery(input, trace);
  if (query.requeue_id === undefined)
    throw fail(
      'OUTBOX_RESTORE_REQUEUE_QUERY_INVALID',
      'Supply the complete original request including requeue_id',
      trace,
    );
  return { ...query, requeue_id: query.requeue_id };
}
