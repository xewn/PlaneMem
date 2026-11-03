import { isUlid } from './ids.js';
import { validateIdempotencyKey } from './metadata.js';

export interface SessionResumeOrigin {
  handoff_id: string;
  checkpoint_id: string;
  require_claimed: boolean;
}

export interface ResumeReceiptQuery {
  request_key: string;
  handoff_id: string;
  require_claimed?: boolean;
}

export type ResumeReceiptLookup =
  | { status: 'not-observed' | 'legacy-unverified'; parent_session_id: string; handoff_id: string }
  | {
      status: 'recorded';
      parent_session_id: string;
      handoff_id: string;
      session_id: string;
      checkpoint_id: string;
      require_claimed: boolean;
      context_pack_state: 'not-checked';
    };

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new TypeError('Expected an object');
  return value as Record<string, unknown>;
}

export function parseSessionResumeOrigin(value: unknown): SessionResumeOrigin {
  const origin = object(value);
  if (
    Object.keys(origin).some(
      (key) => !['handoff_id', 'checkpoint_id', 'require_claimed'].includes(key),
    ) ||
    !isUlid(origin.handoff_id) ||
    !isUlid(origin.checkpoint_id) ||
    typeof origin.require_claimed !== 'boolean'
  )
    throw new TypeError('Invalid session resume origin');
  return {
    handoff_id: origin.handoff_id,
    checkpoint_id: origin.checkpoint_id,
    require_claimed: origin.require_claimed,
  };
}

export function parseResumeReceiptQuery(value: unknown): Required<ResumeReceiptQuery> {
  const query = object(value);
  if (
    Object.keys(query).some(
      (key) => !['request_key', 'handoff_id', 'require_claimed'].includes(key),
    ) ||
    !isUlid(query.handoff_id) ||
    (query.require_claimed !== undefined && typeof query.require_claimed !== 'boolean')
  )
    throw new TypeError('Supply request_key, handoff_id and optional require_claimed');
  return {
    request_key: validateIdempotencyKey(query.request_key),
    handoff_id: query.handoff_id,
    require_claimed: query.require_claimed === true,
  };
}

export function parseResumeReceiptLookup(
  value: unknown,
  parentId: string,
  handoffId: string,
): ResumeReceiptLookup {
  const receipt = object(value);
  if (
    !isUlid(parentId) ||
    !isUlid(handoffId) ||
    receipt.parent_session_id !== parentId ||
    receipt.handoff_id !== handoffId
  )
    throw new TypeError('Resume receipt does not match this request');
  if (receipt.status === 'not-observed' || receipt.status === 'legacy-unverified') {
    if (
      Object.keys(receipt).some(
        (key) => !['status', 'parent_session_id', 'handoff_id'].includes(key),
      )
    )
      throw new TypeError('Unexpected resume receipt fields');
    return { status: receipt.status, parent_session_id: parentId, handoff_id: handoffId };
  }
  if (
    receipt.status !== 'recorded' ||
    Object.keys(receipt).some(
      (key) =>
        ![
          'status',
          'parent_session_id',
          'handoff_id',
          'session_id',
          'checkpoint_id',
          'require_claimed',
          'context_pack_state',
        ].includes(key),
    ) ||
    !isUlid(receipt.session_id) ||
    receipt.session_id === parentId ||
    !isUlid(receipt.checkpoint_id) ||
    typeof receipt.require_claimed !== 'boolean' ||
    receipt.context_pack_state !== 'not-checked'
  )
    throw new TypeError('Invalid resume receipt');
  return {
    status: 'recorded',
    parent_session_id: parentId,
    handoff_id: handoffId,
    session_id: receipt.session_id,
    checkpoint_id: receipt.checkpoint_id,
    require_claimed: receipt.require_claimed,
    context_pack_state: 'not-checked',
  };
}
