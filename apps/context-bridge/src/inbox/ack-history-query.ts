import {
  ContractError,
  isUlid,
  parseSyncCommandIdentity,
  syncJsonSnapshot,
  type SyncCommandIdentity,
} from '@planemem/contracts';

export interface SyncInboxAckHistoryQuery {
  expected_identity: SyncCommandIdentity;
  after_sequence: number;
  limit: number;
  through_sequence?: number;
  through_id?: string;
  record_id?: string;
}
export const SYNC_INBOX_ACK_HISTORY_BYTES = 512 * 1024;

function object(input: unknown): Record<string, unknown> {
  const snapshot: unknown = JSON.parse(syncJsonSnapshot(input, 16384));
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) throw new TypeError();
  return snapshot as Record<string, unknown>;
}
function number(value: unknown, minimum: number, maximum = Number.MAX_SAFE_INTEGER): number {
  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value) ||
    value < minimum ||
    value > maximum
  )
    throw new TypeError();
  return value;
}
function invalid(trace: string) {
  return new ContractError(
    'INBOX_ACK_HISTORY_QUERY_INVALID',
    'Supply the original identity and valid history parameters; continuations require the saved upper sequence and ID',
    { trace_id: trace, retryable: false, acknowledgement_dispatch_state: 'not-sent' },
  );
}
/** Bounds and snapshots direct Bridge callers as well as CLI JSON input. */
export function parseInboxAckHistoryQuery(
  input: unknown,
  trace: string,
  dispatch: boolean,
): SyncInboxAckHistoryQuery {
  try {
    const value = object(input);
    const allowed = [
      'expected_identity',
      'after_sequence',
      'limit',
      'through_sequence',
      'through_id',
      ...(dispatch ? ['record_id'] : []),
    ];
    if (Object.keys(value).some((key) => !allowed.includes(key))) throw new TypeError();
    const expected_identity = parseSyncCommandIdentity(value.expected_identity);
    const after_sequence = number(value.after_sequence === undefined ? 0 : value.after_sequence, 0);
    const limit = number(value.limit === undefined ? 20 : value.limit, 1, 50);
    const bound = value.through_sequence !== undefined || value.through_id !== undefined;
    const result: SyncInboxAckHistoryQuery = { expected_identity, after_sequence, limit };
    if (bound) {
      result.through_sequence = number(value.through_sequence, 1);
      if (!isUlid(value.through_id) || after_sequence > result.through_sequence)
        throw new TypeError();
      result.through_id = value.through_id;
    } else if (after_sequence !== 0) throw new TypeError();
    if (value.record_id !== undefined) {
      if (!dispatch || !isUlid(value.record_id)) throw new TypeError();
      result.record_id = value.record_id;
    }
    return result;
  } catch {
    throw invalid(trace);
  }
}
export function parseInboxAckDetailQuery(input: unknown, trace: string, dispatch: boolean) {
  try {
    const value = object(input);
    const field = dispatch ? 'dispatch_id' : 'record_id';
    if (
      Object.keys(value).some((key) => key !== 'expected_identity' && key !== field) ||
      !isUlid(value[field])
    )
      throw new TypeError();
    return {
      expected_identity: parseSyncCommandIdentity(value.expected_identity),
      id: value[field] as string,
    };
  } catch {
    throw invalid(trace);
  }
}
