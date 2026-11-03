import { isUlid } from './ids.js';
import { validateIdempotencyKey } from './metadata.js';
import {
  parseLegacyContextIdentity,
  type LegacyContextIdentity,
} from './legacy-context-lifecycle.js';
import { parseCreateProposal, type NormalizedCreateProposalRequest } from './proposals.js';
import { syncJsonSnapshot } from './sync-upload-receipt.js';

export const PROPOSAL_CREATE_RECEIPT_REQUEST_BYTES = 1024 * 1024;
export const PROPOSAL_CREATE_RECEIPT_RESPONSE_BYTES = 2 * 1024 * 1024;
export interface ProposalCreateReceiptQuery {
  identity: LegacyContextIdentity;
  request_key: string;
  draft: NormalizedCreateProposalRequest;
}
export interface ProposalCreateRecordedReceipt {
  proposal_id: string;
  status: 'proposed';
  revision: 1;
  event_id: string;
  occurred_at: string;
  server_cursor: number;
  current_state: 'not-checked';
}
export interface ProposalCreateReceiptEnvelope {
  schema_version: 1;
  trace_id: string;
  source_refs: Array<{ type: 'proposal'; id: string; revision: 1 }>;
  data: ProposalCreateReceiptQuery &
    ({ status: 'not-observed' } | { status: 'recorded'; receipt: ProposalCreateRecordedReceipt });
}
function object(value: unknown, fields: string[]) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError();
  const row = value as Record<string, unknown>;
  if (Object.keys(row).some((key) => !fields.includes(key)))
    throw new TypeError('Unknown receipt field');
  return row;
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') {
    const row = value as Record<string, unknown>;
    return (
      '{' +
      Object.keys(row)
        .sort()
        .map((key) => JSON.stringify(key) + ':' + canonical(row[key]))
        .join(',') +
      '}'
    );
  }
  return JSON.stringify(value)!;
}
export function proposalReceiptJson(
  value: unknown,
  maximum = PROPOSAL_CREATE_RECEIPT_REQUEST_BYTES,
) {
  return canonical(JSON.parse(syncJsonSnapshot(value, maximum)) as unknown);
}
export function parseProposalCommandIdentity(value: unknown) {
  const identity = parseLegacyContextIdentity(value);
  for (const field of ['tenant_id', 'workspace_id', 'project_id'] as const)
    if (!isUlid(identity[field])) throw new TypeError('Invalid original proposal project');
  for (const field of ['actor_id', 'client_id'] as const)
    if (!/^[\x21-\x7e]{1,255}$/.test(identity[field]))
      throw new TypeError('Invalid original proposal identity');
  return identity;
}
export function assertProposalReceiptIdentity(
  original: LegacyContextIdentity,
  actual: {
    tenant_id: string;
    workspace_id: string;
    project_id?: string;
    actor_id?: string;
    client_id?: string;
  },
) {
  const identity = parseProposalCommandIdentity(original);
  for (const field of ['tenant_id', 'workspace_id', 'project_id', 'actor_id', 'client_id'] as const)
    if (identity[field] !== actual[field])
      throw new TypeError('Original proposal identity differs');
}
export function parseProposalCreateReceiptQuery(value: unknown): ProposalCreateReceiptQuery {
  const row = object(JSON.parse(syncJsonSnapshot(value, PROPOSAL_CREATE_RECEIPT_REQUEST_BYTES)), [
    'identity',
    'request_key',
    'draft',
  ]);
  const identity = parseProposalCommandIdentity(row.identity);
  const request_key = validateIdempotencyKey(row.request_key);
  if (!/^[\x21-\x7e]{1,255}$/.test(request_key))
    throw new TypeError('Invalid original proposal key');
  const draft = parseCreateProposal(row.draft);
  if (canonical(row.draft) !== canonical(draft))
    throw new TypeError('Keep the complete normalized original draft');
  return { identity, request_key, draft };
}
export function parseProposalCreateReceiptEnvelope(
  value: unknown,
  expected: ProposalCreateReceiptQuery,
  trace: string,
): ProposalCreateReceiptEnvelope {
  const original = parseProposalCreateReceiptQuery(expected);
  const row = object(JSON.parse(syncJsonSnapshot(value, PROPOSAL_CREATE_RECEIPT_RESPONSE_BYTES)), [
    'schema_version',
    'trace_id',
    'source_refs',
    'data',
  ]);
  if (
    row.schema_version !== 1 ||
    row.trace_id !== trace ||
    typeof trace !== 'string' ||
    !trace ||
    !Array.isArray(row.source_refs)
  )
    throw new TypeError('Invalid original proposal receipt envelope');
  const data = object(row.data, ['identity', 'request_key', 'draft', 'status', 'receipt']);
  const returned = parseProposalCreateReceiptQuery({
    identity: data.identity,
    request_key: data.request_key,
    draft: data.draft,
  });
  if (proposalReceiptJson(original) !== proposalReceiptJson(returned))
    throw new TypeError('Receipt query differs from original');
  if (data.status === 'not-observed') {
    if (Object.hasOwn(data, 'receipt') || row.source_refs.length)
      throw new TypeError('Unobserved query has a result');
    return {
      schema_version: 1,
      trace_id: trace,
      source_refs: [],
      data: { ...returned, status: 'not-observed' },
    };
  }
  if (data.status !== 'recorded') throw new TypeError('Invalid receipt state');
  const saved = object(data.receipt, [
    'proposal_id',
    'status',
    'revision',
    'event_id',
    'occurred_at',
    'server_cursor',
    'current_state',
  ]);
  if (
    !isUlid(saved.proposal_id) ||
    saved.status !== 'proposed' ||
    saved.revision !== 1 ||
    !isUlid(saved.event_id) ||
    typeof saved.server_cursor !== 'number' ||
    !Number.isSafeInteger(saved.server_cursor) ||
    saved.server_cursor < 1 ||
    typeof saved.occurred_at !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(saved.occurred_at) ||
    !Number.isFinite(Date.parse(saved.occurred_at)) ||
    new Date(saved.occurred_at).toISOString() !== saved.occurred_at ||
    saved.current_state !== 'not-checked' ||
    row.source_refs.length !== 1
  )
    throw new TypeError('Invalid original creation receipt');
  const source = object(row.source_refs[0], ['type', 'id', 'revision']);
  if (source.type !== 'proposal' || source.id !== saved.proposal_id || source.revision !== 1)
    throw new TypeError('Receipt source differs');
  const receipt: ProposalCreateRecordedReceipt = {
    proposal_id: saved.proposal_id,
    status: 'proposed',
    revision: 1,
    event_id: saved.event_id,
    occurred_at: saved.occurred_at,
    server_cursor: saved.server_cursor,
    current_state: 'not-checked',
  };
  return {
    schema_version: 1,
    trace_id: trace,
    source_refs: [{ type: 'proposal', id: receipt.proposal_id, revision: 1 }],
    data: { ...returned, status: 'recorded', receipt },
  };
}
