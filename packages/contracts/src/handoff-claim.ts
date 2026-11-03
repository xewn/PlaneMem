import { isUlid } from './ids.js';
import { validateIdempotencyKey, validateSourceRef, type SourceRef } from './metadata.js';
import { parseSessionCommandIdentity, type SessionCommandIdentity } from './session-activity.js';
import { parseEtag } from './versioning.js';

export interface HandoffClaimCommand {
  expected_version: number;
  handoff_id?: string;
  client_id?: string;
}
export interface HandoffClaimReceiptQuery {
  request_key: string;
  claim: HandoffClaimCommand;
}
export interface HandoffClaimRecorded {
  status: 'recorded';
  handoff_id: string;
  session_id: string;
  checkpoint_id: string;
  expected_version: number;
  handoff_version: number;
  claimed_by: string;
  claimed_by_actor: string;
  changed: boolean;
}
export type HandoffClaimReceiptLookup =
  | { status: 'not-observed'; handoff_id: string }
  | HandoffClaimRecorded;

export interface HandoffClaimBinding {
  handoff_id: string;
  query: HandoffClaimReceiptQuery;
  identity: SessionCommandIdentity;
}

/** Original scope and identity are preconditions, never credentials or response-derived identity. */
export function parseHandoffClaimBinding(
  handoffId: unknown,
  input: unknown,
  expectedIdentity: unknown,
  scope: { tenant_id: string; workspace_id: string; project_id?: string },
): HandoffClaimBinding {
  const identity = parseSessionCommandIdentity(expectedIdentity);
  const query = parseHandoffClaimReceiptQuery(input);
  if (
    !isUlid(handoffId) ||
    identity.tenant_id !== scope.tenant_id ||
    identity.workspace_id !== scope.workspace_id ||
    identity.project_id !== scope.project_id ||
    (query.claim.handoff_id !== undefined && query.claim.handoff_id !== handoffId) ||
    (query.claim.client_id !== undefined && query.claim.client_id !== identity.client_id)
  )
    throw new TypeError('The original claim belongs to another handoff, client or project');
  return { handoff_id: handoffId, query, identity };
}

export interface HandoffClaimResult {
  schema_version: 1;
  tenant_id: string;
  workspace_id: string;
  project_id: string;
  handoff_id: string;
  checkpoint_id: string;
  from_client: string;
  target_client?: string;
  status: 'claimed' | 'expired';
  claimed_by: string;
  claimed_by_actor: string;
  version: number;
  trace_id: string;
  source_refs: SourceRef[];
  claim_receipt: HandoffClaimRecorded;
}
export interface HandoffClaimEnvelope<T> {
  schema_version: 1;
  trace_id: string;
  source_refs: SourceRef[];
  data: T;
  etag?: string;
}

export function parseHandoffClaimEnvelope(
  value: unknown,
  binding: HandoffClaimBinding,
  traceId: string,
  lookup: true,
): HandoffClaimEnvelope<HandoffClaimReceiptLookup>;
export function parseHandoffClaimEnvelope(
  value: unknown,
  binding: HandoffClaimBinding,
  traceId: string,
  lookup: false,
): HandoffClaimEnvelope<HandoffClaimResult>;
export function parseHandoffClaimEnvelope(
  value: unknown,
  binding: HandoffClaimBinding,
  traceId: string,
  lookup: boolean,
): HandoffClaimEnvelope<HandoffClaimReceiptLookup | HandoffClaimResult>;
export function parseHandoffClaimEnvelope(
  value: unknown,
  binding: HandoffClaimBinding,
  traceId: string,
  lookup: boolean,
): HandoffClaimEnvelope<HandoffClaimReceiptLookup | HandoffClaimResult> {
  const row = object(value);
  if (row.schema_version !== 1 || row.trace_id !== traceId || !identifier(traceId))
    throw new TypeError('Claim response trace mismatch');
  const refs = sourceRefs(row.source_refs);
  if (lookup) {
    if (refs.length || row.etag !== undefined)
      throw new TypeError('Invalid historical claim envelope');
    return {
      schema_version: 1,
      trace_id: traceId,
      source_refs: [],
      data: parseHandoffClaimReceiptLookup(
        row.data,
        binding.handoff_id,
        binding.query.claim.expected_version,
        binding.identity,
      ),
    };
  }
  const data = object(row.data);
  const receipt = parseHandoffClaimReceiptLookup(
    data.claim_receipt,
    binding.handoff_id,
    binding.query.claim.expected_version,
    binding.identity,
  );
  const sources = sourceRefs(data.source_refs);
  if (
    receipt.status !== 'recorded' ||
    data.schema_version !== 1 ||
    data.tenant_id !== binding.identity.tenant_id ||
    data.workspace_id !== binding.identity.workspace_id ||
    data.project_id !== binding.identity.project_id ||
    data.handoff_id !== binding.handoff_id ||
    data.checkpoint_id !== receipt.checkpoint_id ||
    !positive(data.version) ||
    data.version < receipt.handoff_version ||
    (data.version === receipt.handoff_version && data.status !== 'claimed') ||
    (data.status !== 'claimed' && data.status !== 'expired') ||
    data.claimed_by !== binding.identity.client_id ||
    data.claimed_by_actor !== binding.identity.actor_id ||
    !identifier(data.from_client) ||
    !identifier(data.trace_id) ||
    (data.target_client !== undefined &&
      (!identifier(data.target_client) || data.target_client !== binding.identity.client_id)) ||
    !sources.some((ref) => ref.type === 'checkpoint' && ref.id === receipt.checkpoint_id) ||
    JSON.stringify(sources) !== JSON.stringify(refs) ||
    (row.etag !== undefined && parseEtag(row.etag) !== data.version)
  )
    throw new TypeError('Current handoff does not match the original claim receipt');
  return {
    schema_version: 1,
    trace_id: traceId,
    source_refs: refs,
    ...(typeof row.etag === 'string' ? { etag: row.etag } : {}),
    data: {
      schema_version: 1,
      tenant_id: binding.identity.tenant_id,
      workspace_id: binding.identity.workspace_id,
      project_id: binding.identity.project_id,
      handoff_id: binding.handoff_id,
      checkpoint_id: receipt.checkpoint_id,
      from_client: data.from_client,
      ...(typeof data.target_client === 'string' ? { target_client: data.target_client } : {}),
      status: data.status,
      claimed_by: receipt.claimed_by,
      claimed_by_actor: receipt.claimed_by_actor,
      version: data.version,
      trace_id: data.trace_id,
      source_refs: sources,
      claim_receipt: receipt,
    },
  };
}

