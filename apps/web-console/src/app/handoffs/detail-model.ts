import { parseHandoffReadEnvelope } from '@planemem/contracts';

export type HandoffSnapshot = ReturnType<typeof parseHandoffReadEnvelope>;
export type HandoffRefreshFeedback =
  | { status: 'done'; snapshot: HandoffSnapshot }
  | { status: 'error'; message: string; trace?: string };

/** Coordinates reads and commands in one mounted detail without changing recovery slots. */
export interface HandoffDetailControls {
  busy: boolean;
  writeReady: boolean;
  reviewRevision: number;
  acquire(): boolean;
  release(writeAttempted: boolean): void;
}

export function parseHandoffRefresh(
  value: unknown,
  previous: HandoffSnapshot,
): HandoffRefreshFeedback {
  const row = object(value);
  if (row.status === 'error') {
    if (
      typeof row.message !== 'string' ||
      !row.message.trim() ||
      row.message.length > 4000 ||
      (row.trace !== undefined &&
        (typeof row.trace !== 'string' || !row.trace.trim() || row.trace.length > 1024))
    )
      throw new TypeError('Invalid handoff refresh error');
    return {
      status: 'error',
      message: row.message,
      ...(typeof row.trace === 'string' ? { trace: row.trace } : {}),
    };
  }
  if (row.status !== 'done') throw new TypeError('Invalid handoff refresh response');
  const envelope = object(row.snapshot);
  if (typeof envelope.trace_id !== 'string') throw new TypeError('Invalid handoff refresh trace');
  const snapshot = parseHandoffReadEnvelope(
    envelope,
    previous.data.handoff_id,
    previous.data,
    envelope.trace_id,
    previous.session_identity,
  );
  if (!previous.session_identity && snapshot.session_identity)
    throw new TypeError('Reader identity changed; open a separate detail');
  const before = previous.data;
  const after = snapshot.data;
  for (const field of [
    'session_id',
    'checkpoint_id',
    'from_client',
    'target_client',
    'created_at',
  ] as const)
    if (after[field] !== before[field]) throw new TypeError('Handoff original references changed');
  if (after.version < before.version) throw new TypeError('Handoff version moved backwards');
  if (
    after.version === before.version &&
    (after.status !== before.status ||
      after.claimed_by !== before.claimed_by ||
      after.claimed_by_actor !== before.claimed_by_actor)
  )
    throw new TypeError('Handoff ownership changed without a new version');
  return { status: 'done', snapshot };
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new TypeError('Invalid handoff refresh data');
  return value as Record<string, unknown>;
}
