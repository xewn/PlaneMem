import { isUlid } from './ids.js';
import { validateIdempotencyKey } from './metadata.js';

export interface CheckpointReceiptQuery {
  request_key: string;
  /** Exact original body; include the effective If-Match version as expected_version. */
  checkpoint: Record<string, unknown> & { expected_version: number };
}

export type CheckpointReceiptLookup =
  | { status: 'not-observed'; session_id: string }
  | {
      status: 'recorded';
      session_id: string;
      checkpoint_id: string;
      revision: number;
      context_pack_id?: string;
      context_pack_state: 'not-checked';
    };

export function parseCheckpointReceiptQuery(value: unknown): CheckpointReceiptQuery {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new TypeError('Expected a checkpoint receipt query');
  const query = value as Record<string, unknown>;
  if (Object.keys(query).some((key) => !['request_key', 'checkpoint'].includes(key)))
    throw new TypeError('Only request_key and checkpoint are accepted');
  const key = validateIdempotencyKey(query.request_key);
  const original = query.checkpoint;
  if (!original || typeof original !== 'object' || Array.isArray(original))
    throw new TypeError('checkpoint must contain the original request');
  const input = original as Record<string, unknown>;
  if (
    typeof input.expected_version !== 'number' ||
    !Number.isSafeInteger(input.expected_version) ||
    input.expected_version < 1
  )
    throw new TypeError('Include the original expected_version');
  for (const name of [
    'completed',
    'in_progress',
    'next_actions',
    'decisions',
    'risks',
    'open_questions',
  ]) {
    const entries = input[name];
    if (
      !Array.isArray(entries) ||
      Object.keys(entries).length !== entries.length ||
      Array.from(entries).some((entry) => typeof entry !== 'string')
    )
      throw new TypeError('Include all six original checkpoint note arrays');
  }
  if (input.idempotency_key !== undefined && input.idempotency_key !== key)
    throw new TypeError('Original idempotency_key and request_key disagree');
  if (
    input.context_pack_id !== undefined &&
    (!isUlid(input.context_pack_id) || input.context_pack !== undefined)
  )
    throw new TypeError('Invalid saved context pack binding');
  // Never normalize note text or drop extra original fields: the saved fingerprint covers them.
  return { request_key: key, checkpoint: { ...input, expected_version: input.expected_version } };
}

export function parseCheckpointReceiptLookup(
  value: unknown,
  sessionId: string,
  contextPackId?: unknown,
): CheckpointReceiptLookup {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new TypeError('Invalid checkpoint receipt response');
  const receipt = value as Record<string, unknown>;
  if (!isUlid(sessionId) || receipt.session_id !== sessionId)
    throw new TypeError('Receipt session does not match');
  if (receipt.status === 'not-observed') {
    if (Object.keys(receipt).some((key) => !['status', 'session_id'].includes(key)))
      throw new TypeError('Unexpected checkpoint receipt fields');
    return { status: 'not-observed', session_id: sessionId };
  }
  if (
    receipt.status !== 'recorded' ||
    Object.keys(receipt).some(
      (key) =>
        ![
          'status',
          'session_id',
          'checkpoint_id',
          'revision',
          'context_pack_id',
          'context_pack_state',
        ].includes(key),
    ) ||
    !isUlid(receipt.checkpoint_id) ||
    typeof receipt.revision !== 'number' ||
    !Number.isSafeInteger(receipt.revision) ||
    receipt.revision < 1 ||
    receipt.context_pack_state !== 'not-checked' ||
    receipt.context_pack_id !== contextPackId ||
    (receipt.context_pack_id !== undefined && !isUlid(receipt.context_pack_id))
  )
    throw new TypeError('The gateway did not return the expected checkpoint receipt');
  return {
    status: 'recorded',
    session_id: sessionId,
    checkpoint_id: receipt.checkpoint_id,
    revision: receipt.revision,
    context_pack_state: 'not-checked',
    ...(receipt.context_pack_id === undefined ? {} : { context_pack_id: receipt.context_pack_id }),
  };
}