function sourceRefs(value: unknown): SourceRef[] {
  if (!Array.isArray(value) || value.length > 200 || Object.keys(value).length !== value.length)
    throw new TypeError('Invalid handoff sources');
  return value.map((input) => {
    const ref = validateSourceRef(input);
    return {
      type: ref.type,
      id: ref.id,
      ...(ref.revision === undefined ? {} : { revision: ref.revision }),
      ...(ref.uri === undefined ? {} : { uri: ref.uri }),
    };
  });
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new TypeError('Expected an object');
  return value as Record<string, unknown>;
}
function positive(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}
function identifier(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    !!value.trim() &&
    value.length <= 1024 &&
    !/[\u0000-\u001f\u007f\p{Cs}]/u.test(value)
  );
}
export function parseHandoffClaimCommand(value: unknown): HandoffClaimCommand {
  const row = object(value);
  if (
    Object.keys(row).some(
      (key) => !['expected_version', 'handoff_id', 'client_id'].includes(key),
    ) ||
    !positive(row.expected_version) ||
    row.expected_version === Number.MAX_SAFE_INTEGER ||
    (row.handoff_id !== undefined && !isUlid(row.handoff_id)) ||
    (row.client_id !== undefined && !identifier(row.client_id))
  )
    throw new TypeError(
      'Supply an original handoff version and optional handoff/client identifiers',
    );
  return {
    expected_version: row.expected_version,
    ...(typeof row.handoff_id === 'string' ? { handoff_id: row.handoff_id } : {}),
    ...(typeof row.client_id === 'string' ? { client_id: row.client_id } : {}),
  };
}
export function parseHandoffClaimReceiptQuery(value: unknown): HandoffClaimReceiptQuery {
  const row = object(value);
  if (Object.keys(row).some((key) => !['request_key', 'claim'].includes(key)))
    throw new TypeError('Unknown claim receipt field');
  return {
    request_key: validateIdempotencyKey(row.request_key),
    claim: parseHandoffClaimCommand(row.claim),
  };
}
export function parseHandoffClaimReceiptLookup(
  value: unknown,
  handoffId: string,
  expectedVersion: number,
  identity: { actor_id: string; client_id: string },
): HandoffClaimReceiptLookup {
  const row = object(value);
  if (!isUlid(handoffId) || !positive(expectedVersion) || row.handoff_id !== handoffId)
    throw new TypeError('Claim receipt does not match the original handoff');
  if (row.status === 'not-observed') {
    if (Object.keys(row).some((key) => !['status', 'handoff_id'].includes(key)))
      throw new TypeError('Invalid absent claim receipt');
    return { status: 'not-observed', handoff_id: handoffId };
  }
  if (
    row.status !== 'recorded' ||
    Object.keys(row).some(
      (key) =>
        ![
          'status',
          'handoff_id',
          'session_id',
          'checkpoint_id',
          'expected_version',
          'handoff_version',
          'claimed_by',
          'claimed_by_actor',
          'changed',
        ].includes(key),
    ) ||
    !isUlid(row.session_id) ||
    !isUlid(row.checkpoint_id) ||
    !positive(row.handoff_version) ||
    row.expected_version !== expectedVersion ||
    typeof row.changed !== 'boolean' ||
    row.handoff_version !== expectedVersion + (row.changed ? 1 : 0) ||
    !identifier(row.claimed_by) ||
    !identifier(row.claimed_by_actor) ||
    row.claimed_by !== identity.client_id ||
    row.claimed_by_actor !== identity.actor_id
  )
    throw new TypeError('Invalid original claim receipt');
  return {
    status: 'recorded',
    handoff_id: handoffId,
    session_id: row.session_id,
    checkpoint_id: row.checkpoint_id,
    expected_version: expectedVersion,
    handoff_version: row.handoff_version,
    claimed_by: row.claimed_by,
    claimed_by_actor: row.claimed_by_actor,
    changed: row.changed,
  };
}
