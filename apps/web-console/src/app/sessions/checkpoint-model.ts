import {
  isUlid,
  validateIdempotencyKey,
  parseSessionCommandIdentity,
  parseCheckpointReceiptLookup,
  type SessionCommandIdentity,
  type CheckpointReceiptLookup,
} from '@planemem/contracts';
import type { CheckpointNotes } from '../../lib/server-api';

export const checkpointLabels: Record<keyof CheckpointNotes, string> = {
  completed: 'Completed',
  in_progress: 'In progress',
  next_actions: 'Next actions',
  decisions: 'Decisions',
  risks: 'Risks',
  open_questions: 'Open questions',
};
export const checkpointFields = Object.keys(checkpointLabels) as (keyof CheckpointNotes)[];
export const CHECKPOINT_FIELD_LIMIT = 16384;
export const CHECKPOINT_RECOVERY_LIMIT = 262144;
export function checkpointRecoveryStorageKey(
  identity: SessionCommandIdentity | undefined,
  sessionId: string,
): string {
  return 'planemem-checkpoint-save-v1:' + JSON.stringify([identity, sessionId]);
}
export interface CheckpointSaveRequest {
  identity: SessionCommandIdentity;
  key: string;
  sessionId: string;
  version: number;
  notes: CheckpointNotes;
  contextPackId?: string;
}
export type CheckpointSaveFeedback =
  | { status: 'idle' }
  | {
      status: 'error';
      request: CheckpointSaveRequest;
      uncertain: boolean;
      message: string;
      trace?: string;
    }
  | {
      status: 'done';
      request: CheckpointSaveRequest;
      receipt: Extract<CheckpointReceiptLookup, { status: 'recorded' }>;
      message: string;
      trace?: string;
    };

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new TypeError('Invalid checkpoint recovery data');
  return value as Record<string, unknown>;
}
export function parseCheckpointSaveRequest(value: unknown): CheckpointSaveRequest {
  const row = record(value);
  if (
    Object.keys(row).some(
      (key) => !['identity', 'key', 'sessionId', 'version', 'notes', 'contextPackId'].includes(key),
    ) ||
    !isUlid(row.sessionId) ||
    typeof row.version !== 'number' ||
    !Number.isSafeInteger(row.version) ||
    row.version < 1 ||
    (row.contextPackId !== undefined && !isUlid(row.contextPackId))
  )
    throw new TypeError('Invalid original checkpoint request');
  const key = validateIdempotencyKey(row.key);
  const input = record(row.notes);
  if (
    Object.keys(input).some((field) => !checkpointFields.includes(field as keyof CheckpointNotes))
  )
    throw new TypeError('Unknown checkpoint note category');
  const notes = {} as CheckpointNotes;
  let count = 0;
  for (const field of checkpointFields) {
    const items = input[field];
    if (
      !Array.isArray(items) ||
      items.length > 200 ||
      Object.keys(items).length !== items.length ||
      items.some(
        (item) =>
          typeof item !== 'string' ||
          !item.trim() ||
          item.length > CHECKPOINT_FIELD_LIMIT ||
          /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\p{Cs}]/u.test(item),
      ) ||
      items.join('\n').length > CHECKPOINT_FIELD_LIMIT
    )
      throw new TypeError(
        'Each note category allows up to 200 nonempty items and 16384 characters',
      );
    // Do not trim or split a recovered request: the original fingerprint covers exact arrays.
    notes[field] = [...items] as string[];
    count += items.length;
  }
  if (!count) throw new TypeError('Add at least one checkpoint note');
  return {
    identity: parseSessionCommandIdentity(row.identity),
    key,
    sessionId: row.sessionId,
    version: row.version,
    notes,
    ...(row.contextPackId === undefined ? {} : { contextPackId: row.contextPackId as string }),
  };
}
export function sameCheckpointSave(
  left: CheckpointSaveRequest,
  right: CheckpointSaveRequest,
): boolean {
  return (
    JSON.stringify(parseCheckpointSaveRequest(left)) ===
    JSON.stringify(parseCheckpointSaveRequest(right))
  );
}
export function parseCheckpointSaveFeedback(
  value: unknown,
  expected: CheckpointSaveRequest,
): Exclude<CheckpointSaveFeedback, { status: 'idle' }> {
  const row = record(value);
  const request = parseCheckpointSaveRequest(row.request);
  if (
    !sameCheckpointSave(request, expected) ||
    typeof row.message !== 'string' ||
    row.message.length > 4000 ||
    (row.trace !== undefined && (typeof row.trace !== 'string' || row.trace.length > 1024))
  )
    throw new TypeError('Checkpoint feedback mismatch');
  const base = {
    request,
    message: row.message,
    ...(typeof row.trace === 'string' ? { trace: row.trace } : {}),
  };
  if (row.status === 'done') {
    const receipt = parseCheckpointReceiptLookup(
      row.receipt,
      request.sessionId,
      request.contextPackId,
    );
    if (receipt.status !== 'recorded' || row.uncertain === true)
      throw new TypeError('Invalid checkpoint receipt');
    return { ...base, status: 'done', receipt };
  }
  if (row.status === 'error' && typeof row.uncertain === 'boolean')
    return { ...base, status: 'error', uncertain: row.uncertain };
  throw new TypeError('Invalid checkpoint feedback');
}
export function encodeCheckpointRecovery(request: CheckpointSaveRequest): string {
  const raw = JSON.stringify({
    schema_version: 1,
    operation: 'checkpoint.save',
    request: parseCheckpointSaveRequest(request),
  });
  if (raw.length > CHECKPOINT_RECOVERY_LIMIT)
    throw new TypeError('Checkpoint recovery text is too large');
  return raw;
}
export function decodeCheckpointRecovery(raw: string): CheckpointSaveRequest {
  if (!raw || raw.length > CHECKPOINT_RECOVERY_LIMIT)
    throw new TypeError('Checkpoint recovery text is too large');
  const row = record(JSON.parse(raw));
  if (
    row.schema_version !== 1 ||
    row.operation !== 'checkpoint.save' ||
    Object.keys(row).some((field) => !['schema_version', 'operation', 'request'].includes(field))
  )
    throw new TypeError('Unsupported checkpoint recovery format');
  return parseCheckpointSaveRequest(row.request);
}
